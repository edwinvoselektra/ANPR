-- Phase 2.2 extends existing camera and passage records without deleting data.
CREATE TYPE "CameraAnprProvider" AS ENUM ('NONE', 'DAHUA_CGI');
CREATE TYPE "AnprConnectionStatus" AS ENUM ('DISABLED', 'CONNECTING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

ALTER TYPE "PassageSource" ADD VALUE 'DAHUA_CAMERA';
ALTER TYPE "PassageSource" ADD VALUE 'SERVER_OCR';

ALTER TABLE "Camera"
  ADD COLUMN "anprProvider" "CameraAnprProvider" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "anprHttpProtocol" TEXT NOT NULL DEFAULT 'http',
  ADD COLUMN "anprHttpPort" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN "anprChannel" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "anprConnectionStatus" "AnprConnectionStatus" NOT NULL DEFAULT 'DISABLED',
  ADD COLUMN "lastAnprConnectionAt" TIMESTAMP(3),
  ADD COLUMN "lastAnprEventAt" TIMESTAMP(3),
  ADD COLUMN "lastAnprErrorCode" TEXT,
  ADD COLUMN "lastAnprError" TEXT,
  ADD COLUMN "capabilities" JSONB;

ALTER TABLE "Passage"
  ADD COLUMN "vehicleBrand" TEXT,
  ADD COLUMN "plateCountry" TEXT,
  ADD COLUMN "lane" INTEGER,
  ADD COLUMN "sourceEventId" TEXT,
  ADD COLUMN "rawEventMetadata" JSONB;

CREATE UNIQUE INDEX "Passage_cameraId_source_sourceEventId_key"
  ON "Passage"("cameraId", "source", "sourceEventId");
