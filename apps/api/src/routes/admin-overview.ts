import { lstat, opendir, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { requireAdmin } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

type StorageSummary = { programBytes: number | null; storageBytes: number | null; totalBytes: number | null };
type AuditValue = Record<string, unknown> | null;

async function directoryBytes(root: string, excludedRoot?: string): Promise<number> {
  const rootPath = await realpath(root);
  const excluded = excludedRoot ? await realpath(excludedRoot).catch(() => resolve(excludedRoot)) : undefined;
  let bytes = 0;
  const pending = [rootPath];
  while (pending.length) {
    const directory = pending.pop()!;
    if (excluded && (directory === excluded || directory.startsWith(`${excluded}${sep}`))) continue;
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (excluded && (path === excluded || path.startsWith(`${excluded}${sep}`))) continue;
      const info = await lstat(path);
      if (info.isDirectory()) pending.push(path);
      else if (info.isFile()) bytes += info.size;
    }
  }
  return bytes;
}

export async function measureSystemStorage(): Promise<StorageSummary> {
  const [program, media, database] = await Promise.allSettled([
    directoryBytes("/app", config.STORAGE_PATH),
    directoryBytes(config.STORAGE_PATH),
    prisma.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database())::bigint AS bytes`
  ]);
  const programBytes = program.status === "fulfilled" ? program.value : null;
  const mediaBytes = media.status === "fulfilled" ? media.value : null;
  const databaseBytes = database.status === "fulfilled" && database.value[0] ? Number(database.value[0].bytes) : null;
  const storageBytes = mediaBytes === null || databaseBytes === null ? null : mediaBytes + databaseBytes;
  return { programBytes, storageBytes, totalBytes: programBytes === null || storageBytes === null ? null : programBytes + storageBytes };
}

let storageCache: { expiresAt: number; value: StorageSummary } | undefined;
async function cachedSystemStorage() {
  if (storageCache && storageCache.expiresAt > Date.now()) return storageCache.value;
  const value = await measureSystemStorage();
  storageCache = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

const actionLabels: Record<string, string> = {
  AUTH_LOGIN: "Ingelogd", AUTH_LOGOUT: "Uitgelogd", AUTH_LOGOUT_ALL: "Alle sessies afgemeld", AUTH_LOGIN_FAILED: "Inlogpoging mislukt",
  USER_CREATED: "Gebruiker aangemaakt", USER_UPDATED: "Gebruiker gewijzigd", USER_DELETED: "Gebruiker verwijderd", USER_PASSWORD_RESET: "Wachtwoord opnieuw ingesteld",
  CAMERA_CREATED: "Camera toegevoegd", CAMERA_UPDATED: "Camera gewijzigd", CAMERA_ARCHIVED: "Camera verwijderd", CAMERA_CONNECTION_TESTED: "Cameraverbinding getest",
  CAMERA_DRAFT_CREATED: "Cameraconcept aangemaakt", CAMERA_DRAFT_FINALIZED: "Camera toegevoegd", ITSAPI_REGISTRATION_CONFIGURED: "ITSAPI ingesteld",
  VPN_LOCATION_CREATED: "Locatie toegevoegd", VPN_LOCATION_UPDATED: "Locatie/VPN gewijzigd", VPN_LOCATION_DELETED: "Locatie verwijderd", VPN_CONNECTION_TESTED: "VPN-verbinding getest", VPN_CONFIGURATION_GENERATED: "VPN-configuratie gemaakt",
  PLATE_CREATED: "Kenteken toegevoegd", PLATE_UPDATED: "Kenteken gewijzigd", PLATE_DELETED: "Kenteken verwijderd", PLATE_ADDED_TO_GROUP: "Kenteken aan groep toegevoegd", PLATE_REMOVED_FROM_GROUP: "Kenteken uit groep verwijderd",
  PLATE_GROUP_CREATED: "Groep toegevoegd", PLATE_GROUP_UPDATED: "Groep gewijzigd", PLATE_GROUP_DELETED: "Groep verwijderd",
  NOTIFICATION_PREFERENCES_UPDATED: "Meldingsinstellingen gewijzigd", PUSH_DEVICE_ADDED: "Pushapparaat toegevoegd", PUSH_DEVICE_REMOVED: "Pushapparaat verwijderd",
  DEMO_PASSAGE_CREATED: "Demopassage aangemaakt", DEVICE_CONNECTION_TESTED: "Apparaatverbinding getest", FIRST_ADMIN_CREATED: "Eerste administrator aangemaakt"
};

function valueObject(value: unknown): AuditValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeLabel(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : undefined;
}

function objectLabel(log: { objectType: string | null; objectId: string | null; oldValue: unknown; newValue: unknown }) {
  const oldValue = valueObject(log.oldValue);
  const newValue = valueObject(log.newValue);
  const preferredKeys = log.objectType === "User" ? ["displayName", "username"] : ["name", "displayName", "licensePlate", "displayLicensePlate"];
  for (const key of preferredKeys) {
    const label = safeLabel(newValue?.[key]) ?? safeLabel(oldValue?.[key]);
    if (label) return label;
  }
  if (log.objectType === "Plate" || log.objectType === "PlateGroupMember") return safeLabel(log.objectId) ?? "Kenteken";
  const generic: Record<string, string> = { UserSession: "Gebruikerssessie", NotificationPreference: "Pushmeldingen", PushSubscription: "Pushapparaat", Passage: "Passage", Camera: "Camera", VpnLocation: "Locatie", PlateGroup: "Groep" };
  return generic[log.objectType ?? ""] ?? log.objectType ?? "Platform";
}

function roleSignature(value: unknown) {
  const roles = valueObject(value)?.roles;
  if (!Array.isArray(roles)) return undefined;
  return JSON.stringify(roles.map((entry) => valueObject(valueObject(entry)?.role)?.id ?? valueObject(valueObject(entry)?.role)?.name).filter(Boolean).sort());
}

function actionLabel(action: string, oldValue?: unknown, newValue?: unknown) {
  if (action === "USER_UPDATED") {
    const before = roleSignature(oldValue); const after = roleSignature(newValue);
    if (before !== undefined && after !== undefined && before !== after) return "Rol gewijzigd";
  }
  return actionLabels[action] ?? action.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export async function registerAdminOverviewRoutes(app: FastifyInstance, measure: () => Promise<StorageSummary>) {
  app.get("/admin/overview", { preHandler: requireAdmin() }, async () => {
    const [storage, logs] = await Promise.all([
      measure().catch(() => ({ programBytes: null, storageBytes: null, totalBytes: null })),
      prisma.auditLog.findMany({
        take: 20, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, action: true, objectType: true, objectId: true, oldValue: true, newValue: true, createdAt: true, actor: { select: { displayName: true, username: true } } }
      })
    ]);
    return {
      storage,
      storageNote: "Programma meet de draaiende API-app met dependencies/build; Opslag meet PostgreSQL en het mediavolume. Docker-images en Docker-logs zijn niet beschikbaar in de container.",
      timeZone: config.PLATFORM_TIMEZONE,
      activity: logs.map((log) => {
        const action = actionLabel(log.action, log.oldValue, log.newValue);
        const actorName = log.actor?.displayName ?? log.actor?.username;
        const object = log.action.startsWith("AUTH_") && actorName ? actorName : objectLabel(log);
        return { id: log.id, createdAt: log.createdAt, user: log.actor?.displayName ?? log.actor?.username ?? "Systeem", action, object, description: `${action}: ${object}.` };
      })
    };
  });
}

export async function adminOverviewRoutes(app: FastifyInstance) {
  await registerAdminOverviewRoutes(app, cachedSystemStorage);
}
