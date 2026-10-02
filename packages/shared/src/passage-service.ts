import { normalizeDirection, resolveTimeZone } from "./index.js";
import { createHash } from "node:crypto";
import { detectAndCreateHit } from "./hit-detection.js";
import { Prisma, type PrismaClient } from "@prisma/client";
import { calculatePassageExpiry, displayLicensePlate } from "./index.js";
import type { StorageProvider } from "./passage-storage.js";
import type { NormalizedAnprEvent, ProviderLogger } from "./anpr-event.js";

export type PassagePolicy = {
  requireImagesStored?: boolean;
  expectedConfigVersion?: number;
  expectedProvider?: "DAHUA_ITSAPI";
  onAccepted?: (tx: Prisma.TransactionClient) => Promise<void>;
};

export type PassageResult = { status: "stored"; id: string } | { status: "duplicate" };

export class PassageService {
  constructor(private readonly options: {
    prisma: PrismaClient; storage: StorageProvider; dedupeWindowMs: number; logger: ProviderLogger;
  }) {}

  async store(event: NormalizedAnprEvent, policy: PassagePolicy = {}): Promise<PassageResult> {
    const sourceEventId = event.sourceEventId ?? `fallback:${createHash("sha256").update(JSON.stringify([
      event.cameraId, event.normalizedPlate, event.occurredAt.toISOString(), event.lane ?? null
    ])).digest("hex")}`;
    // Exact event identity: never merge separate passages because their plates are close in time.
    const duplicateWhere = { cameraId: event.cameraId, source: event.source, sourceEventId };
    const existing = await this.options.prisma.passage.findFirst({ where: duplicateWhere,
      select: { id: true, ...(policy.onAccepted ? { vehicleImage1ObjectId:true, plateImageObjectId:true, vehicleImage2ObjectId:true } : {}) },
    });
    if (!policy.onAccepted && existing) return { status: "duplicate" };

    const stored: string[] = [];
    const retained = new Set<string>();
    try {
      const imageObjects = new Map<string, string>();
      const storeImage = async (image: NormalizedAnprEvent["overviewImage"]) => {
        if (!image) return undefined;
        const hash = createHash("sha256").update(image.data).digest("hex");
        if (imageObjects.has(hash)) return imageObjects.get(hash);
        try {
          const objectId = await this.options.storage.storePassageImage(image, event.occurredAt);
          imageObjects.set(hash, objectId); stored.push(objectId); return objectId;
        } catch {
          if (policy.requireImagesStored) throw new Error("IMAGE_STORAGE_FAILED");
          this.options.logger.warn(JSON.stringify({ cameraId: event.cameraId, processingResult: "IMAGE_STORAGE_FAILED" }));
          return undefined;
        }
      };
      const overviewObjectId = existing?.vehicleImage1ObjectId ? undefined : await storeImage(event.overviewImage);
      const plateObjectId = existing?.plateImageObjectId ? undefined : await storeImage(event.plateImage);
      const extraObjectId = existing?.vehicleImage2ObjectId ? undefined : await storeImage(event.extraImage);
      if (!overviewObjectId && !plateObjectId) this.options.logger.warn(JSON.stringify({ cameraId: event.cameraId, provider: event.source, eventId: sourceEventId, processingResult: "NO_EVENT_IMAGES" }));
      const camera = await this.options.prisma.camera.findFirst({ where: { id: event.cameraId, active: true, isDraft: false, archivedAt: null }, select: { id: true, location: true, direction: true, vpnLocation:{select:{timezone:true}} } });
      if (!camera) throw new Error("CAMERA_NOT_ACTIVE");
      const direction = normalizeDirection(event.direction);
      const timezone=resolveTimeZone(camera.vpnLocation?.timezone,process.env.PLATFORM_TIMEZONE);
      const metadata = { ...event.rawMetadata,
        imageOriginalStored: Boolean(overviewObjectId), imagePlateStored: Boolean(plateObjectId), imageVehicleStored: Boolean(extraObjectId),
        directionSource: event.sourceDirection ? "CAMERA_EVENT_MAPPED" : event.direction && event.direction !== "UNKNOWN" ? "NORMALIZED_EVENT" : "UNKNOWN",
        receivedAt: new Date().toISOString()
      };
      if(event.rawMetadata?.vehicleTypeStatus && event.rawMetadata.vehicleTypeStatus!=="MAPPED") this.options.logger.warn(JSON.stringify({cameraId:camera.id,processingResult:"VEHICLE_TYPE_NOT_MAPPED",reason:event.rawMetadata.vehicleTypeStatus}));
      const result = await this.options.prisma.$transaction(async (tx): Promise<PassageResult> => {
        // Serialize against archive/disable: an in-flight event cannot reactivate an archived camera.
        const active = await tx.camera.updateMany({ where: { id: camera.id, active: true, isDraft: false, archivedAt: null, configVersion: policy.expectedConfigVersion, anprProvider: policy.expectedProvider }, data: { lastAnprEventAt: new Date() } });
        if (active.count !== 1) throw new Error("CAMERA_NOT_ACTIVE");
        const duplicate = await tx.passage.findFirst({ where: duplicateWhere, select: { id:true,vehicleImage1ObjectId:true,plateImageObjectId:true,vehicleImage2ObjectId:true } });
        if (duplicate) {
          // Late images enrich the existing event without creating a second hit/job.
          const additions = {
            ...(!duplicate.vehicleImage1ObjectId && overviewObjectId ? {vehicleImage1ObjectId:overviewObjectId} : {}),
            ...(!duplicate.plateImageObjectId && plateObjectId ? {plateImageObjectId:plateObjectId} : {}),
            ...(!duplicate.vehicleImage2ObjectId && extraObjectId ? {vehicleImage2ObjectId:extraObjectId} : {}),
          };
          if (Object.keys(additions).length) {
            await tx.passage.update({where:{id:duplicate.id},data:additions});
            if (additions.vehicleImage1ObjectId) await tx.hit.updateMany({where:{passageId:duplicate.id,vehicleImageObjectId:null},data:{vehicleImageObjectId:additions.vehicleImage1ObjectId}});
            if (additions.plateImageObjectId) await tx.hit.updateMany({where:{passageId:duplicate.id,plateImageObjectId:null},data:{plateImageObjectId:additions.plateImageObjectId}});
            Object.values(additions).forEach(id=>retained.add(id));
          }
          await policy.onAccepted?.(tx);
          return { status: "duplicate" };
        }
        const created = await tx.passage.create({ data: {
          cameraId: camera.id, timezone, timestamp: event.occurredAt, location: event.location ?? camera.location, direction,
          originalLicensePlate: event.originalPlate, normalizedLicensePlate: event.normalizedPlate,
          displayLicensePlate: displayLicensePlate(event.originalPlate), plateConfidence: event.confidence,
          plateCountry: event.plateCountry, vehicleType: event.vehicleType ?? "UNKNOWN",
          vehicleColor: event.vehicleColor ?? "UNKNOWN", vehicleBrand: event.vehicleBrand, lane: event.lane,
          vehicleImage1ObjectId: overviewObjectId, vehicleImage2ObjectId: extraObjectId, plateImageObjectId: plateObjectId,
          source: "DAHUA_CAMERA", sourceEventId,
          rawEventMetadata: metadata as Prisma.InputJsonValue,
          expiresAt: calculatePassageExpiry(event.occurredAt),
          vehicle: event.vehicleType || event.vehicleColor || event.vehicleBrand ? { create: {
            type: event.vehicleType ?? "UNKNOWN", color: event.vehicleColor ?? "UNKNOWN",
            metadata: event.vehicleBrand ? { brand: event.vehicleBrand } : undefined
          } } : undefined,
          plateDetections: { create: {
            rawLicensePlate: event.originalPlate, normalizedLicensePlate: event.normalizedPlate,
            confidence: event.confidence ?? 0, frameObjectId: plateObjectId
          } }
        } });
        await tx.attentionAnalysisJob.create({data:{passageId:created.id}});
        await detectAndCreateHit(tx, {
          passageId: created.id, cameraId: camera.id, normalizedLicensePlate: event.normalizedPlate,
          location: event.location ?? camera.location, timestamp: event.occurredAt, direction, source: event.source,
          vehicleImageObjectId: overviewObjectId, plateImageObjectId: plateObjectId
        });
        await tx.camera.update({ where: { id: camera.id }, data: {
          lastVehicleRegistrationAt: event.occurredAt, lastAnprEventAt: event.occurredAt,
          anprConnectionStatus: "CONNECTED", lastAnprErrorCode: null, lastAnprError: null
        } });
        await policy.onAccepted?.(tx);
        return { status: "stored", id: created.id };
      });
      if (result.status === "duplicate") await Promise.allSettled(stored.filter(objectId=>!retained.has(objectId)).map(objectId => this.options.storage.delete(objectId)));
      this.options.logger.info(JSON.stringify({ cameraId: event.cameraId, provider: event.source, processingResult: result.status }));
      return result;
    } catch (error) {
      await Promise.allSettled(stored.map((objectId) => this.options.storage.delete(objectId)));
      if (!policy.onAccepted && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
        && await this.options.prisma.passage.findFirst({ where: duplicateWhere, select: { id: true } })) return { status: "duplicate" };
      throw error;
    }
  }
}
