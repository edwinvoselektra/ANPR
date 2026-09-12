import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// DEMO_MODE moet gezet zijn vóórdat config.ts geladen wordt; vi.hoisted draait vóór de imports.
vi.hoisted(() => { process.env.DEMO_MODE = "true"; });

const prismaMock = vi.hoisted(() => ({
  camera: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  passage: { create: vi.fn(), update: vi.fn() },
  hit: { create: vi.fn() },
  plateGroupMember: { findMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock("./lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/auth.js")>();
  return { ...actual, requirePermission: () => async () => undefined };
});

import { buildServer } from "./server.js";

const CAMERA_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const PASSAGE_ID = "33333333-3333-4333-8333-333333333333";

const camera = {
  id: CAMERA_ID, name: "Eigen Camera Dorp", location: "Dorpstraat 1", description: null,
  connectionMode: "FIELDS", rtspProtocol: "rtsp", rtspHost: "camera.invalid", rtspPort: 554, rtspPath: "/stream",
  rtspUsernameEncrypted: null, rtspPasswordEncrypted: null, direction: "INCOMING", status: "ONLINE",
  active: true, displayOrder: 0, offlineTimeoutSeconds: 120
};

const passageRecord = { id: PASSAGE_ID, cameraId: CAMERA_ID, displayLicensePlate: "12-ABC-3", source: "DEMO", isHit: true };

let app: FastifyInstance | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.camera.findUnique.mockResolvedValue(camera);
  prismaMock.plateGroupMember.findMany.mockResolvedValue([]);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
    passage: prismaMock.passage, hit: prismaMock.hit, plateGroupMember: prismaMock.plateGroupMember, camera: { update: prismaMock.camera.update }
  }));
  prismaMock.passage.create.mockResolvedValue(passageRecord);
  prismaMock.passage.update.mockResolvedValue({ ...passageRecord, isHit: true });
  prismaMock.hit.create.mockResolvedValue({ id: "55555555-5555-4555-8555-555555555555" });
});
afterEach(async () => { await app?.close(); app = undefined; });

describe("simulator camerakeuze", () => {
  it("laadt alle actieve camera's dynamisch uit de database zonder hardcoded namen", async () => {
    prismaMock.camera.findMany.mockResolvedValue([{ id: CAMERA_ID, name: "Eigen Camera Dorp", location: "Dorpstraat 1" }]);
    app = buildServer();

    const response = await app.inject({ method: "GET", url: "/simulator" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { enabled: boolean; cameras: Array<{ id: string; name: string }> };
    expect(body.enabled).toBe(true);
    expect(body.cameras).toEqual([{ id: CAMERA_ID, name: "Eigen Camera Dorp", location: "Dorpstraat 1" }]);
    // De keuzelijst vraagt uitsluitend actieve camera's op; geen hardcoded naamlijst.
    expect(prismaMock.camera.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, isDraft: false, archivedAt: null } }));
  });

  it("koppelt een gesimuleerde passage en hit aan de daadwerkelijk gekozen camera", async () => {
    prismaMock.plateGroupMember.findMany.mockResolvedValue([{ active: true, group: { id: GROUP_ID, name: "Aandacht" }, groupId: GROUP_ID, reason: "DEMO: verdacht voertuig" }]);
    app = buildServer();

    const response = await app.inject({ method: "POST", url: "/simulator/passages", payload: { cameraId: CAMERA_ID, licensePlate: "12-ABC-3" } });

    expect(response.statusCode).toBe(201);
    expect(response.json().hit).toBe(true);
    const createCall = prismaMock.passage.create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(createCall.data).toMatchObject({ cameraId: CAMERA_ID, location: "Dorpstraat 1", direction: "INCOMING", source: "DEMO", isHit: false });
    expect(prismaMock.passage.update).toHaveBeenCalledWith({ where: { id: PASSAGE_ID }, data: { isHit: true } });
    expect(prismaMock.hit.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      cameraId: CAMERA_ID, groupId: GROUP_ID, location: "Dorpstraat 1", normalizedLicensePlate: "12ABC3", notificationStatus: "SKIPPED"
    }) });
  });

  it("weigert een uitgeschakelde camera voor een demopassage", async () => {
    prismaMock.camera.findUnique.mockResolvedValue({ ...camera, active: false });
    app = buildServer();

    const response = await app.inject({ method: "POST", url: "/simulator/passages", payload: { cameraId: CAMERA_ID, licensePlate: "12-ABC-3" } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("CAMERA_INACTIVE");
    expect(prismaMock.passage.create).not.toHaveBeenCalled();
  });

  it("weigert een verwijderde camera voor een demopassage", async () => {
    prismaMock.camera.findUnique.mockResolvedValue(null);
    app = buildServer();

    const response = await app.inject({ method: "POST", url: "/simulator/passages", payload: { cameraId: CAMERA_ID, licensePlate: "12-ABC-3" } });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe("CAMERA_NOT_FOUND");
    expect(prismaMock.passage.create).not.toHaveBeenCalled();
  });

  it("maakt zonder actieve signaalingsgroep-treffer geen hit aan", async () => {
    app = buildServer();

    const response = await app.inject({ method: "POST", url: "/simulator/passages", payload: { cameraId: CAMERA_ID, licensePlate: "DE-MO-1" } });

    expect(response.statusCode).toBe(201);
    expect(response.json().hit).toBe(false);
    expect(prismaMock.hit.create).not.toHaveBeenCalled();
  });

  it("gebruikt het gekozen tijdstip en de gekozen rijrichting", async () => {
    app = buildServer();
    const timestamp = "2026-09-03T20:15:00.000Z";

    const response = await app.inject({ method: "POST", url: "/simulator/passages", payload: {
      cameraId: CAMERA_ID, licensePlate: "TE-ST-1", timestamp, direction: "OUTGOING"
    } });

    expect(response.statusCode).toBe(201);
    expect(prismaMock.passage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ timestamp: new Date(timestamp), direction: "OUTGOING", cameraId: CAMERA_ID }) });
  });
});
