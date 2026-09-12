import { hitGroupSelect as groupSelect, publicHit } from "../lib/public-hit.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PERMISSIONS } from "@anpr/shared";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

const hitInclude = {
  camera: { select: { id: true, name: true, historicalName: true, location: true } },
  group: { select: groupSelect },
  groups: { include: { group: { select: groupSelect } }, orderBy: { group: { name: "asc" as const } } },
  passage: { select: {
    id: true, displayLicensePlate: true, originalLicensePlate: true, normalizedLicensePlate: true,
    timestamp: true, location: true, direction: true, source: true, plateConfidence: true,
    vehicleColor: true, vehicleType: true, vehicleBrand: true,
    vehicleImage1ObjectId: true, vehicleImage2ObjectId: true, plateImageObjectId: true, rawEventMetadata: true, createdAt: true
  } }
} as const;

export async function hitRoutes(app: FastifyInstance) {
  app.get("/hits", { preHandler: requirePermission(PERMISSIONS.HITS_VIEW) }, async (request, reply) => {
    const query = z.object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25)
    }).parse(request.query);
    const [hits, total] = await Promise.all([
      prisma.hit.findMany({ include: hitInclude, orderBy: [{ timestamp: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit }),
      prisma.hit.count()
    ]);
    return reply.header("Cache-Control", "private, no-store").send({ hits: hits.map(publicHit), page: query.page, limit: query.limit, total });
  });

  app.get("/hits/:id", { preHandler: requirePermission(PERMISSIONS.HITS_VIEW) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const hit = await prisma.hit.findUnique({ where: { id }, include: hitInclude });
    if (!hit) return reply.code(404).send({ error: "HIT_NOT_FOUND", message: "Deze hit bestaat niet (meer)." });
    return reply.header("Cache-Control", "private, no-store").send({ hit: publicHit(hit) });
  });
}
