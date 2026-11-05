import { Prisma, type PrismaClient } from "@prisma/client";
import { lstat, realpath, statfs, unlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { z } from "zod";

const day = 86_400_000;
const gib = 1024 ** 3;
export const retentionSchema = z.object({
  RETENTION_ENABLED: z.enum(["true", "false"]).default("false"),
  RETENTION_DRY_RUN: z.enum(["true", "false"]).default("true"),
  RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  RETENTION_PRESSURE_ENABLED: z.enum(["true", "false"]).default("false"),
  RETENTION_MIN_FREE_GIB: z.coerce.number().min(1).max(100000).default(10),
  RETENTION_TARGET_FREE_GIB: z.coerce.number().min(1).max(100000).default(15),
  RETENTION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  RETENTION_MAX_BATCHES: z.coerce.number().int().min(1).max(100).default(10),
  RETENTION_INTERVAL_SECONDS: z.coerce.number().int().min(60).max(86400).default(300),
}).refine(c => c.RETENTION_TARGET_FREE_GIB > c.RETENTION_MIN_FREE_GIB, "Doelbuffer moet groter zijn dan ondergrens");
export type RetentionConfig = z.infer<typeof retentionSchema>;

// Object keys are generated UUIDs. Reject arbitrary files, traversal and symlinks.
export async function deleteRetentionImage(rootPath: string, objectId: string) {
  if (!/^passages\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/i.test(objectId)) throw new Error("UNSAFE_RETENTION_OBJECT");
  const root = await realpath(rootPath);
  const file = resolve(root, ...objectId.split("/"));
  try {
    // Check every ancestor, including links which happen to point inside root.
    let parent = dirname(file);
    while (parent !== root) {
      if (!parent.startsWith(root + sep) || (await lstat(parent)).isSymbolicLink()) throw new Error("UNSAFE_RETENTION_PATH");
      parent = dirname(parent);
    }
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("UNSAFE_RETENTION_FILE");
    await unlink(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function freeBytes(root: string) {
  const fs = await statfs(root, { bigint: true });
  return Number(fs.bavail * fs.bsize);
}

type Candidate = { id: string; vehicleImage1ObjectId: string | null; vehicleImage2ObjectId: string | null; plateImageObjectId: string | null };
export function candidateWhere(now: Date, days: number, pressure: boolean): Prisma.PassageWhereInput {
  return {
    // Existing 14-day expiresAt values must not accidentally defeat the 90-day policy.
    ...(pressure ? {} : { timestamp: { lte: new Date(now.getTime() - days * day) } }),
    isHit: false, hits: { none: {} },
    // Conservative: every recorded exception stays protected until reviewed.
    retentionExceptions: { none: {} },
  };
}

export class RetentionService {
  private underPressure = false;
  constructor(private db: PrismaClient, private root: string, private config: RetentionConfig,
    private report: (value: Record<string, unknown>) => void,
    private available = freeBytes, private remove = deleteRetentionImage) {}

  private pressure(free: number) {
    if (this.config.RETENTION_PRESSURE_ENABLED !== "true" || free >= this.config.RETENTION_TARGET_FREE_GIB * gib) this.underPressure = false;
    else if (free < this.config.RETENTION_MIN_FREE_GIB * gib) this.underPressure = true;
    return this.underPressure;
  }

  private async candidates(tx: Prisma.TransactionClient, now: Date, pressure: boolean) {
    return tx.passage.findMany({ where: candidateWhere(now, this.config.RETENTION_DAYS, pressure),
      orderBy: [{ timestamp: "asc" }, { id: "asc" }], take: this.config.RETENTION_BATCH_SIZE,
      select: { id: true, vehicleImage1ObjectId: true, vehicleImage2ObjectId: true, plateImageObjectId: true } });
  }

  private async enqueue(now: Date, pressure: boolean) {
    return this.db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
      // Blocks concurrent new hits, exceptions and image references during selection.
      // NOWAIT is intentional: yield to ingest rather than queue behind busy tables.
      await tx.$executeRaw`LOCK TABLE "Camera", "Passage", "Hit", "PlateDetection", "RetentionException", "RetentionImageDeletion" IN SHARE ROW EXCLUSIVE MODE NOWAIT`;
      const rows: Candidate[] = await this.candidates(tx, now, pressure);
      if (!rows.length) return 0;
      const detections = await tx.plateDetection.findMany({ where: { passageId: { in: rows.map(r => r.id) } }, select: { frameObjectId: true } });
      const objects = new Set([...rows.flatMap(r => [r.vehicleImage1ObjectId, r.vehicleImage2ObjectId, r.plateImageObjectId]), ...detections.map(d => d.frameObjectId)].filter((id): id is string => Boolean(id)));
      for (const object of objects) {
        await tx.$executeRaw`INSERT INTO "RetentionImageDeletion" ("objectId") VALUES (${object}) ON CONFLICT DO NOTHING`;
      }
      await tx.passage.deleteMany({ where: { id: { in: rows.map(r => r.id) } } });
      return rows.length;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
  }

  private async images() {
    // Durable tombstones prohibit adding new references before any filesystem work.
    // Shared images stay queued while any surviving record still references them.
    const objects = await this.db.$queryRaw<{ objectId: string }[]>`
      SELECT q."objectId" FROM "RetentionImageDeletion" q
      WHERE q."completedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Passage" p WHERE q."objectId" IN (p."vehicleImage1ObjectId", p."vehicleImage2ObjectId", p."plateImageObjectId"))
      AND NOT EXISTS (SELECT 1 FROM "PlateDetection" p WHERE p."frameObjectId" = q."objectId")
      AND NOT EXISTS (SELECT 1 FROM "Hit" h WHERE q."objectId" IN (h."vehicleImageObjectId", h."plateImageObjectId"))
      AND NOT EXISTS (SELECT 1 FROM "Camera" c WHERE c."lastSnapshotObjectId" = q."objectId")
      ORDER BY q."lastAttemptAt" ASC NULLS FIRST, q."createdAt", q."objectId" LIMIT ${this.config.RETENTION_BATCH_SIZE}`;
    let deleted = 0;
    for (const { objectId } of objects) {
      try {
        await this.remove(this.root, objectId);
        await this.db.$executeRaw`UPDATE "RetentionImageDeletion" SET "completedAt" = now(), "lastAttemptAt" = now(), "lastError" = NULL WHERE "objectId" = ${objectId}`;
        deleted++;
      } catch {
        await this.db.$executeRaw`UPDATE "RetentionImageDeletion" SET "lastAttemptAt" = now(), "lastError" = 'IMAGE_DELETE_FAILED' WHERE "objectId" = ${objectId}`;
        this.report({ event: "retention.image_failed" });
      }
    }
    return deleted;
  }

  async run(now = new Date()) {
    const c = this.config;
    if (c.RETENTION_ENABLED !== "true") return;
    let free = await this.available(this.root);
    let pressure = this.pressure(free);
    if (c.RETENTION_DRY_RUN === "true") {
      const rows = await this.candidates(this.db, now, pressure);
      this.report({ event: "retention.preview", candidates: rows.length, sampleOnly: true, pressure, freeBytes: free });
      return;
    }
    let passages = 0, images = 0;
    for (let batch = 0; batch < c.RETENTION_MAX_BATCHES; batch++) {
      images += await this.images();
      free = await this.available(this.root);
      pressure = this.pressure(free);
      const count = await this.enqueue(now, pressure);
      passages += count;
      images += await this.images();
      free = await this.available(this.root);
      pressure = this.pressure(free);
      if (!count && !pressure) break;
      if (!count && pressure) { this.report({ event: "retention.insufficient_reclaimable_space", freeBytes: free }); break; }
    }
    this.report({ event: "retention.completed", passages, images, freeBytes: free, bufferUnmet: pressure });
  }
}

export function startRetention(service: RetentionService, config: RetentionConfig, report: (value: Record<string, unknown>) => void) {
  let running: Promise<void> | undefined;
  const tick = () => {
    if (!running) running = service.run().catch(() => { report({ event: "retention.failed" }); }).finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, config.RETENTION_INTERVAL_SECONDS * 1000);
  tick();
  return async () => { clearInterval(timer); await running; };
}
