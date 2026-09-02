import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { PERMISSIONS } from "@anpr/shared";

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  role: { findMany: vi.fn() },
  userRole: { deleteMany: vi.fn(), createMany: vi.fn() },
  userSession: { updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn()
}));

const authState = vi.hoisted(() => ({ user: undefined as
  { id: string; email: string; username: string; displayName: string; roles: string[]; permissions: string[]; sessionId: string } | undefined }));

vi.mock("./lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/auth.js")>();
  return { ...actual,
    // Gesimuleerde RBAC: dezelfde permission-controle als de echte preHandler, met een
    // per test instelbare ingelogde gebruiker.
    requirePermission: (permission: string) => async (request: { authUser?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
      const user = authState.user;
      if (!user) return reply.code(401).send({ error: "AUTH_REQUIRED", message: "Log eerst in." });
      if (!user.permissions.includes(permission)) return reply.code(403).send({ error: "FORBIDDEN", message: "Je hebt geen toestemming voor deze actie." });
      request.authUser = user;
    }
  };
});

import { buildServer } from "./server.js";

const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "33333333-3333-4333-8333-333333333333";
const OPERATOR_ID = "44444444-4444-4444-8444-444444444444";
const ADMIN_ROLE_ID = "55555555-5555-4555-8555-555555555555";
const OPERATOR_ROLE_ID = "66666666-6666-4666-8666-666666666666";

const adminRole = { id: ADMIN_ROLE_ID, name: "Administrator", permissions: [{ permission: { key: PERMISSIONS.USERS_MANAGE } }] };
const operatorRole = { id: OPERATOR_ROLE_ID, name: "Operator", permissions: [{ permission: { key: PERMISSIONS.CAMERAS_VIEW } }, { permission: { key: PERMISSIONS.SIMULATOR_RUN } }] };

const adminAuth = { id: ADMIN_ID, email: "admin@example.com", username: "admin", displayName: "Beheerder", roles: ["Administrator"],
  permissions: [...Object.values(PERMISSIONS)], sessionId: "session-admin" };
const operatorAuth = { id: OPERATOR_ID, email: "operator@example.com", username: "operator", displayName: "Operateur", roles: ["Operator"],
  permissions: [PERMISSIONS.CAMERAS_VIEW, PERMISSIONS.PASSAGES_VIEW, PERMISSIONS.PLATES_MANAGE, PERMISSIONS.HITS_VIEW, PERMISSIONS.SIMULATOR_RUN], sessionId: "session-operator" };

const targetUser = (overrides: Record<string, unknown> = {}) => ({
  id: TARGET_ID, email: "jan@example.com", username: "jan", displayName: "Jan de Tester",
  active: true, lastLoginAt: null, createdAt: new Date("2026-01-01T09:00:00Z"),
  roles: [{ role: operatorRole }], ...overrides
});
const targetAdmin = (overrides: Record<string, unknown> = {}) => targetUser({ roles: [{ role: adminRole }], ...overrides });

let app: FastifyInstance | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = adminAuth;
  prismaMock.auditLog.create.mockResolvedValue({});
  prismaMock.userSession.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({ userRole: prismaMock.userRole, user: prismaMock.user }));
  prismaMock.user.findMany.mockResolvedValue([{ id: ADMIN_ID }]);
  prismaMock.user.findUnique.mockResolvedValue(targetUser());
  prismaMock.user.update.mockResolvedValue(targetUser());
  prismaMock.role.findMany.mockResolvedValue([operatorRole]);
});
afterEach(async () => { authState.user = undefined; await app?.close(); app = undefined; });

