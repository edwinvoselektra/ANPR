import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { candidateWhere, deleteRetentionImage, retentionSchema, RetentionService } from "./retention.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const key = "passages/2026/01/00000000-0000-0000-0000-000000000001.jpg";
const now = new Date("2026-10-28T12:00:00Z");
const gib = 1024 ** 3;

function fixture(overrides: Record<string, string> = {}) {
  const config = retentionSchema.parse({ RETENTION_ENABLED: "true", RETENTION_DRY_RUN: "false", RETENTION_MAX_BATCHES: "2", ...overrides });
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    passage: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    plateDetection: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const db = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    $queryRaw: vi.fn().mockResolvedValue([]) };
  const remove = vi.fn().mockResolvedValue(undefined), available = vi.fn().mockResolvedValue(20 * gib), report = vi.fn();
  const service = new RetentionService(db as unknown as PrismaClient, "unused", config, report, available, remove);
  return { config, tx, db, remove, available, report, service };
}

describe("retention policy", () => {
  it("protects hits, recorded exceptions and passages younger than 90 days", () => {
    expect(candidateWhere(now, 90, false)).toEqual({ timestamp: { lte: new Date("2026-07-30T12:00:00Z") }, isHit: false, hits: { none: {} }, retentionExceptions: { none: {} } });
    expect(candidateWhere(now, 90, true)).not.toHaveProperty("timestamp");
    expect(candidateWhere(now, 90, true)).toMatchObject({ isHit: false, retentionExceptions: { none: {} } });
  });
  it("rejects malformed and inverted thresholds", () => {
    expect(() => retentionSchema.parse({ RETENTION_MIN_FREE_GIB: 15, RETENTION_TARGET_FREE_GIB: 10 })).toThrow();
    expect(() => retentionSchema.parse({ RETENTION_ENABLED: "yes" })).toThrow();
  });
  it("disabled and dry-run perform no database or filesystem mutation", async () => {
    const f = fixture({ RETENTION_DRY_RUN: "true" });
    await f.service.run(now);
    expect(f.db.$transaction).not.toHaveBeenCalled(); expect(f.db.$queryRaw).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled();
    const disabled = fixture({ RETENTION_ENABLED: "false" }); await disabled.service.run(now);
    expect(disabled.available).not.toHaveBeenCalled(); expect(disabled.tx.passage.findMany).not.toHaveBeenCalled();
  });
  it("queues all image references before deleting a bounded FIFO batch", async () => {
    const f = fixture();
    f.tx.passage.findMany.mockResolvedValueOnce([{ id: "passage", vehicleImage1ObjectId: key, vehicleImage2ObjectId: key, plateImageObjectId: null }] as never);
    f.tx.plateDetection.findMany.mockResolvedValueOnce([{ frameObjectId: "detection.jpg" }] as never);
    await f.service.run(now);
    expect(f.tx.passage.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ timestamp: "asc" }, { id: "asc" }], take: 25 }));
    expect(f.tx.$executeRaw.mock.calls.filter(c => String(c[0]).includes("INSERT INTO"))).toHaveLength(2);
    expect(f.tx.passage.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["passage"] } } });
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("does not unlink when a database batch fails", async () => {
    const f = fixture(); f.db.$transaction.mockRejectedValueOnce(new Error("rollback"));
    await expect(f.service.run(now)).rejects.toThrow("rollback"); expect(f.remove).not.toHaveBeenCalled();
  });
  it("keeps a failed deletion pending and retries on another run", async () => {
    const f = fixture(); f.db.$queryRaw.mockResolvedValueOnce([{ objectId: key }]); f.remove.mockRejectedValueOnce(new Error("disk"));
    await f.service.run(now);
    expect(f.report).toHaveBeenCalledWith({ event: "retention.image_failed" });
    f.db.$queryRaw.mockResolvedValueOnce([{ objectId: key }]); await f.service.run(now);
    expect(f.remove).toHaveBeenCalledTimes(2);
  });
  it("stops pressure removal after target buffer is reached", async () => {
    const f = fixture({ RETENTION_PRESSURE_ENABLED: "true" });
    f.available.mockResolvedValueOnce(9 * gib).mockResolvedValueOnce(16 * gib);
    await f.service.run(now);
    expect(f.tx.passage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: candidateWhere(now, 90, false) }));
  });
  it("reports protected-data exhaustion without deleting protected records", async () => {
    const f = fixture({ RETENTION_PRESSURE_ENABLED: "true" }); f.available.mockResolvedValue(5 * gib);
    await f.service.run(now);
    expect(f.report).toHaveBeenCalledWith({ event: "retention.insufficient_reclaimable_space", freeBytes: 5 * gib });
    expect(f.tx.passage.deleteMany).not.toHaveBeenCalled();
  });
  it("remembers a partially restored buffer across bounded runs", async () => {
    const f = fixture({ RETENTION_PRESSURE_ENABLED: "true", RETENTION_MAX_BATCHES: "1" });
    f.available.mockResolvedValueOnce(9 * gib).mockResolvedValue(12 * gib);
    await f.service.run(now); await f.service.run(now);
    expect(f.tx.passage.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: candidateWhere(now, 90, true) }));
  });
});

describe("retention filesystem boundary", () => {
  it("deletes generated image keys, treats missing files idempotently and preserves other files", async () => {
    const root = await mkdtemp(join(tmpdir(), "anpr-retention-")); roots.push(root);
    await mkdir(join(root, "passages/2026/01"), { recursive: true }); await writeFile(join(root, key), "synthetic");
    await writeFile(join(root, "keep.txt"), "keep");
    await deleteRetentionImage(root, key); await deleteRetentionImage(root, key);
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("keep");
    for (const unsafe of ["../other.jpg", "/etc/passwd", "passages/2026/01/../../secret", "keep.txt"]) await expect(deleteRetentionImage(root, unsafe)).rejects.toThrow("UNSAFE");
  });
  it("refuses a directory junction escaping the storage root", async () => {
    const root = await mkdtemp(join(tmpdir(), "anpr-retention-")), outside = await mkdtemp(join(tmpdir(), "anpr-outside-")); roots.push(root, outside);
    await mkdir(join(outside, "2026/01"), { recursive: true }); await writeFile(join(outside, key.split("/").slice(1).join("/")), "keep");
    await symlink(outside, join(root, "passages"), "junction");
    await expect(deleteRetentionImage(root, key)).rejects.toThrow("UNSAFE_RETENTION_PATH");
    expect(await readFile(join(outside, "2026/01", key.split("/").at(-1)!), "utf8")).toBe("keep");
  });
});
