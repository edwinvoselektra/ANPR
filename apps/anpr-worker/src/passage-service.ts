import { Prisma, type PrismaClient } from "@prisma/client";
import { calculatePassageExpiry, displayLicensePlate } from "@anpr/shared";
import type { StorageProvider } from "./storage.js";
import type { NormalizedAnprEvent, ProviderLogger } from "./types.js";
import { redactPlate } from "./credentials.js";

export type PassageResult = { status: "stored"; id: string } | { status: "duplicate" };

export class PassageService {
  constructor(private readonly options: {
    prisma: PrismaClient; storage: StorageProvider; dedupeWindowMs: number; logger: ProviderLogger;
  }) {}

  async store(event: NormalizedAnprEvent): Promise<PassageResult> {
    const duplicateWhere = event.sourceEventId
      ? { cameraId: event.cameraId, source: event.source, sourceEventId: event.sourceEventId }
      : { cameraId: event.cameraId, source: event.source, normalizedLicensePlate: event.normalizedPlate,
          timestamp: { gte: new Date(event.occurredAt.getTime() - this.options.dedupeWindowMs), lte: new Date(event.occurredAt.getTime() + this.options.dedupeWindowMs) } };
    if (await this.options.prisma.passage.findFirst({ where: duplicateWhere, select: { id: true } })) return { status: "duplicate" };

    const stored: string[] = [];
    try {
      const overviewObjectId = event.overviewImage ? await this.options.storage.storePassageImage(event.overviewImage, event.occurredAt) : undefined;
      if (overviewObjectId) stored.push(overviewObjectId);
      const plateObjectId = event.plateImage ? await this.options.storage.storePassageImage(event.plateImage, event.occurredAt) : undefined;
      if (plateObjectId) stored.push(plateObjectId);
      const camera = await this.options.prisma.camera.findFirst({ where: { id: event.cameraId, active: true }, select: { id: true, location: true, direction: true } });
      if (!camera) throw new Error("CAMERA_NOT_ACTIVE");
      const direction = event.direction ?? camera.direction;
      const passage = await this.options.prisma.$transaction(async (tx) => {
        const created = await tx.passage.create({ data: {
          cameraId: camera.id, timestamp: event.occurredAt, location: camera.location, direction,
          originalLicensePlate: event.originalPlate, normalizedLicensePlate: event.normalizedPlate,
          displayLicensePlate: displayLicensePlate(event.originalPlate), plateConfidence: event.confidence,
          plateCountry: event.plateCountry, vehicleType: event.vehicleType ?? "UNKNOWN",
          vehicleColor: event.vehicleColor ?? "UNKNOWN", vehicleBrand: event.vehicleBrand, lane: event.lane,
          vehicleImage1ObjectId: overviewObjectId, plateImageObjectId: plateObjectId,
          source: "DAHUA_CAMERA", sourceEventId: event.sourceEventId,
          rawEventMetadata: event.rawMetadata as Prisma.InputJsonValue | undefined,
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
        await tx.camera.update({ where: { id: camera.id }, data: {
          lastVehicleRegistrationAt: event.occurredAt, lastAnprEventAt: event.occurredAt,
          anprConnectionStatus: "CONNECTED", lastAnprErrorCode: null, lastAnprError: null
        } });
        return created;
      });
      this.options.logger.info(`[dahua-anpr] passage stored: camera=${event.cameraId} plate=${redactPlate(event.originalPlate)}`);
      return { status: "stored", id: passage.id };
    } catch (error) {
      await Promise.allSettled(stored.map((objectId) => this.options.storage.delete(objectId)));
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "duplicate" };
      throw error;
    }
  }
}
