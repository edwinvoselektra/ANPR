import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { encryptSecret } from "./crypto.js";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");

export function generateWireGuardKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const privateRaw = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64");
  const publicRaw = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  return { privateKey: privateRaw, publicKey: publicRaw };
}

export function publicKeyFromPrivate(privateKey: string): string {
  const raw = Buffer.from(privateKey, "base64");
  if (raw.length !== 32) throw new Error("Ongeldige WireGuard private key.");
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
  return createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
}

export function encryptedWireGuardPrivateKey(value: string) { return encryptSecret(value); }
