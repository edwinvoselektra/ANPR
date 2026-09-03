import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const prismaMock = vi.hoisted(() => ({
  notificationPreference: { findUnique: vi.fn(), upsert: vi.fn() },
  notificationPreferenceGroup: { deleteMany: vi.fn(), createMany: vi.fn() },
  pushSubscription: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  plateGroup: { findMany: vi.fn(), count: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));
const testPushMock = vi.hoisted(() => vi.fn());
vi.mock("./lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./lib/auth.js", () => ({ authenticate: async (request: any) => { request.authUser = { id: USER_ID, roles: ["Viewer"], permissions: [] }; } }));
vi.mock("./lib/audit.js", () => ({ audit: vi.fn() }));
vi.mock("./lib/push.js", () => ({ pushConfiguration: { configured: true, publicKey: "PUBLIC", message: "Web Push is geconfigureerd." } }));
vi.mock("./lib/notification-dispatcher.js", () => ({ sendTestPush: testPushMock }));
import { notificationRoutes } from "./routes/notifications.js";

let app: FastifyInstance | undefined;
const device = { id: DEVICE_ID, deviceName: "Telefoon", userAgent: "Browser", enabled: true, lastSuccessfulAt: null, failureCount: 0, createdAt: new Date(), updatedAt: new Date() };

beforeEach(async () => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn({ notificationPreference: prismaMock.notificationPreference, notificationPreferenceGroup: prismaMock.notificationPreferenceGroup }));
  prismaMock.notificationPreference.findUnique.mockResolvedValue(null);
  prismaMock.pushSubscription.findMany.mockResolvedValue([]);
  prismaMock.plateGroup.findMany.mockResolvedValue([{ id: GROUP_ID, name: "Aandacht", color: "#dc2626" }]);
  prismaMock.plateGroup.count.mockResolvedValue(1);
  prismaMock.notificationPreference.upsert.mockResolvedValue({ id: "55555555-5555-4555-8555-555555555555" });
  app = Fastify(); await app.register(notificationRoutes); await app.ready();
});
afterEach(async () => { await app?.close(); app = undefined; });

describe("persoonlijke Web Push-instellingen", () => {
  it("geeft alleen de publieke VAPID-configuratie terug", async () => {
    const response = await app!.inject({ method: "GET", url: "/notifications/config" });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ configured: true, publicKey: "PUBLIC" });
    expect(response.body).not.toContain("private");
  });

  it("geeft uitsluitend gesaneerde eigen apparaten terug", async () => {
    prismaMock.pushSubscription.findMany.mockResolvedValue([device]);
    const response = await app!.inject({ method: "GET", url: "/notifications/preferences" });
    expect(response.statusCode).toBe(200);
    expect(prismaMock.pushSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: USER_ID } }));
    expect(response.body).not.toContain("endpoint"); expect(response.body).not.toContain("p256dh"); expect(response.body).not.toContain('"auth"');
  });

  it("registreert een abonnement alleen voor de ingelogde gebruiker", async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue(null); prismaMock.pushSubscription.create.mockResolvedValue(device);
    const response = await app!.inject({ method: "POST", url: "/notifications/subscriptions", payload: { endpoint: "https://push.example/subscription", keys: { p256dh: "p".repeat(30), auth: "a".repeat(12) }, deviceName: "Telefoon" } });
    expect(response.statusCode).toBe(201);
    expect(prismaMock.pushSubscription.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: USER_ID }) }));
    expect(response.body).not.toContain("push.example");
  });

  it("kan een abonnement van een andere gebruiker niet overnemen of verwijderen", async () => {
    prismaMock.pushSubscription.findUnique.mockResolvedValue({ id: DEVICE_ID, userId: OTHER_ID });
    const create = await app!.inject({ method: "POST", url: "/notifications/subscriptions", payload: { endpoint: "https://push.example/subscription", keys: { p256dh: "p".repeat(30), auth: "a".repeat(12) } } });
    prismaMock.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
    const remove = await app!.inject({ method: "DELETE", url: `/notifications/subscriptions/${DEVICE_ID}` });
    expect(create.statusCode).toBe(409); expect(remove.statusCode).toBe(404);
    expect(prismaMock.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: DEVICE_ID, userId: USER_ID } });
  });

  it("slaat alle-hits of geselecteerde dynamische groepen op", async () => {
    const response = await app!.inject({ method: "PUT", url: "/notifications/preferences", payload: { pushEnabled: true, allHitGroups: false, groupIds: [GROUP_ID] } });
    expect(response.statusCode).toBe(200);
    expect(prismaMock.notificationPreferenceGroup.createMany).toHaveBeenCalledWith({ data: [{ preferenceId: "55555555-5555-4555-8555-555555555555", groupId: GROUP_ID }] });
  });

  it("weigert een niet-bestaande geselecteerde groep", async () => {
    prismaMock.plateGroup.count.mockResolvedValue(0);
    const response = await app!.inject({ method: "PUT", url: "/notifications/preferences", payload: { pushEnabled: true, allHitGroups: false, groupIds: [GROUP_ID] } });
    expect(response.statusCode).toBe(400); expect(response.json().error).toBe("GROUP_NOT_AVAILABLE");
  });

  it("stuurt een testmelding zonder Hit aan te maken", async () => {
    testPushMock.mockResolvedValue({ ok: true });
    const response = await app!.inject({ method: "POST", url: `/notifications/subscriptions/${DEVICE_ID}/test` });
    expect(response.statusCode).toBe(200);
    expect(testPushMock).toHaveBeenCalledWith(prismaMock, USER_ID, DEVICE_ID);
    expect("hit" in prismaMock).toBe(false);
  });
});
