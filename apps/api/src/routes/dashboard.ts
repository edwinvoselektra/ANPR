import { historicalCamera } from "../lib/historical-camera.js";
import type { FastifyInstance } from "fastify";
import { PERMISSIONS } from "@anpr/shared";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/dashboard", { preHandler: requirePermission(PERMISSIONS.PASSAGES_VIEW) }, async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [cameraTotal, cameraOnline, passagesToday, hitsToday, watchedPlates, recentPassages, recentHits, cameraProblems] = await Promise.all([
      prisma.camera.count({ where: { active: true } }),
      prisma.camera.count({ where: { active: true, status: "ONLINE" } }),
      prisma.passage.count({ where: { timestamp: { gte: start }, status: "ACTIVE" } }),
      prisma.hit.count({ where: { timestamp: { gte: start } } }),
      prisma.plateGroupMember.findMany({ where: { active: true, group: { active: true, hitEnabled: true } }, distinct: ["normalizedLicensePlate"], select: { normalizedLicensePlate: true } }),
      prisma.passage.findMany({ where: { status: "ACTIVE" }, take: 8, orderBy: { timestamp: "desc" }, include: { camera: { select: { name: true, historicalName: true } } } }),
      prisma.hit.findMany({ take: 5, orderBy: { timestamp: "desc" }, include: { camera: { select: { name: true, historicalName: true } }, group: { select: { name: true, color: true } } } }),
      prisma.camera.findMany({ where: { active: true, status: { in: ["OFFLINE", "CONNECTION_PROBLEM", "ANPR_UNAVAILABLE"] } }, select: { id: true, name: true, status: true, lastConnectionError: true } })
    ]);
    return { counters: { cameraTotal, cameraOnline, passagesToday, hitsToday, watchedPlates: watchedPlates.length }, recentPassages: recentPassages.map(historicalCamera), recentHits: recentHits.map(historicalCamera), cameraProblems };
  });
}
