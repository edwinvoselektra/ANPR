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
