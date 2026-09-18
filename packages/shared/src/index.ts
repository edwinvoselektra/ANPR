export const PERMISSIONS = {
  USERS_MANAGE: "users.manage",
  CAMERAS_MANAGE: "cameras.manage",
  CAMERAS_VIEW: "cameras.view",
  LOCATIONS_MANAGE: "locations.manage",
  LOCATIONS_VIEW: "locations.view",
  PASSAGES_VIEW: "passages.view",
  PLATES_MANAGE: "plates.manage",
  HITS_VIEW: "hits.view",
  SIMULATOR_RUN: "simulator.run",
  SYSTEM_VIEW: "system.view",
  SETTINGS_MANAGE: "settings.manage",
  AUDIT_VIEW: "audit.view"
} as const;

export const VIDEO_WORKER_HEARTBEAT_KEY = "anpr:video-worker:heartbeat:v1";
export const VIDEO_WORKER_HEARTBEAT_STALE_MS = 15_000;
export const ANPR_WORKER_HEARTBEAT_KEY = "anpr:anpr-worker:heartbeat:v1";
export const ANPR_WORKER_HEARTBEAT_STALE_MS = 15_000;

export const CAMERA_DIRECTION_MAPPINGS = ["TOWARD_CAMERA_IS_INCOMING", "AWAY_FROM_CAMERA_IS_INCOMING"] as const;
export type CameraDirectionMapping = typeof CAMERA_DIRECTION_MAPPINGS[number];
export type CameraSourceDirection = "TOWARD_CAMERA" | "AWAY_FROM_CAMERA";

export function mapCameraDirection(source: CameraSourceDirection | undefined, mapping: CameraDirectionMapping): "INCOMING" | "OUTGOING" | "UNKNOWN" {
  if (!source) return "UNKNOWN";
  const towardIsIncoming = mapping === "TOWARD_CAMERA_IS_INCOMING";
  return source === "TOWARD_CAMERA" ? (towardIsIncoming ? "INCOMING" : "OUTGOING") : (towardIsIncoming ? "OUTGOING" : "INCOMING");
}

export function normalizeLicensePlate(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function displayLicensePlate(value: string): string {
  const normalized = normalizeLicensePlate(value);
  if (/^\d{2}[A-Z]{3}\d$/.test(normalized)) {
    return `${normalized.slice(0, 2)}-${normalized.slice(2, 5)}-${normalized.slice(5)}`;
  }
  return normalized;
}

export function calculatePassageExpiry(timestamp: Date, retentionDays = 14): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new Error("Ongeldige retentietermijn");
  return new Date(timestamp.getTime() + retentionDays * 86_400_000);
}

export function shouldCreateHit(member: { active: boolean; groupActive: boolean; validFrom?: Date | null; validUntil?: Date | null }, now = new Date()): boolean {
  return member.active && member.groupActive && (!member.validFrom || member.validFrom <= now) && (!member.validUntil || member.validUntil >= now);
}

/** Accept a bare host or a camera URL without credentials, paths or query. */
export function normalizeCameraHost(value: string): string {
  const input = value.trim();
  try {
    const url = new URL(input.includes("://") ? input : `http://${input}`);
    if (!["http:", "https:", "rtsp:", "rtsps:"].includes(url.protocol) || url.username || url.password || url.port || (url.pathname && url.pathname !== "/") || url.search || url.hash || !url.hostname) throw new Error();
    if (!/^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/i.test(url.hostname) && !/^\[[a-f0-9:]+\]$/i.test(url.hostname)) throw new Error();
    return url.hostname;
  } catch { throw new Error("Vul een geldig hostadres in, zonder credentials, poort, pad of query. Gebruik voor een volledige RTSP-URL de URL-optie."); }
}

export * from "./presentation.js";
export * from "./attention-score.js";
