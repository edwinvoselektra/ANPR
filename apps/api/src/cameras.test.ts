import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  camera: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn()
  },
  auditLog: { create: vi.fn() },
  vpnLocation: { findUnique: vi.fn() },
  recorder: { findFirst: vi.fn() },
  $transaction: vi.fn()
}));

vi.mock("./lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/auth.js")>();
  return { ...actual, requirePermission: () => async () => undefined };
});

import { buildServer } from "./server.js";

const cameraId = "11111111-1111-4111-8111-111111111111";
const camera = (name: string) => ({
  id: cameraId,
  name,
  location: "Uddel",
  description: null,
  connectionMode: "FIELDS",
  rtspProtocol: "rtsp",
  rtspHost: "camera.invalid",
  rtspPort: 554,
  rtspPath: "/stream",
  rtspUsernameEncrypted: "encrypted-username",
  rtspPasswordEncrypted: "encrypted-password",
  direction: "INCOMING",
  status: "DISABLED",
  active: false,
  displayOrder: 0,
  offlineTimeoutSeconds: 120,
  zones: []
});
const createBody = (name: string) => ({
  name,
  location: "Uddel",
  direction: "INCOMING",
  active: false,
  connectionMode: "FIELDS",
  rtspHost: "camera.invalid",
  rtspPort: 554,
  rtspPath: "/stream",
  username: "camera-user",
  password: "camera-password"
});
const duplicateNameError = () => new Prisma.PrismaClientKnownRequestError("Database-detail die niet naar de client mag", {
  code: "P2002",
  clientVersion: "6.12.0",
  meta: { modelName: "Camera", target: ["name"] }
});
const recordNotFoundError = () => new Prisma.PrismaClientKnownRequestError("Record niet gevonden", {
  code: "P2025",
  clientVersion: "6.12.0"
});

let app: FastifyInstance | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.auditLog.create.mockResolvedValue({});
});
afterEach(async () => { await app?.close(); app = undefined; });

describe("unieke cameranaam", () => {
  it("koppelt een camera optioneel aan een geldige locatie en recorder",async()=>{const locationId="22222222-2222-4222-8222-222222222222";const recorderId="33333333-3333-4333-8333-333333333333";prismaMock.vpnLocation.findUnique.mockResolvedValue({id:locationId});prismaMock.recorder.findFirst.mockResolvedValue({id:recorderId});prismaMock.camera.create.mockResolvedValue({...camera("Recorder camera"),locationId,recorderId});app=buildServer();const response=await app.inject({method:"POST",url:"/cameras",payload:{...createBody("Recorder camera"),locationId,recorderId}});expect(response.statusCode).toBe(201);expect(prismaMock.camera.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({locationId,recorderId})}))});
  it("maakt een camera met een nieuwe unieke naam succesvol aan", async () => {
    prismaMock.camera.create.mockResolvedValue(camera("Unieke camera"));
    app = buildServer();

    const response = await app.inject({ method: "POST", url: "/cameras", payload: createBody("Unieke camera") });

    expect(response.statusCode).toBe(201);
    expect(response.json().camera).toMatchObject({ name: "Unieke camera", hasUsername: true, hasPassword: true });
    expect(response.body).not.toContain("encrypted-username");
    expect(response.body).not.toContain("camera-password");
  });

  it("geeft voor een dubbele cameranaam een veilige cameraspecifieke 409", async () => {
    prismaMock.camera.create.mockRejectedValue(duplicateNameError());
    app = buildServer();

    const response = await app.inject({ method: "POST", url: "/cameras", payload: createBody("Bestaande camera") });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "CAMERA_NAME_ALREADY_EXISTS",
      message: "Er bestaat al een camera met deze naam. Kies een andere cameranaam of bewerk de bestaande camera.",
      fields: { name: ["Er bestaat al een camera met deze naam. Kies een andere cameranaam of bewerk de bestaande camera."] }
    });
    expect(response.body).not.toContain("Database-detail");
    expect(response.body).not.toContain("Unique constraint");
  });

  it("werkt een bestaande camera bij zonder zijn naam te wijzigen", async () => {
    const existing = camera("Eigen cameranaam");
    const update = vi.fn().mockResolvedValue(existing);
    prismaMock.camera.findUniqueOrThrow.mockResolvedValue(existing);
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({ camera: { update } }));
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/cameras/${cameraId}`, payload: { name: "Eigen cameranaam" } });

    expect(response.statusCode).toBe(200);
    expect(response.json().camera.name).toBe("Eigen cameranaam");
    expect(update).toHaveBeenCalledOnce();
  });

  it("geeft bij hernoemen naar een andere bestaande camera een veilige 409", async () => {
    const existing = camera("Eigen cameranaam");
    const update = vi.fn().mockRejectedValue(duplicateNameError());
    prismaMock.camera.findUniqueOrThrow.mockResolvedValue(existing);
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({ camera: { update } }));
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/cameras/${cameraId}`, payload: { name: "Naam van andere camera" } });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("CAMERA_NAME_ALREADY_EXISTS");
    expect(response.body).not.toContain("Database-detail");
  },10_000);

  it("controleert vooraf of een cameranaam beschikbaar is", async () => {
    prismaMock.camera.findUnique.mockResolvedValue({ id: cameraId });
    app = buildServer();

    const response = await app.inject({ method: "GET", url: "/cameras/name-availability?name=Bestaande%20camera" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false });
    expect(prismaMock.camera.findUnique).toHaveBeenCalledWith({ where: { name: "Bestaande camera" }, select: { id: true } });
  });
});

