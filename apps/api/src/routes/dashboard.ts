import { historicalCamera } from "../lib/historical-camera.js";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { PERMISSIONS } from "@anpr/shared";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { applicationDay } from "../lib/application-time.js";
import { hitGroupSelect, publicHit } from "../lib/public-hit.js";

export async function loadDashboard(db: PrismaClient = prisma, now = new Date()) {
  const day = applicationDay(now);
  const timestamp = { gte: day.start, lt: day.end };
  const passageWhere = { timestamp, status: "ACTIVE" as const };
  // Same Hit source, day and database snapshot for the tile and list. No re-matching current rules.
  const hitWhere = { timestamp };
  const [cameraTotal, cameraOnline, passagesToday, hitsToday, watchedPlates, recentPassages, recentHits, cameraProblems, demoPassagesToday, demoHitsToday] = await db.$transaction(async tx => Promise.all([
    tx.camera.count({ where: { active: true, isDraft: false, archivedAt: null } }),
    tx.camera.count({ where: { active: true, isDraft: false, archivedAt: null, status: "ONLINE" } }),
    tx.passage.count({ where: passageWhere }),
    tx.hit.count({ where: hitWhere }),
    tx.plateGroupMember.findMany({ where: { active: true, group: { active: true, hitEnabled: true } }, distinct: ["normalizedLicensePlate"], select: { normalizedLicensePlate: true } }),
    tx.passage.findMany({ where: { status: "ACTIVE" }, take: 8, orderBy: [{ timestamp: "desc" }, { id: "desc" }], include: { camera: { select: { name: true, historicalName: true, vpnLocation: { select: { timezone: true } } } } } }),
    tx.hit.findMany({ where: hitWhere, take: 5, orderBy: [{ timestamp: "desc" }, { id: "desc" }], include: {
      camera: { select: { name: true, historicalName: true, vpnLocation: { select: { timezone: true } } } }, group: { select: hitGroupSelect },
      groups: { include: { group: { select: hitGroupSelect } }, orderBy: { group: { name: "asc" } } },
      passage: { select: { displayLicensePlate: true, source: true, direction: true, timezone: true } }
    } }),
    tx.camera.findMany({ where: { active: true, isDraft: false, archivedAt: null, status: { in: ["OFFLINE", "CONNECTION_PROBLEM", "ANPR_UNAVAILABLE"] } }, select: { id: true, name: true, status: true, lastConnectionError: true } }),
    tx.passage.count({ where: { ...passageWhere, source: "DEMO" } }),
    tx.hit.count({ where: { ...hitWhere, passage: { source: "DEMO" } } })
  ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return { counters: { cameraTotal, cameraOnline, passagesToday, hitsToday, watchedPlates: watchedPlates.length, demoPassagesToday, demoHitsToday },
    recentPassages: recentPassages.map(historicalCamera), recentHits: recentHits.map(publicHit), cameraProblems,
    day: { start: day.start.toISOString(), end: day.end.toISOString(), timeZone: day.timeZone }, updatedAt: now.toISOString(), includesDemo: true };
}
export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", { preHandler: requirePermission(PERMISSIONS.PASSAGES_VIEW) }, async (_request, reply) =>
    reply.header("Cache-Control", "private, no-store").send(await loadDashboard()));
}
