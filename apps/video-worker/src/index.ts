import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { createFrameCapture } from "./capture.js";
import { startHealthServer, publishHeartbeat } from "./health.js";
import { createCameraRepository } from "./repository.js";
import { CameraSupervisor } from "./worker.js";
import type { WorkerLogger } from "./types.js";

const prisma = new PrismaClient();
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2_000, enableOfflineQueue: false });
redis.on("error", () => undefined);
const logger: WorkerLogger = {
  info: (message, cameraName) => console.info(message, cameraName ?? ""),
  warn: (message, cameraName) => console.warn(message, cameraName ?? ""),
  error: (message) => console.error(message)
};
const repository = createCameraRepository(prisma);
const supervisor = new CameraSupervisor({
  repository,
  capture: createFrameCapture({ storagePath: config.STORAGE_PATH, keyHex: config.CAMERA_CREDENTIALS_KEY, timeoutMs: config.VIDEO_CAPTURE_TIMEOUT_SECONDS * 1000 }),
  sampleIntervalMs: Math.max(1_000, Math.round(1_000 / config.VIDEO_SAMPLE_FPS)),
  retryIntervalMs: config.VIDEO_RETRY_SECONDS * 1000,
  logger
});
let lastDatabaseRefreshAt: string | undefined;
let reconciling = false;
let shuttingDown = false;

async function reconcile() {
  if (reconciling || shuttingDown) return;
  reconciling = true;
  try {
    await supervisor.reconcile();
    lastDatabaseRefreshAt = new Date().toISOString();
  } catch {
    logger.error("[videoWorker] active camera refresh failed; existing camera loops continue");
  } finally { reconciling = false; }
}

function state() {
  const supervisorState = supervisor.snapshot();
  const lastRefresh = lastDatabaseRefreshAt ? Date.parse(lastDatabaseRefreshAt) : Number.NaN;
  const databaseCurrent = Number.isFinite(lastRefresh)
    && Date.now() - lastRefresh <= config.VIDEO_CAMERA_REFRESH_SECONDS * 3_000;
  return { ...supervisorState, running: supervisorState.running && databaseCurrent, lastDatabaseRefreshAt };
}

await reconcile();
const healthServer = await startHealthServer(config.VIDEO_WORKER_PORT, state);
const refreshTimer = setInterval(() => void reconcile(), config.VIDEO_CAMERA_REFRESH_SECONDS * 1000);
const heartbeat = async () => {
  try { await publishHeartbeat(redis, state()); }
  catch { logger.error("[videoWorker] Redis heartbeat failed; camera processing continues"); }
};
await heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), 5_000);
logger.info("[videoWorker] started");

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(refreshTimer);
  clearInterval(heartbeatTimer);
  await supervisor.stop();
  await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  redis.disconnect();
  await prisma.$disconnect();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
