import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { PERMISSIONS } from "@anpr/shared";
import { isAuthorized } from "./auth.js";

describe("authenticatie en permissions", () => {
  it("verifieert een veilig gehasht wachtwoord", async () => {
    const hash = await bcrypt.hash("SterkTestWachtwoord123", 12);
    expect(hash).not.toContain("SterkTestWachtwoord123");
    expect(await bcrypt.compare("SterkTestWachtwoord123", hash)).toBe(true);
    expect(await bcrypt.compare("verkeerd", hash)).toBe(false);
  });

  it("weigert een Viewer een beheerdersactie", () => {
    const viewer = [PERMISSIONS.CAMERAS_VIEW, PERMISSIONS.PASSAGES_VIEW];
    expect(isAuthorized(viewer, PERMISSIONS.USERS_MANAGE)).toBe(false);
    expect(isAuthorized(viewer, PERMISSIONS.CAMERAS_VIEW)).toBe(true);
  });
});
