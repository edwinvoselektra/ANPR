import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { calculatePassageExpiry, displayLicensePlate, normalizeLicensePlate, PERMISSIONS, shouldCreateHit } from "@anpr/shared";
import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const schema = z.object({
  cameraId: z.string().uuid(), licensePlate: z.string().trim().min(2).max(20).default("12-ABC-3"),
  vehicleColor: z.enum(["BLACK", "WHITE", "GRAY", "SILVER", "RED", "BLUE", "GREEN", "YELLOW", "BROWN", "ORANGE", "OTHER", "UNKNOWN"]).default("BLACK"),
  vehicleType: z.enum(["CAR", "VAN", "TRUCK", "MOTORCYCLE", "BUS", "TRAILER", "UNKNOWN"]).default("CAR")
});

export async function simulatorRoutes(app: FastifyInstance) {
  app.get("/simulator", { preHandler: requirePermission(PERMISSIONS.SIMULATOR_RUN) }, async () => ({
    enabled: config.DEMO_MODE,
    cameras: config.DEMO_MODE ? await prisma.camera.findMany({ where: { name: { in: ["Uddel Noord", "Uddel Oost", "Uddel West"] } }, select: { id: true, name: true, location: true } }) : []
  }));

  app.post("/simulator/passages", { preHandler: requirePermission(PERMISSIONS.SIMULATOR_RUN) }, async (request, reply) => {
    if (!config.DEMO_MODE) return reply.code(404).send({ error: "DEMO_DISABLED", message: "De demo/simulator is uitgeschakeld." });
    const body = schema.parse(request.body);
    const camera = await prisma.camera.findUniqueOrThrow({ where: { id: body.cameraId } });
    const normalized = normalizeLicensePlate(body.licensePlate);
    const groupMember = await prisma.plateGroupMember.findFirst({
      where: { normalizedLicensePlate: normalized, active: true, group: { active: true } },
      include: { group: true }
    });
    const timestamp = new Date();
    const matchedMember = groupMember && shouldCreateHit({ active: groupMember.active, groupActive: groupMember.group.active, validFrom: groupMember.validFrom, validUntil: groupMember.validUntil }, timestamp) ? groupMember : null;
    const expiresAt = calculatePassageExpiry(timestamp);
    const passage = await prisma.$transaction(async (tx) => {
      const created = await tx.passage.create({ data: {
        originalLicensePlate: body.licensePlate, normalizedLicensePlate: normalized,
        displayLicensePlate: displayLicensePlate(body.licensePlate), plateConfidence: 0.98,
        timestamp, cameraId: camera.id, location: camera.location, direction: camera.direction,
        vehicleColor: body.vehicleColor, vehicleType: body.vehicleType, vehicleConfidence: 0.95,
        isHit: Boolean(matchedMember), source: "DEMO", expiresAt,
        vehicle: { create: { type: body.vehicleType, color: body.vehicleColor, confidence: 0.95, metadata: { demo: true } } },
        plateDetections: { create: { rawLicensePlate: body.licensePlate, normalizedLicensePlate: normalized, confidence: 0.98 } }
      }});
      if (matchedMember) await tx.hit.create({ data: {
        passageId: created.id, cameraId: camera.id, groupId: matchedMember.groupId,
        normalizedLicensePlate: normalized, location: camera.location, timestamp,
        reason: matchedMember.reason, notificationStatus: "SKIPPED"
      }});
      await tx.camera.update({ where: { id: camera.id }, data: { lastVehicleRegistrationAt: timestamp } });
      return created;
    });
    await audit(request, "DEMO_PASSAGE_CREATED", { objectType: "Passage", objectId: passage.id, metadata: { cameraId: camera.id, isHit: Boolean(matchedMember) } });
    return reply.code(201).send({ passage: { ...passage, demo: true }, hit: Boolean(matchedMember) });
  });
}
