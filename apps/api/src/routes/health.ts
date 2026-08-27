import type { FastifyInstance } from "fastify";
import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { Redis } from "ioredis";
import { PERMISSIONS } from "@anpr/shared";
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

async function checks() {
  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2_000 });
  const status: Record<string, { status: string; message?: string }> = {};
  try { await prisma.$queryRaw`SELECT 1`; status.database = { status: "healthy" }; } catch { status.database = { status: "unhealthy", message: "PostgreSQL is niet bereikbaar." }; }
  try { await redis.connect(); await redis.ping(); status.redis = { status: "healthy" }; } catch { status.redis = { status: "unhealthy", message: "Redis is niet bereikbaar." }; } finally { redis.disconnect(); }
  try { await mkdir(config.STORAGE_PATH, { recursive: true }); await access(config.STORAGE_PATH, constants.R_OK | constants.W_OK); status.storage = { status: "healthy" }; } catch { status.storage = { status: "unhealthy", message: "Opslag is niet leesbaar/schrijfbaar." }; }
  status.ffmpeg = { status: await commandExists("ffmpeg") ? "healthy" : "unhealthy" };
  status.videoWorker = { status: "not_implemented", message: "TODO Fase 2" };
  status.anprWorker = { status: "not_implemented", message: "TODO Fase 2" };
  return status;
}

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok", service: "anpr-api", timestamp: new Date().toISOString() }));
  app.get("/health/ready", async (_request, reply) => {
    const services = await checks();
    const ready = ["database", "redis", "storage", "ffmpeg"].every((key) => services[key]?.status === "healthy");
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ready" : "degraded", services });
  });
  app.get("/system/status", { preHandler: requirePermission(PERMISSIONS.SYSTEM_VIEW) }, async () => ({ services: await checks(), demoMode: config.DEMO_MODE, version: "0.1.0" }));
}
