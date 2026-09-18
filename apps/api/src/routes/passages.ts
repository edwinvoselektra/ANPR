import { historicalCamera } from "../lib/historical-camera.js";
import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { PERMISSIONS } from "@anpr/shared";
import { config } from "../config.js";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const publicSelect = {
  id: true, originalLicensePlate: true, normalizedLicensePlate: true, displayLicensePlate: true,
  plateConfidence: true, plateCountry: true, timestamp: true, timezone: true, location: true, direction: true,
  vehicleColor: true, vehicleType: true, vehicleConfidence: true, vehicleBrand: true, lane: true,
  vehicleImage1ObjectId: true, vehicleImage2ObjectId: true, plateImageObjectId: true, isHit: true, status: true, source: true,
  attentionSnapshot: { select: { id: true, score: true, confidence: true, reasonsJson: true } },
  camera: { select: { id: true, name: true, historicalName: true, location: true, vpnLocation: { select: { timezone: true } } } }
} as const;

export async function passageRoutes(app: FastifyInstance) {
  app.get("/passages", { preHandler: requirePermission(PERMISSIONS.PASSAGES_VIEW) }, async (request, reply) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: z.string().datetime().optional() }).parse(request.query);
    const passages = await prisma.passage.findMany({
      where: { status: { not: "DELETED" }, timestamp: query.before ? { lt: new Date(query.before) } : undefined },
      select: publicSelect, orderBy: [{ timestamp: "desc" }, { id: "desc" }], take: query.limit
    });
    return reply.header("Cache-Control", "private, no-store").send({ passages: passages.map(historicalCamera) });
  });

  app.get("/passages/:id", { preHandler: requirePermission(PERMISSIONS.PASSAGES_VIEW) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const passage = await prisma.passage.findFirst({ where: { id, status: { not: "DELETED" } }, select: publicSelect });
    if (!passage) return reply.code(404).send({ error: "PASSAGE_NOT_FOUND", message: "Deze passage bestaat niet (meer)." });
    return reply.header("Cache-Control", "private, no-store").send({ passage: historicalCamera(passage) });
  });

  app.get("/passages/:id/image/:kind", { preHandler: requirePermission(PERMISSIONS.PASSAGES_VIEW) }, async (request, reply) => {
    const { id, kind } = z.object({ id: z.string().uuid(), kind: z.enum(["overview", "plate", "extra"]) }).parse(request.params);
    const passage = await prisma.passage.findFirst({ where: { id, status: { not: "DELETED" } }, select: { vehicleImage1ObjectId: true, vehicleImage2ObjectId: true, plateImageObjectId: true } });
    if (!passage) return reply.code(404).send({ error: "PASSAGE_NOT_FOUND", message: "Deze passage bestaat niet (meer)." });
    const objectId = kind === "overview" ? passage.vehicleImage1ObjectId : kind === "extra" ? passage.vehicleImage2ObjectId : passage.plateImageObjectId;
    if (!objectId) return reply.code(404).send({ error: "IMAGE_NOT_FOUND", message: "Voor deze passage is deze foto niet beschikbaar." });
    const root = resolve(config.STORAGE_PATH);
    const file = resolve(root, objectId);
    if (!file.startsWith(`${root}${sep}`) || !/^passages\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.jpg$/i.test(objectId)) {
      return reply.code(400).send({ error: "INVALID_OBJECT", message: "Ongeldig opslagobject." });
    }
    const fileStat = await stat(file);
    if (!fileStat.isFile() || fileStat.size > 25_000_000) return reply.code(404).send({ error: "IMAGE_NOT_FOUND", message: "De foto is niet beschikbaar." });
    return reply.type("image/jpeg").header("Cache-Control", "private, max-age=60").send(createReadStream(file));
  });
}
