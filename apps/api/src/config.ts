import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  CAMERA_CREDENTIALS_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "moet exact 64 hex-tekens zijn"),
  WEB_ORIGIN: z.string().url(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  STORAGE_PATH: z.string().min(1).default("/app/storage"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DEMO_MODE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  VAPID_PUBLIC_KEY: z.string().trim().optional().transform((value) => value || undefined),
  VAPID_PRIVATE_KEY: z.string().trim().optional().transform((value) => value || undefined),
  VAPID_SUBJECT: z.string().trim().optional().transform((value) => value || undefined)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
  throw new Error(`Ongeldige serverconfiguratie: ${message}`);
}

export const config = parsed.data;
