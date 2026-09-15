import { validTimeZone } from "@anpr/shared";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  CAMERA_CREDENTIALS_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "moet exact 64 hex-tekens zijn"),
  PLATFORM_TIMEZONE: z.string().refine(validTimeZone).default("Europe/Amsterdam"),
  WEB_ORIGIN: z.string().url(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  REMEMBER_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  STORAGE_PATH: z.string().min(1).default("/app/storage"),
  ITSAPI_PUBLISHED_PORT: z.coerce.number().int().min(1).max(65535).default(7070),
  ITSAPI_PORT: z.coerce.number().int().min(1024).max(65535).default(7070),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DEMO_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  VAPID_PUBLIC_KEY: z.string().trim().optional().transform((value) => value || undefined),
  VAPID_PRIVATE_KEY: z.string().trim().optional().transform((value) => value || undefined),
  VAPID_SUBJECT: z.string().trim().optional().transform((value) => value || undefined)
  ,VPN_TUNNEL_CIDR: z.string().default("10.100.0.0/24")
  ,VPN_SERVER_ADDRESS: z.string().default("10.100.0.1")
  ,VPN_SERVER_ENDPOINT: z.string().trim().optional().transform((value) => value || undefined)
  ,VPN_LISTEN_PORT: z.coerce.number().int().min(1).max(65535).default(51820)
  ,VPN_HEALTH_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(3600).default(30)
  ,VPN_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(250).max(10000).default(2000)
  ,VPN_STATUS_FILE: z.string().trim().optional().transform((value) => value || undefined)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
  throw new Error(`Ongeldige serverconfiguratie: ${message}`);
}

export const config = parsed.data;
