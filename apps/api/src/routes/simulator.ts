import { normalizeDirection, resolveTimeZone } from "@anpr/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { calculatePassageExpiry, displayLicensePlate, normalizeLicensePlate, PERMISSIONS } from "@anpr/shared";
import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { detectAndCreateHit } from "../lib/hit-detection.js";
import { prisma } from "../lib/prisma.js";

const schema = z.object({
  cameraId: z.string().uuid(), licensePlate: z.string().trim().min(2).max(20).default("12-ABC-3"),
  vehicleColor: z.enum(["BLACK", "WHITE", "GRAY", "SILVER", "RED", "BLUE", "GREEN", "YELLOW", "BROWN", "ORANGE", "OTHER", "UNKNOWN"]).default("BLACK"),
  vehicleType: z.enum(["CAR", "VAN", "TRUCK", "MOTORCYCLE", "BUS", "TRAILER", "UNKNOWN"]).default("CAR"),
  timestamp: z.string().datetime().optional(), sendPush: z.boolean().default(false),
  direction: z.enum(["INCOMING", "OUTGOING", "UNKNOWN", "BOTH"]).optional()
});

export async function simulatorRoutes(app: FastifyInstance) {
  app.get("/simulator", { preHandler: requirePermission(PERMISSIONS.SIMULATOR_RUN) }, async () => ({
    enabled: config.DEMO_MODE,
    // Dynamisch uit de echte cameradatabase: elke actieve camera is beschikbaar, ook
    // handmatig toegevoegde; uitgeschakelde camera's zijn niet selecteerbaar.
    cameras: config.DEMO_MODE ? await prisma.camera.findMany({
      where: { active: true, isDraft: false, archivedAt: null },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, location: true, vpnLocation:{select:{timezone:true}} }
    }).then(cameras=>cameras.map(({vpnLocation,...camera})=>({...camera,timeZone:resolveTimeZone(vpnLocation?.timezone,config.PLATFORM_TIMEZONE)}))) : []
  }));

  app.post("/simulator/passages", { preHandler: requirePermission(PERMISSIONS.SIMULATOR_RUN) }, async (request, reply) => {
    if (!config.DEMO_MODE) return reply.code(404).send({ error: "DEMO_DISABLED", message: "De demo/simulator is uitgeschakeld." });
    const body = schema.parse(request.body);
    const camera = await prisma.camera.findUnique({ where: { id: body.cameraId } });
    if (!camera) return reply.code(404).send({ error: "CAMERA_NOT_FOUND", message: "De gekozen camera bestaat niet (meer). Ververs de camerakeuze." });
    if (!camera.active || camera.isDraft || camera.archivedAt) return reply.code(400).send({ error: "CAMERA_INACTIVE", message: "De gekozen camera is uitgeschakeld en kan niet worden gebruikt voor een demopassage." });
    const normalized = normalizeLicensePlate(body.licensePlate);
    const timestamp = body.timestamp ? new Date(body.timestamp) : new Date();
    const direction = normalizeDirection(body.direction ?? camera.direction);
    const region=camera.locationId?await prisma.vpnLocation.findUnique({where:{id:camera.locationId},select:{timezone:true}}):null;
    const timezone=resolveTimeZone(region?.timezone,config.PLATFORM_TIMEZONE);
    const expiresAt = calculatePassageExpiry(timestamp);
    const passage = await prisma.$transaction(async (tx) => {
      const created = await tx.passage.create({ data: {
        originalLicensePlate: body.licensePlate, normalizedLicensePlate: normalized,
        displayLicensePlate: displayLicensePlate(body.licensePlate), plateConfidence: 0.98,
        timestamp, timezone, cameraId: camera.id, location: camera.location, direction,
        vehicleColor: body.vehicleColor, vehicleType: body.vehicleType, vehicleConfidence: 0.95,
        isHit: false, source: "DEMO", expiresAt,
        vehicle: { create: { type: body.vehicleType, color: body.vehicleColor, confidence: 0.95, metadata: { demo: true } } },
        plateDetections: { create: { rawLicensePlate: body.licensePlate, normalizedLicensePlate: normalized, confidence: 0.98 } }
      }});
      const hit = await detectAndCreateHit(tx, {
        passageId: created.id, cameraId: camera.id, normalizedLicensePlate: normalized,
        location: camera.location, timestamp, direction, source: "DEMO", sendPush: body.sendPush
      });
      await tx.camera.update({ where: { id: camera.id }, data: { lastVehicleRegistrationAt: timestamp } });
      return { passage: { ...created, isHit: Boolean(hit) }, hit };
    });
    await audit(request, "DEMO_PASSAGE_CREATED", { objectType: "Passage", objectId: passage.passage.id, metadata: { cameraId: camera.id, isHit: Boolean(passage.hit) } });
    return reply.code(201).send({ passage: { ...passage.passage, timeZone:timezone, isHit: Boolean(passage.hit), demo: true }, hit: Boolean(passage.hit), matchedGroups: passage.hit?.groups ?? [] });
  });
}
