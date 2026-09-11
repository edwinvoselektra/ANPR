CREATE TYPE "DeviceConnectionType" AS ENUM ('DAHUA_TCP_SDK');
CREATE TYPE "DeviceCategory" AS ENUM ('CAMERA', 'NVR', 'AUTO');
CREATE TYPE "DeviceConnectionStatus" AS ENUM ('UNKNOWN', 'CONNECTING', 'CONNECTED', 'AUTH_FAILED', 'OFFLINE', 'ERROR');

CREATE TABLE "DeviceConnection" (
    "id" UUID NOT NULL,
    "type" "DeviceConnectionType" NOT NULL,
    "cameraId" UUID,
    "recorderId" UUID,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 37777,
    "usernameEncrypted" TEXT,
    "passwordEncrypted" TEXT,
    "requestedCategory" "DeviceCategory" NOT NULL DEFAULT 'AUTO',
    "detectedCategory" "DeviceCategory",
    "status" "DeviceConnectionStatus" NOT NULL DEFAULT 'UNKNOWN',
    "model" TEXT,
    "firmware" TEXT,
    "serialNumber" TEXT,
    "channelCount" INTEGER,
    "channels" JSONB,
    "capabilities" JSONB,
    "lastTestAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeviceConnection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeviceConnection_owner_check" CHECK (("cameraId" IS NOT NULL AND "recorderId" IS NULL) OR ("cameraId" IS NULL AND "recorderId" IS NOT NULL))
);

CREATE UNIQUE INDEX "DeviceConnection_cameraId_type_key" ON "DeviceConnection"("cameraId", "type");
CREATE UNIQUE INDEX "DeviceConnection_recorderId_type_key" ON "DeviceConnection"("recorderId", "type");
CREATE INDEX "DeviceConnection_status_idx" ON "DeviceConnection"("status");
CREATE INDEX "DeviceConnection_cameraId_idx" ON "DeviceConnection"("cameraId");
CREATE INDEX "DeviceConnection_recorderId_idx" ON "DeviceConnection"("recorderId");

ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceConnection" ADD CONSTRAINT "DeviceConnection_recorderId_fkey" FOREIGN KEY ("recorderId") REFERENCES "Recorder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