describe("camera verwijderen", () => {
  it("levert het cameraoverzicht expliciet zonder cache", async () => {
    prismaMock.camera.findMany.mockResolvedValue([]);
    app = buildServer();

    const response = await app.inject({ method: "GET", url: "/cameras" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toEqual({ cameras: [] });
  });

  it("verwijdert een bestaande camera idempotent en maakt de naam opnieuw bruikbaar", async () => {
    const existing = { ...camera("Herbruikbare naam"), _count: { passages: 0, hits: 0 } };
    prismaMock.camera.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
    prismaMock.camera.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.camera.create.mockResolvedValue(camera("Herbruikbare naam"));
    app = buildServer();

    const firstDelete = await app.inject({ method: "DELETE", url: `/cameras/${cameraId}` });
    const secondDelete = await app.inject({ method: "DELETE", url: `/cameras/${cameraId}` });
    const recreate = await app.inject({ method: "POST", url: "/cameras", payload: createBody("Herbruikbare naam") });

    expect(firstDelete.statusCode).toBe(204);
    expect(secondDelete.statusCode).toBe(204);
    expect(recreate.statusCode).toBe(201);
    expect(prismaMock.camera.deleteMany).toHaveBeenCalledOnce();
    expect(prismaMock.camera.deleteMany).toHaveBeenCalledWith({ where: { id: cameraId } });
  });

  it("maakt de verwijderde camera en zijn credentials niet meer benaderbaar", async () => {
    const existing = { ...camera("Te verwijderen"), _count: { passages: 0, hits: 0 } };
    prismaMock.camera.findUnique.mockResolvedValue(existing);
    prismaMock.camera.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.camera.findUniqueOrThrow.mockRejectedValue(recordNotFoundError());
    app = buildServer();

    const deleted = await app.inject({ method: "DELETE", url: `/cameras/${cameraId}` });
    const details = await app.inject({ method: "GET", url: `/cameras/${cameraId}` });
    const connectionTest = await app.inject({ method: "POST", url: `/cameras/${cameraId}/test` });

    expect(deleted.statusCode).toBe(204);
    expect(details.statusCode).toBe(404);
    expect(connectionTest.statusCode).toBe(404);
    expect(details.body).not.toContain("encrypted-password");
    expect(connectionTest.body).not.toContain("encrypted-password");
  });

  it("behoudt camera en historische passages of hits", async () => {
    const historical = { ...camera("Camera met historie"), _count: { passages: 1, hits: 1 } };
    prismaMock.camera.findUnique.mockResolvedValue(historical);
    app = buildServer();

    const response = await app.inject({ method: "DELETE", url: `/cameras/${cameraId}` });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "CAMERA_HAS_HISTORY",
      message: "Deze camera heeft historische passages of hits en kan voor behoud van historie alleen worden uitgeschakeld."
    });
    expect(prismaMock.camera.deleteMany).not.toHaveBeenCalled();
  });
});
