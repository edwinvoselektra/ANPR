import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const prismaMock = vi.hoisted(() => ({
  camera: { count: vi.fn(), findMany: vi.fn() },
  passage: { count: vi.fn(), findMany: vi.fn() },
  hit: { count: vi.fn(), findMany: vi.fn() },
  plateGroupMember: { findMany: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock("./lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/auth.js")>();
  return { ...actual, requirePermission: () => async () => undefined };
});

import { buildServer } from "./server.js";

let app: FastifyInstance | undefined;

afterEach(async () => { await app?.close(); app = undefined; });

describe("dashboard Laatste hits", () => {
  it("toont recente hits met cameranaam en groep voor Laatste hits", async () => {
    prismaMock.$transaction.mockImplementation(fn=>fn(prismaMock));
    prismaMock.camera.count.mockResolvedValue(2);
    prismaMock.passage.count.mockResolvedValue(1);
    prismaMock.hit.count.mockResolvedValue(1);
    prismaMock.plateGroupMember.findMany.mockResolvedValue([{ normalizedLicensePlate: "12ABC3" }]);
    prismaMock.passage.findMany.mockResolvedValue([]);
    prismaMock.hit.findMany.mockResolvedValue([{
      id: "22222222-2222-4222-8222-222222222222", normalizedLicensePlate: "12ABC3", timestamp: new Date("2026-08-28T10:00:00Z"),
      camera: { name: "Eigen Camera Dorp" }, group: { name: "Aandacht", color: "#dc2626" }, groups:[{group:{id:"fixture",name:"Aandacht",color:"#dc2626"},reason:"Synthetische reden"}]
    }]);
    prismaMock.camera.findMany.mockResolvedValue([]);
    app = buildServer();

    const response = await app.inject({ method: "GET", url: "/dashboard" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json().recentHits[0].groups[0]).toMatchObject({name:"Aandacht",reason:"Synthetische reden"});
    const listWhere=prismaMock.hit.findMany.mock.calls[0]![0].where;
    expect(prismaMock.hit.count.mock.calls[0]![0].where).toEqual(listWhere);
    expect(Object.keys(listWhere)).toEqual(["timestamp"]);
    const body = response.json() as { counters: { hitsToday: number }; recentHits: Array<{ camera: { name: string }; group: { name: string } }> };
    expect(body.counters.hitsToday).toBe(1);
    expect(body.recentHits).toHaveLength(1);
    expect(body.recentHits[0]?.camera.name).toBe("Eigen Camera Dorp");
    expect(body.recentHits[0]?.group.name).toBe("Aandacht");
    // Laatste hits haalt de cameranaam expliciet mee vanuit de gekoppelde camera.
    expect(prismaMock.hit.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ camera: { select: { name: true, historicalName: true, vpnLocation: { select: { timezone: true } } } } })
    }));
  });
});
