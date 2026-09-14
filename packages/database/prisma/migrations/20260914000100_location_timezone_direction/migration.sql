ALTER TYPE "CameraDirection" ADD VALUE IF NOT EXISTS 'UNKNOWN';
ALTER TABLE "VpnLocation" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Amsterdam';
ALTER TABLE "Passage" ADD COLUMN "timezone" TEXT;
-- Historical timestamps and legacy BOTH values are deliberately not rewritten.
