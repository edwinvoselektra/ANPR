/**
 * No verified request/response specification for the installed Dahua firmware was supplied.
 * The manual confirms HTTP/JSON/Digest, NOT event schemas or acknowledgment semantics.
 * Do not add a guessed TollgateInfo mapping here. A profile needs primary documentation
 * or a redacted hardware request + verified acknowledgment; see docs/itsapi-receiver.md.
 */
export const ITSAPI_VERSION = "V1.19";
export const ITSAPI_HEARTBEAT_PATH = "/NotificationInfo/KeepAlive";
export const ITSAPI_ANPR_PATH = "/NotificationInfo/TollgateInfo";
export const ITSAPI_PROTOCOL_VERIFIED = false;
export const ITSAPI_PROTOCOL_GAP = "Protocolbewijs ontbreekt: HTTP-methode, registratiepad, Device ID-veld, heartbeat-/passagepayload, beeldcodering en vereiste bevestiging.";

export function payloadShape(value: unknown): unknown {
  let budget = 80;
  function walk(item: unknown, depth: number): unknown {
    if (--budget < 0 || depth > 4) return "begrensd";
    if (item === null) return "null";
    if (Array.isArray(item)) return { type: "array", count: item.length, item: item.length ? walk(item[0],depth+1) : null };
    if (typeof item === "object") return Object.fromEntries(Object.entries(item).slice(0,30)
      .filter(([key]) => /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(key) && !/password|secret|token|auth|image|picture|base64|plate|license/i.test(key))
      .map(([key,v]) => [key,walk(v,depth+1)]));
    return typeof item; // Never retain scalar values, plates, image data, URLs or credentials.
  }
  return walk(value,0);
}
