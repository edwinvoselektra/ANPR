import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildRtspUrl, decryptCredential } from "./credentials.js";
import type { ManagedCamera } from "./types.js";

const keyHex = "00".repeat(32);
function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
const camera = (username: string, password: string): ManagedCamera => ({
  id: "11111111-1111-4111-8111-111111111111", name: "Dahua test", location: "Uddel",
  rtspProtocol: "rtsp", rtspHost: "192.0.2.10", rtspPort: 554,
  rtspPath: "/cam/realmonitor?channel=1&subtype=0",
  rtspUsernameEncrypted: encrypt(username), rtspPasswordEncrypted: encrypt(password), updatedAt: new Date(0)
});

describe("camera-credentials", () => {
  it("decrypt credentials alleen in geheugen voor de RTSP-verbinding", () => {
    const encrypted = encrypt("geheim");
    expect(decryptCredential(encrypted, keyHex)).toBe("geheim");
    expect(encrypted).not.toContain("geheim");
  });

  it("encodeert bijzondere tekens veilig in de interne RTSP-URL", () => {
    const url = buildRtspUrl(camera("camera gebruiker", "sterk@wachtwoord"), keyHex);
    expect(url).toContain("camera%20gebruiker:sterk%40wachtwoord@");
    expect(url).toContain("192.0.2.10:554/cam/realmonitor");
  });
});
