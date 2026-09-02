import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  CAMERA_CREDENTIALS_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "moet exact 64 hex-tekens zijn"),
  STORAGE_PATH: z.string().min(1).default("/app/storage"),
  VIDEO_WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  VIDEO_SAMPLE_FPS: z.coerce.number().positive().max(1).default(0.1),
  VIDEO_RETRY_SECONDS: z.coerce.number().int().min(2).max(300).default(10),
  VIDEO_CAMERA_REFRESH_SECONDS: z.coerce.number().int().min(2).max(300).default(10),
  VIDEO_CAPTURE_TIMEOUT_SECONDS: z.coerce.number().int().min(3).max(60).default(15)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
  throw new Error(`Ongeldige video-workerconfiguratie: ${message}`);
}

export const config = parsed.data;
