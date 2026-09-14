import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ admin: true }));
const prismaMock = vi.hoisted(() => ({ auditLog: { findMany: vi.fn() } }));
vi.mock("./lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./lib/auth.js", () => ({ requireAdmin: () => async (_request: unknown, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
  if (!authState.admin) return reply.code(403).send({ error: "ADMIN_REQUIRED" });
} }));
import { registerAdminOverviewRoutes } from "./routes/admin-overview.js";

let app: FastifyInstance | undefined;
const measure = vi.fn().mockResolvedValue({ programBytes: 1024, storageBytes: 2048, totalBytes: 3072 });
const log = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111", action: "CAMERA_UPDATED", objectType: "Camera", objectId: "camera-id",
  oldValue: { name: "ANPR Hal Vos", password: "oude-geheim" }, newValue: { name: "ANPR Hal Vos", apiToken: "nieuwe-geheim" },
  createdAt: new Date("2026-09-14T15:12:00Z"), actor: { displayName: "Edwin van Milligen", username: "edwin" }, ...overrides
});

beforeEach(async () => { vi.clearAllMocks(); authState.admin = true; prismaMock.auditLog.findMany.mockResolvedValue([log()]); app = Fastify(); await app.register((server) => registerAdminOverviewRoutes(server, measure)); await app.ready(); });
afterEach(async () => { await app?.close(); app = undefined; });

describe("compact ADMIN-overzicht", () => {
  it("geeft alleen een administrator opslag en de nieuwste twintig auditregels", async () => {
    const response = await app!.inject({ url: "/admin/overview" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ storage: { programBytes: 1024, storageBytes: 2048, totalBytes: 3072 }, timeZone: "Europe/Amsterdam", activity: [{ user: "Edwin van Milligen", action: "Camera gewijzigd", object: "ANPR Hal Vos" }] });
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));
  });

  it("weigert een niet-administrator voordat opslag of auditdata worden gelezen", async () => {
    authState.admin = false;
    const response = await app!.inject({ url: "/admin/overview" });
    expect(response.statusCode).toBe(403); expect(measure).not.toHaveBeenCalled(); expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("stuurt geen auditpayloads of geheimen naar de browser", async () => {
    const response = await app!.inject({ url: "/admin/overview" });
    expect(response.body).not.toContain("oude-geheim"); expect(response.body).not.toContain("nieuwe-geheim");
    expect(response.body).not.toContain("oldValue"); expect(response.body).not.toContain("newValue"); expect(response.body).not.toContain("metadata");
  });

  it("benoemt een gewijzigde gebruikersrol expliciet", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([log({ action: "USER_UPDATED", objectType: "User", oldValue: { displayName: "Jan", roles: [{ role: { id: "viewer" } }] }, newValue: { displayName: "Jan", roles: [{ role: { id: "admin" } }] } })]);
    const response = await app!.inject({ url: "/admin/overview" });
    expect(response.json().activity[0].action).toBe("Rol gewijzigd");
  });

  it("geeft een lege auditlijst zonder fout terug", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    const response = await app!.inject({ url: "/admin/overview" });
    expect(response.statusCode).toBe(200); expect(response.json().activity).toEqual([]);
  });
});
