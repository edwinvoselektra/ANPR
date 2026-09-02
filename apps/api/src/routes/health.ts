import type { FastifyInstance } from "fastify";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { Redis } from "ioredis";
import { PERMISSIONS, VIDEO_WORKER_HEARTBEAT_KEY, VIDEO_WORKER_HEARTBEAT_STALE_MS } from "@anpr/shared";
import { config } from "../config.js";
import { requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

async function commandExists(command: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, ["-version"], { stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

type ServiceStatus = { status: string; message?: string };

export function videoWorkerStatus(rawHeartbeat: string | null, now = Date.now()): ServiceStatus {
  if (!rawHeartbeat) return { status: "unhealthy", message: "Geen recente heartbeat van de video-worker ontvangen." };
  try {
    const value = JSON.parse(rawHeartbeat) as { timestamp?: unknown; running?: unknown; managedCameras?: unknown };
    const timestamp = typeof value.timestamp === "string" ? Date.parse(value.timestamp) : Number.NaN;
    if (!Number.isFinite(timestamp) || now - timestamp > VIDEO_WORKER_HEARTBEAT_STALE_MS || value.running !== true) {
      return { status: "unhealthy", message: "De video-worker heeft geen actuele heartbeat." };
    }
    const count = typeof value.managedCameras === "number" ? value.managedCameras : 0;
    return { status: "healthy", message: `${count} actieve camera${count === 1 ? "" : "'s"} in beheer.` };
  } catch {
    return { status: "unhealthy", message: "De heartbeat van de video-worker is ongeldig." };
  }
}

async function checks() {
  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2_000 });
  const status: Record<string, ServiceStatus> = {};
  let workerHeartbeat: string | null = null;
  try { await prisma.$queryRaw`SELECT 1`; status.database = { status: "healthy" }; } catch { status.database = { status: "unhealthy", message: "PostgreSQL is niet bereikbaar." }; }
  try {
    await redis.connect();
    await redis.ping();
    workerHeartbeat = await redis.get(VIDEO_WORKER_HEARTBEAT_KEY);
    status.redis = { status: "healthy" };
  } catch {
    status.redis = { status: "unhealthy", message: "Redis is niet bereikbaar." };
  } finally { redis.disconnect(); }
  try { await mkdir(config.STORAGE_PATH, { recursive: true }); await access(config.STORAGE_PATH, constants.R_OK | constants.W_OK); status.storage = { status: "healthy" }; } catch { status.storage = { status: "unhealthy", message: "Opslag is niet leesbaar/schrijfbaar." }; }
  status.ffmpeg = { status: await commandExists("ffmpeg") ? "healthy" : "unhealthy" };
  status.videoWorker = videoWorkerStatus(workerHeartbeat);
  status.anprWorker = { status: "not_implemented", message: "TODO Fase 2.2" };
  return status;
}

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok", service: "anpr-api", timestamp: new Date().toISOString() }));
  app.get("/health/ready", async (_request, reply) => {
    const services = await checks();
    const ready = ["database", "redis", "storage", "ffmpeg"].every((key) => services[key]?.status === "healthy");
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "degraded", services });
  });
  app.get("/system/status", { preHandler: requirePermission(PERMISSIONS.SYSTEM_VIEW) }, async () => {
    const [services, cameras] = await Promise.all([
      checks(),
      prisma.camera.findMany({
        select: {
          id: true, name: true, location: true, active: true, status: true,
          lastConnectionAt: true, lastConnectionSuccessAt: true, lastConnectionErrorCode: true
        },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
      })
    ]);
    return { services, cameras, demoMode: config.DEMO_MODE, version: "0.2.1" };
  });
}
