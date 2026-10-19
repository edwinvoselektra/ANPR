import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { PassageService } from "@anpr/shared/passage-service";
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
import { loadDashboard } from "./routes/dashboard.js";

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


describe("dashboard Recente passages op serverontvangsttijd", () => {
  it.each([
    ["2026-07-14T05:31:00Z", "2026-07-13T22:00:00.000Z", "2026-07-14T22:00:00.000Z"],
    ["2026-01-14T06:31:00Z", "2026-01-13T23:00:00.000Z", "2026-01-14T23:00:00.000Z"],
  ])("telt en sorteert nieuwe ontvangsten samen op %s", async (current, start, end) => {
    const now = new Date(current);
    type Row = { id: string; timestamp: Date; createdAt: Date; status: string; source: string; camera: { name: string }; [key: string]: unknown };
    type Where = { status?: string; source?: string; timestamp?: { gte?: Date; lt?: Date; lte?: Date } };
    const camera = { id: "test-camera", name: "Synthetische testcamera", location: "Test", vpnLocation: { timezone: "Europe/Amsterdam" } };
    const row = (id: string, timestamp: Date, source = "DAHUA_CAMERA", status = "ACTIVE"): Row => ({id,timestamp,createdAt:now,status,source,camera});
    // Historical records remain intact, including camera-clock errors and demo data.
    const rows: Row[] = [
      row("previous-day", new Date(new Date(start).getTime() - 1)),
      row("old-future-camera-clock", new Date(now.getTime() + 60_000)),
      row("next-day", new Date(end)),
      row("deleted", new Date(now.getTime() - 1000), "DAHUA_CAMERA", "DELETED"),
      row("demo", new Date(now.getTime() - 120_000), "DEMO"),
    ];
    const originalRows = structuredClone(rows);
    const matching = (where: Where) => rows.filter(item =>
      (!where.status || item.status === where.status) && (!where.source || item.source === where.source) &&
      (!where.timestamp?.gte || item.timestamp >= where.timestamp.gte) &&
      (!where.timestamp?.lt || item.timestamp < where.timestamp.lt) &&
      (!where.timestamp?.lte || item.timestamp <= where.timestamp.lte));
    const db = {
      camera: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(camera), updateMany: vi.fn().mockResolvedValue({count:1}), update: vi.fn() },
      passage: {
        count: vi.fn(async ({where}: {where:Where}) => matching(where).length),
        findMany: vi.fn(async ({where, orderBy, take}: {where:Where;orderBy:unknown;take:number}) => {
          expect(orderBy).toEqual([{timestamp:"desc"},{id:"desc"}]);
          return matching(where).sort((a,b)=>b.timestamp.getTime()-a.timestamp.getTime() || b.id.localeCompare(a.id)).slice(0,take);
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({data}: {data:Record<string,unknown> & Pick<Row,"timestamp"|"source">}) => {
          const saved: Row = {...data,id:`receipt-${rows.length}`,createdAt:new Date(now.getTime()-rows.length),status:"ACTIVE",camera};
          rows.push(saved); return saved;
        }),
      },
      plateGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
      hit: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      attentionAnalysisJob: { create: vi.fn() },
      $transaction: vi.fn(),
    };
    db.$transaction.mockImplementation(async fn=>fn(db));
    const client = db as unknown as PrismaClient;
    const service = new PassageService({prisma:client,storage:{storePassageImage:async()=>{throw new Error("No fixture images")},delete:async()=>{}},dedupeWindowMs:0,logger:{info(){},warn(){},error(){}}});
    const ingest = (id: string, receivedAt: Date, cameraTime: string) => service.store({
      cameraId:camera.id,originalPlate:"TEST12",normalizedPlate:"TEST12",source:"DAHUA_CAMERA",sourceEventId:id,
      receivedAt,occurredAt:new Date(cameraTime),rawMetadata:{provider:"DAHUA_ITSAPI",timeSource:"AccurateTime"},
    });
    await ingest("first", new Date(now.getTime()-60_000), "2099-01-01T00:00:00Z");
    const before = await loadDashboard(client,now);
    expect(before.counters.passagesToday).toBe(2); // One receipt and the retained demo.
    expect(before.recentPassages.map(item=>item.id)).toEqual(["receipt-5","demo"]);
    await ingest("second", now, "2000-01-01T00:00:00Z");
    const after = await loadDashboard(client,now);
    expect(after.counters.passagesToday).toBe(before.counters.passagesToday+1);
    expect(after.recentPassages.map(item=>item.id)).toEqual(["receipt-6","receipt-5","demo"]);
    expect(after.recentPassages[0]!.timestamp).toEqual(now);
    expect(after.recentPassages[0]!.timeZone).toBe("Europe/Amsterdam");
    expect(after.counters.demoPassagesToday).toBe(1);
    const listWhere = db.passage.findMany.mock.calls.at(-1)![0].where;
    expect(listWhere).toEqual({status:"ACTIVE",timestamp:{gte:new Date(start),lt:new Date(end),lte:now}});
    expect(db.passage.count.mock.calls.at(-2)![0].where).toEqual(listWhere);
    expect(db.$transaction).toHaveBeenLastCalledWith(expect.any(Function),{isolationLevel:"RepeatableRead"});
    expect(rows.slice(0,originalRows.length)).toEqual(originalRows);
  });
});
