import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashToken } from "./crypto.js";

describe("secretbeveiliging", () => {
  it("versleutelt en ontsleutelt credentials", () => {
    const encrypted = encryptSecret("camera-wachtwoord");
    expect(encrypted).not.toContain("camera-wachtwoord");
    expect(decryptSecret(encrypted)).toBe("camera-wachtwoord");
  });
  it("hasht sessietokens deterministisch", () => {
    expect(hashToken("test")).toHaveLength(64);
    expect(hashToken("test")).toBe(hashToken("test"));
  });
});