describe("gebruikers verwijderen", () => {
  it("laat een admin een gewone gebruiker definitief verwijderen en schrijft een auditregel", async () => {
    app = buildServer();

    const response = await app.inject({ method: "DELETE", url: `/users/${TARGET_ID}` });

    expect(response.statusCode).toBe(204);
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: TARGET_ID } });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "USER_DELETED", objectType: "User", objectId: TARGET_ID })
    }));
  });

  it("weigert een operator het verwijderen van een gebruiker", async () => {
    authState.user = operatorAuth;
    app = buildServer();

    const response = await app.inject({ method: "DELETE", url: `/users/${TARGET_ID}` });

    expect(response.statusCode).toBe(403);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("voorkomt dat een admin zijn eigen account verwijdert", async () => {
    app = buildServer();

    const response = await app.inject({ method: "DELETE", url: `/users/${ADMIN_ID}` });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("SELF_DELETE");
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("blokkeert het verwijderen van de laatste actieve administrator", async () => {
    prismaMock.user.findUnique.mockResolvedValue(targetAdmin());
    prismaMock.user.findMany.mockResolvedValue([{ id: TARGET_ID }]);
    app = buildServer();

    const response = await app.inject({ method: "DELETE", url: `/users/${TARGET_ID}` });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("LAST_ACTIVE_ADMIN");
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("leidt database-beschermde historie (zoals retentie-uitzonderingen) naar een duidelijke 409", async () => {
    prismaMock.user.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("FK-beperking", { code: "P2003", clientVersion: "6.12.0" }));
    app = buildServer();

    const response = await app.inject({ method: "DELETE", url: `/users/${TARGET_ID}` });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("USER_HAS_HISTORY");
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("geeft een 404 voor een onbekende gebruiker", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    app = buildServer();

    const response = await app.inject({ method: "DELETE", url: `/users/${TARGET_ID}` });

    expect(response.statusCode).toBe(404);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });
});

describe("wachtwoord resetten", () => {
  it("laat een admin het wachtwoord van een gebruiker veilig resetten en meldt alle sessies af", async () => {
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { password: "NieuwSterkWacht1" } });

    expect(response.statusCode).toBe(200);
    const updateCall = prismaMock.user.update.mock.calls[0]?.[0] as { data: { passwordHash?: string } };
    expect(updateCall.data.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: TARGET_ID, revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    expect(response.body).not.toContain("NieuwSterkWacht1");
    expect(response.body).not.toContain("passwordHash");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "USER_PASSWORD_RESET" })
    }));
  });

  it("weigert een operator het resetten van een wachtwoord", async () => {
    authState.user = operatorAuth;
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { password: "NieuwSterkWacht1" } });

    expect(response.statusCode).toBe(403);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("behoudt bij een eigen wachtwoordreset de huidige sessie van de admin", async () => {
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${ADMIN_ID}`, payload: { password: "NieuwSterkWacht1" } });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: ADMIN_ID, revokedAt: null, id: { not: "session-admin" } }, data: { revokedAt: expect.any(Date) } });
  });

  it("weigert een wachtwoord dat niet aan de regels voldoet", async () => {
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { password: "zwakwachtwoord" } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("VALIDATION_ERROR");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("rollen en uitschakelen", () => {
  it("laat een admin de rol van een gebruiker wijzigen", async () => {
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { roleIds: [OPERATOR_ROLE_ID] } });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: TARGET_ID } });
    expect(prismaMock.userRole.createMany).toHaveBeenCalledWith({ data: [{ userId: TARGET_ID, roleId: OPERATOR_ROLE_ID }] });
  });

  it("weigert een operator het wijzigen van rollen", async () => {
    authState.user = operatorAuth;
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { roleIds: [OPERATOR_ROLE_ID] } });

    expect(response.statusCode).toBe(403);
    expect(prismaMock.userRole.createMany).not.toHaveBeenCalled();
  });

  it("blokkeert degradatie van de laatste actieve administrator naar Operator", async () => {
    prismaMock.user.findUnique.mockResolvedValue(targetAdmin());
    prismaMock.user.findMany.mockResolvedValue([{ id: TARGET_ID }]);
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { roleIds: [OPERATOR_ROLE_ID] } });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("LAST_ACTIVE_ADMIN");
    expect(prismaMock.userRole.createMany).not.toHaveBeenCalled();
  });

  it("staat rolwijziging van een administrator toe zolang er een andere actieve administrator blijft", async () => {
    prismaMock.user.findUnique.mockResolvedValue(targetAdmin());
    prismaMock.user.findMany.mockResolvedValue([{ id: ADMIN_ID }, { id: TARGET_ID }]);
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { roleIds: [OPERATOR_ROLE_ID] } });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.userRole.createMany).toHaveBeenCalled();
  });

  it("laat een admin een gebruiker uitschakelen en meldt alle sessies af", async () => {
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { active: false } });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.userSession.updateMany).toHaveBeenCalledWith({ where: { userId: TARGET_ID }, data: { revokedAt: expect.any(Date) } });
  });

  it("blokkeert het uitschakelen van de laatste actieve administrator", async () => {
    prismaMock.user.findUnique.mockResolvedValue(targetAdmin());
    prismaMock.user.findMany.mockResolvedValue([{ id: TARGET_ID }]);
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { active: false } });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe("LAST_ACTIVE_ADMIN");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("voorkomt dat een admin zijn eigen account uitschakelt", async () => {
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${ADMIN_ID}`, payload: { active: false } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("SELF_DISABLE");
  });

  it("leidt een onbekende rol naar een duidelijke 400", async () => {
    prismaMock.role.findMany.mockResolvedValue([]);
    app = buildServer();

    const response = await app.inject({ method: "PATCH", url: `/users/${TARGET_ID}`, payload: { roleIds: [OPERATOR_ROLE_ID] } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("ROLE_NOT_FOUND");
    expect(prismaMock.userRole.createMany).not.toHaveBeenCalled();
  });
});

describe("antwoordveiligheid", () => {
  it("geeft nooit een wachtwoord of hash terug via de gebruikerslijst", async () => {
    prismaMock.user.findMany
      .mockResolvedValueOnce([targetUser({ passwordHash: "supergeheimebcrypthash" }), targetAdmin({ id: ADMIN_ID, passwordHash: "supergeheimebcrypthash" })])
      .mockResolvedValueOnce([{ id: TARGET_ID }]);
    app = buildServer();

    const response = await app.inject({ method: "GET", url: "/users" });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("supergeheimebcrypthash");
    const body = response.json() as { users: Array<{ id: string; isAdmin?: boolean }> };
    expect(body.users.find((user) => user.id === TARGET_ID)?.isAdmin).toBe(false);
    expect(body.users.find((user) => user.id !== TARGET_ID)?.isAdmin).toBe(true);
  });
});
