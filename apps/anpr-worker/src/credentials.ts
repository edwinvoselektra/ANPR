import { createDecipheriv } from "node:crypto";

export function decryptCredential(value: string | null, keyHex: string): string | undefined {
  if (!value) return undefined;
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Onbekend credentialformaat");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function redactPlate(plate: string): string { void plate; return "<REDACTED>"; }
