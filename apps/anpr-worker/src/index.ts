import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { config } from "./config.js";
import { startHealthServer, publishHeartbeat } from "./health.js";
import { PassageService } from "./passage-service.js";
import { DahuaAnprProvider } from "./providers/dahua.js";
import { createCameraRepository } from "./repository.js";
import { LocalStorageProvider } from "./storage.js";
import type { ProviderLogger } from "./types.js";
import { AnprSupervisor } from "./worker.js";
import { AttentionAnalysisService, startAttentionAnalysis } from "./attention-analysis.js";

const prisma = new PrismaClient();
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2_000, enableOfflineQueue: false });
redis.on("error", () => undefined);
const logger: ProviderLogger = {
  info: (message, cameraName) => console.info(message, cameraName ?? ""),
  warn: (message, cameraName) => console.warn(message, cameraName ?? ""),
  error: (message) => console.error(message)
};
const repository = createCameraRepository(prisma);
const storage = new LocalStorageProvider(config.STORAGE_PATH, config.ANPR_MAX_IMAGE_BYTES);
const passages = new PassageService({ prisma, storage, dedupeWindowMs: config.ANPR_DEDUPE_WINDOW_SECONDS * 1_000, logger });
const dahua = new DahuaAnprProvider({ keyHex: config.CAMERA_CREDENTIALS_KEY, timeoutMs: config.ANPR_CONNECT_TIMEOUT_SECONDS * 1_000, maxPartBytes: config.ANPR_MAX_IMAGE_BYTES, logger });
const supervisor = new AnprSupervisor({
  repository, providers: new Map([[dahua.kind, dahua]]), onEvent: async (event) => { await passages.store(event); },
  minRetryMs: config.ANPR_RECONNECT_MIN_SECONDS * 1_000, maxRetryMs: config.ANPR_RECONNECT_MAX_SECONDS * 1_000, logger
});
const attentionAnalysis=new AttentionAnalysisService({prisma,logger});
const stopAttentionAnalysis=startAttentionAnalysis(attentionAnalysis,logger);
let lastDatabaseRefreshAt: string | undefined;
let reconciling = false;
let shuttingDown = false;

async function reconcile() {
  if (reconciling || shuttingDown) return;
  reconciling = true;
  try { await supervisor.reconcile(); lastDatabaseRefreshAt = new Date().toISOString(); }
  catch { logger.error("[anprWorker] active camera refresh failed; existing camera loops continue"); }
  finally { reconciling = false; }
}
function state() {
  const current = supervisor.snapshot();
  const refreshed = lastDatabaseRefreshAt ? Date.parse(lastDatabaseRefreshAt) : Number.NaN;
  return { ...current, running: current.running && Number.isFinite(refreshed) && Date.now() - refreshed <= config.ANPR_CAMERA_REFRESH_SECONDS * 3_000, lastDatabaseRefreshAt };
}

await reconcile();
const healthServer = await startHealthServer(config.ANPR_WORKER_PORT, state);
const refreshTimer = setInterval(() => void reconcile(), config.ANPR_CAMERA_REFRESH_SECONDS * 1_000);
const heartbeat = async () => { try { await publishHeartbeat(redis, state()); } catch { logger.error("[anprWorker] Redis heartbeat failed; event processing continues"); } };
await heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), 5_000);
logger.info("[anprWorker] started");

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true; clearInterval(refreshTimer); clearInterval(heartbeatTimer);
  stopAttentionAnalysis();
  await supervisor.stop(); await new Promise<void>((resolve) => healthServer.close(() => resolve()));
  redis.disconnect(); await prisma.$disconnect();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
