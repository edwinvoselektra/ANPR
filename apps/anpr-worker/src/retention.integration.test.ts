import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { RetentionService, retentionSchema } from "./retention.js";

// Never run against production or a reused application database.
const url = process.env.RETENTION_TEST_DATABASE_URL;
if (url && (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !/^\/anpr_retention_test_[a-z0-9_]+$/.test(new URL(url).pathname))) throw new Error("Unsafe retention test database");

describe.skipIf(!url)("PostgreSQL retention integration", () => {
  it("previews without mutation, deletes oldest timestamp then id, and removes every associated image", async () => {
    const db = new PrismaClient({ datasourceUrl: url });
    const root = await mkdtemp(join(tmpdir(), "anpr-retention-fifo-"));
    const now = new Date("2026-10-28T12:00:00Z");
    const keys = Array.from({ length: 6 }, () => `passages/2025/11/${randomUUID()}.jpg`);
    try {
      await mkdir(join(root, "passages/2025/11"), { recursive: true });
      for (const key of keys) await writeFile(join(root, key), "synthetic FIFO image");
      const camera = await db.camera.create({ data: { name: randomUUID(), location: "synthetic FIFO", direction: "BOTH" } });
      const create = (id: string, timestamp: Date, image: string) => db.passage.create({ data: {
        id, cameraId: camera.id, originalLicensePlate: "SYNTHETIC", normalizedLicensePlate: "SYNTHETIC", displayLicensePlate: "SYNTHETIC",
        location: "synthetic FIFO", direction: "UNKNOWN", timestamp, expiresAt: new Date("2025-11-20"), vehicleImage1ObjectId: image,
      } });
      const ids = [randomUUID(), randomUUID()].sort();
      // Insert out of FIFO order and use a tied timestamp to exercise the id tiebreaker.
      const newer = await create(randomUUID(), new Date("2025-11-02"), keys[4]!);
      const second = await create(ids[1]!, new Date("2025-11-01"), keys[5]!);
      const first = await create(ids[0]!, new Date("2025-11-01"), keys[0]!);
      await db.passage.update({ where: { id: first.id }, data: { plateImageObjectId: keys[1], vehicleImage2ObjectId: keys[2] } });
      await db.plateDetection.create({ data: { passageId: first.id, rawLicensePlate: "SYNTHETIC", normalizedLicensePlate: "SYNTHETIC", confidence: 1, frameObjectId: keys[3] } });
      const config = retentionSchema.parse({ RETENTION_ENABLED: "true", RETENTION_DRY_RUN: "false", RETENTION_BATCH_SIZE: "1", RETENTION_MAX_BATCHES: "1" });
      const report = () => {};
      const available = async () => 20 * 1024 ** 3;
      for (const overrides of [{ RETENTION_ENABLED: "false" }, { RETENTION_DRY_RUN: "true" }] as const) {
        await new RetentionService(db, root, { ...config, ...overrides }, report, available).run(now);
        expect(await db.passage.count({ where: { cameraId: camera.id } })).toBe(3);
        expect(await db.retentionImageDeletion.count({ where: { objectId: { in: keys } } })).toBe(0);
        for (const key of keys) expect(await readFile(join(root, key), "utf8")).toBe("synthetic FIFO image");
      }
      const service = new RetentionService(db, root, config, report, available);
      for (const [index, expected] of [first, second, newer].entries()) {
        await service.run(now);
        expect(await db.passage.findUnique({ where: { id: expected.id } })).toBeNull();
        expect(await db.passage.count({ where: { cameraId: camera.id } })).toBe(2 - index);
        if (index === 0) {
          expect(await db.retentionImageDeletion.count({ where: { objectId: { in: keys.slice(0, 4) } } })).toBe(4);
          expect(await db.plateDetection.count({ where: { passageId: first.id } })).toBe(0);
          for (const key of keys.slice(4)) expect(await readFile(join(root, key), "utf8")).toBe("synthetic FIFO image");
        }
      }
      // File batches are bounded too; finish the remaining durable jobs.
      for (let attempt = 0; attempt < keys.length; attempt++) {
        if (!await db.retentionImageDeletion.count({ where: { objectId: { in: keys }, completedAt: null } })) break;
        await service.run(now);
      }
      expect(await db.retentionImageDeletion.count({ where: { objectId: { in: keys }, completedAt: { not: null } } })).toBe(keys.length);
      for (const key of keys) await expect(readFile(join(root, key))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await db.$disconnect(); await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("migrates, protects references, retries after failure and rejects concurrent reuse", async () => {
    const db = new PrismaClient({ datasourceUrl: url });
    const writer = new PrismaClient({ datasourceUrl: url });
    const root = await mkdtemp(join(tmpdir(), "anpr-retention-db-"));
    const now = new Date("2026-10-28T12:00:00Z");
    const key = `passages/2026/01/${randomUUID()}.jpg`;
    const key2 = `passages/2026/01/${randomUUID()}.jpg`;
    await mkdir(join(root, "passages/2026/01"), { recursive: true });
    await writeFile(join(root, key), "synthetic shared image");
    await writeFile(join(root, key2), "synthetic protected image");
    try {
      const camera = await db.camera.create({ data: { name: randomUUID(), location: "synthetic", direction: "BOTH" } });
      const passage = async (timestamp: Date, image: string, isHit = false) => db.passage.create({ data: {
        cameraId: camera.id, originalLicensePlate: "SYNTHETIC", normalizedLicensePlate: "SYNTHETIC", displayLicensePlate: "SYNTHETIC",
        location: "synthetic", direction: "UNKNOWN", timestamp, expiresAt: new Date(timestamp.getTime() + 14 * 86400000), vehicleImage1ObjectId: image, isHit,
      } });
      const old = await passage(new Date("2026-01-01"), key);
      const young = await passage(new Date("2026-10-27"), key);
      const protectedPassage = await passage(new Date("2026-01-02"), key2, true);
      const exception = await passage(new Date("2026-01-04"), key2);
      const identity = randomUUID();
      const user = await db.user.create({ data: { username: identity, email: `${identity}@example.invalid`, displayName: "Synthetic", passwordHash: "unused-test-only" } });
      await db.retentionException.create({ data: { passageId: exception.id, userId: user.id, reason: "Synthetic preservation", originalExpiresAt: exception.expiresAt, newExpiresAt: new Date("2027-01-01") } });
      const actualHit = await passage(new Date("2026-01-05"), key2);
      const group = await db.plateGroup.create({ data: { name: identity, color: "#000000" } });
      await db.hit.create({ data: { passageId: actualHit.id, cameraId: camera.id, groupId: group.id, normalizedLicensePlate: "SYNTHETIC", location: "synthetic", timestamp: actualHit.timestamp } });
      const config = retentionSchema.parse({ RETENTION_ENABLED: "true", RETENTION_DRY_RUN: "false", RETENTION_MAX_BATCHES: "1" });
      const service = new RetentionService(db, root, config, () => {}, async () => 20 * 1024 ** 3);
      await service.run(now);
      expect(await db.passage.findUnique({ where: { id: old.id } })).toBeNull();
      expect(await db.passage.findUnique({ where: { id: young.id } })).not.toBeNull();
      expect(await db.passage.findUnique({ where: { id: protectedPassage.id } })).not.toBeNull();
      expect(await db.passage.findUnique({ where: { id: exception.id } })).not.toBeNull();
      expect(await db.passage.findUnique({ where: { id: actualHit.id } })).not.toBeNull();
      expect(await readFile(join(root, key), "utf8")).toBe("synthetic shared image");
      // Independent connection cannot introduce another reference to a queued key.
      await expect(writer.camera.update({ where: { id: camera.id }, data: { lastSnapshotObjectId: key } })).rejects.toThrow();
      // A rollback must retain both passage and media and must not commit its journal.
      await expect(db.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO "RetentionImageDeletion" ("objectId") VALUES (${key2})`;
        await tx.passage.delete({ where: { id: protectedPassage.id } });
        throw new Error("synthetic rollback");
      })).rejects.toThrow("synthetic rollback");
      expect(await db.retentionImageDeletion.findUnique({ where: { objectId: key2 } })).toBeNull();
      expect(await db.passage.findUnique({ where: { id: protectedPassage.id } })).not.toBeNull();
      // Retire the remaining shared reference. Filesystem failure leaves a durable job.
      await db.passage.update({ where: { id: young.id }, data: { timestamp: new Date("2026-01-03") } });
      let fail = true;
      const flaky = new RetentionService(db, root, config, () => {}, async () => 20 * 1024 ** 3, async () => { if (fail) throw new Error("synthetic failure"); });
      await flaky.run(now);
      expect((await db.retentionImageDeletion.findUniqueOrThrow({ where: { objectId: key } })).completedAt).toBeNull();
      fail = false;
      // Actual filesystem provider finishes the durable job after a worker restart.
      await service.run(now);
      await expect(readFile(join(root, key))).rejects.toThrow();
      expect((await db.retentionImageDeletion.findUniqueOrThrow({ where: { objectId: key } })).completedAt).not.toBeNull();
      await expect(passage(now, key)).rejects.toThrow();
      expect(await readFile(join(root, key2), "utf8")).toBe("synthetic protected image");

      // A writer already holding a protected table makes retention yield, no deletion.
      let release!: () => void, locked!: () => void;
      const hold = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { locked = r; });
      const pending = writer.$transaction(async tx => {
        await tx.$executeRaw`LOCK TABLE "RetentionException" IN ROW EXCLUSIVE MODE`;
        locked(); await hold;
      });
      await ready;
      try { await expect(service.run(now)).rejects.toThrow(); } finally { release(); await pending; }
    } finally {
      await db.$disconnect(); await writer.$disconnect(); await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
