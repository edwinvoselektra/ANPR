import { createDecipheriv } from "node:crypto";
import type { ManagedCamera } from "./types.js";

export function decryptCredential(value: string | null, keyHex: string): string | undefined {
  if (!value) return undefined;
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Onbekend credentialformaat");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function buildRtspUrl(camera: ManagedCamera, keyHex: string): string {
  if (!camera.rtspHost) throw new Error("Camera heeft geen RTSP-host.");
  const protocol = camera.rtspProtocol === "rtsps" ? "rtsps" : "rtsp";
  const username = decryptCredential(camera.rtspUsernameEncrypted, keyHex);
  const password = decryptCredential(camera.rtspPasswordEncrypted, keyHex);
  const auth = username ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@` : "";
  const path = camera.rtspPath?.startsWith("/") ? camera.rtspPath : `/${camera.rtspPath ?? ""}`;
  return `${protocol}://${auth}${camera.rtspHost}:${camera.rtspPort}${path}`;
}
