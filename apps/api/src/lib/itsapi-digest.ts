import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ITSAPI_REALM = "ANPR-ITSAPI";
const lifetime = 300_000;
const digest = (value: string) => createHash("md5").update(value).digest("hex");
const mac = (key: string, value: string) => createHmac("sha256", key).update(`itsapi-nonce:${value}`).digest("hex");
function equal(a: string, b: string) { return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
export function challenge(key: string, now = Date.now()) {
  const value = `${now}.${randomBytes(16).toString("hex")}`;
  return `Digest realm="${ITSAPI_REALM}", nonce="${value}.${mac(key, value)}", algorithm=MD5, qop="auth"`;
}
export function parseDigest(header: string | undefined) {
  if (!header || header.length > 4096 || !header.startsWith("Digest ")) return null;
  const fields: Record<string,string> = Object.create(null);
  for (const match of header.slice(7).matchAll(/([A-Za-z]+)\s*=\s*(?:"([^"\r\n]*)"|([^,\s]+))/g)) {
    if (fields[match[1]!]) return null;
    fields[match[1]!] = match[2] ?? match[3]!;
  }
  return fields;
}
export function verifyDigest(input: { header: string; method: string; uri: string; username: string; password: string; key: string; now?: number }) {
  const p = parseDigest(input.header);
  if (!p || p.username !== input.username || p.realm !== ITSAPI_REALM || p.uri !== input.uri || p.qop !== "auth" || (p.algorithm && p.algorithm.toUpperCase() !== "MD5") || !/^[0-9a-f]{8}$/i.test(p.nc ?? "") || !p.cnonce || p.cnonce.length > 128 || !/^[0-9a-f]{32}$/i.test(p.response ?? "")) return null;
  const parts = p.nonce?.split(".") ?? [];
  const time = Number(parts[0]);
  const now = input.now ?? Date.now();
  if (parts.length !== 3 || !Number.isFinite(time) || now - time > lifetime || time > now + 5000 || !equal(mac(input.key, `${parts[0]}.${parts[1]}`), parts[2]!)) return null;
  const expected = digest(`${digest(`${input.username}:${ITSAPI_REALM}:${input.password}`)}:${p.nonce}:${p.nc}:${p.cnonce}:auth:${digest(`${input.method}:${input.uri}`)}`);
  if (!equal(expected, p.response!.toLowerCase()) || parseInt(p.nc!,16) < 1) return null;
  return { key: createHash("sha256").update(`${input.username}:${p.nonce}:${p.cnonce}`).digest("hex"), count: parseInt(p.nc!,16), expiresAt: new Date(time + lifetime) };
}
