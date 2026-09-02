import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  CAMERA_CREDENTIALS_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  STORAGE_PATH: z.string().min(1).default("/app/storage"),
  ANPR_WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4200),
  ANPR_CAMERA_REFRESH_SECONDS: z.coerce.number().int().min(2).max(300).default(10),
  ANPR_RECONNECT_MIN_SECONDS: z.coerce.number().int().min(1).max(60).default(2),
  ANPR_RECONNECT_MAX_SECONDS: z.coerce.number().int().min(5).max(600).default(60),
  ANPR_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(3).max(60).default(10),
  ANPR_DEDUPE_WINDOW_SECONDS: z.coerce.number().int().min(1).max(30).default(3),
  ANPR_MAX_IMAGE_BYTES: z.coerce.number().int().min(100_000).max(25_000_000).default(8_000_000)
}).superRefine((value, ctx) => {
  if (value.ANPR_RECONNECT_MAX_SECONDS < value.ANPR_RECONNECT_MIN_SECONDS) {
    ctx.addIssue({ code: "custom", path: ["ANPR_RECONNECT_MAX_SECONDS"], message: "moet minimaal de minimumwachttijd zijn" });
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) throw new Error(`Ongeldige ANPR-workerconfiguratie: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ")}`);
export const config = parsed.data;
