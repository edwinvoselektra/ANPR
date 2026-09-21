import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { PERMISSIONS } from "@anpr/shared";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }));
vi.mock("./prisma.js", () => ({ prisma: { userSession: mocks } }));

import { authenticate, isAuthorized } from "./auth.js";

afterEach(() => vi.clearAllMocks());

describe("authenticatie en permissions", () => {
  const reply = () => {
    const value = { code: vi.fn(), send: vi.fn(), clearCookie: vi.fn(), sent: false } as any;
    value.code.mockReturnValue(value);
    return value;
  };

  it("weigert een ontbrekende sessiecookie met 401", async () => {
    const response = reply();
    await authenticate({ cookies: {} } as any, response);
    expect(response.code).toHaveBeenCalledWith(401);
    expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ error: "AUTH_REQUIRED" }));
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("wist een verlopen sessiecookie en antwoordt met 401", async () => {
    const response = reply();
    mocks.findUnique.mockResolvedValue({
      id: "session", expiresAt: new Date(Date.now() - 1_000), revokedAt: null, lastSeenAt: new Date(),
      user: { id: "user", active: true, roles: [] }
    });
    await authenticate({ cookies: { anpr_session: "token" } } as any, response);
    expect(response.clearCookie).toHaveBeenCalledWith("anpr_session", { path: "/" });
    expect(response.code).toHaveBeenCalledWith(401);
    expect(response.send).toHaveBeenCalledWith(expect.objectContaining({ error: "SESSION_INVALID" }));
  });

  it("verifieert een veilig gehasht wachtwoord", async () => {
    const hash = await bcrypt.hash("SterkTestWachtwoord123", 12);
    expect(hash).not.toContain("SterkTestWachtwoord123");
    expect(await bcrypt.compare("SterkTestWachtwoord123", hash)).toBe(true);
    expect(await bcrypt.compare("verkeerd", hash)).toBe(false);
  });

  it("laat een ADMIN camera verwijderen ook bij ontbrekende expliciete permission-link", () => { expect(isAuthorized([], PERMISSIONS.CAMERAS_MANAGE, ["ADMIN"])).toBe(true); expect(isAuthorized([], PERMISSIONS.CAMERAS_MANAGE, ["VIEWER"])).toBe(false); });

  it("weigert een Viewer een beheerdersactie", () => {
    const viewer = [PERMISSIONS.CAMERAS_VIEW, PERMISSIONS.PASSAGES_VIEW];
    expect(isAuthorized(viewer, PERMISSIONS.USERS_MANAGE)).toBe(false);
    expect(isAuthorized(viewer, PERMISSIONS.CAMERAS_VIEW)).toBe(true);
  });
  it("laat een Operator locatiestatus bekijken maar niet beheren",()=>{const operator=[PERMISSIONS.LOCATIONS_VIEW];expect(isAuthorized(operator,PERMISSIONS.LOCATIONS_VIEW)).toBe(true);expect(isAuthorized(operator,PERMISSIONS.LOCATIONS_MANAGE)).toBe(false)});

  it("beperkt last-seen writes voor vaak pollende sessies", async () => {
    const user = { id: "user", email: "test@example.invalid", username: "test", displayName: "Test", active: true, roles: [] };
    const request = { cookies: { anpr_session: "token" } } as any;
    const reply = { code: vi.fn(), send: vi.fn(), clearCookie: vi.fn(), sent: false } as any;
    mocks.update.mockResolvedValue({});

    mocks.findUnique.mockResolvedValueOnce({ id: "session", tokenHash: "hash", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, lastSeenAt: new Date(), user });
    await authenticate(request, reply);
    expect(mocks.update).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValueOnce({ id: "session", tokenHash: "hash", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, lastSeenAt: new Date(Date.now() - 6 * 60_000), user });
    await authenticate(request, reply);
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
