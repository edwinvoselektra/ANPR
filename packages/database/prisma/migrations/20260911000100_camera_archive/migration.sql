ALTER TABLE "Camera" ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "historicalName" TEXT;
ALTER TABLE "Camera" ADD COLUMN "rtspEnabled" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Camera" SET "rtspEnabled" = false WHERE "rtspHost" IS NULL;
