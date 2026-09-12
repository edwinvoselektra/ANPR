ALTER TYPE "CameraAnprProvider" ADD VALUE 'DAHUA_ITSAPI';
ALTER TABLE "Camera" ADD COLUMN "isDraft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "draftKey" UUID, ADD COLUMN "draftExpiresAt" TIMESTAMP(3),
ADD COLUMN "configVersion" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "videoTest" JSONB,
ADD COLUMN "videoTestVersion" INTEGER, ADD COLUMN "videoTestAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Camera_draftKey_key" ON "Camera"("draftKey");
CREATE TABLE "ItsapiRegistration" (
 "cameraId" UUID PRIMARY KEY REFERENCES "Camera"("id") ON DELETE CASCADE,
 "username" TEXT NOT NULL UNIQUE, "passwordEncrypted" TEXT NOT NULL,
 "expectedDeviceId" TEXT, "protocolVersion" TEXT, "receiverOrigin" TEXT,
 "heartbeatSeconds" INTEGER NOT NULL DEFAULT 300, "debugUntil" TIMESTAMP(3),
 "lastRequestAt" TIMESTAMP(3), "lastAuthenticatedAt" TIMESTAMP(3), "lastIdentityAt" TIMESTAMP(3),
 "lastHeartbeatAt" TIMESTAMP(3), "lastEventAt" TIMESTAMP(3), "lastErrorCode" TEXT,
 "evidenceVersion" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "ItsapiDigestReplay" ("key" TEXT PRIMARY KEY, "count" INTEGER NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL);
CREATE INDEX "ItsapiDigestReplay_expiresAt_idx" ON "ItsapiDigestReplay"("expiresAt");
CREATE TABLE "ItsapiInbox" (
 "id" UUID PRIMARY KEY, "cameraId" UUID NOT NULL REFERENCES "Camera"("id") ON DELETE CASCADE,
 "configVersion" INTEGER NOT NULL, "fingerprint" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'UNSUPPORTED',
 "kind" TEXT NOT NULL DEFAULT 'UNKNOWN', "evidence" JSONB NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 1,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ItsapiInbox_cameraId_configVersion_fingerprint_key" ON "ItsapiInbox"("cameraId", "configVersion", "fingerprint");
CREATE INDEX "ItsapiInbox_expiresAt_idx" ON "ItsapiInbox"("expiresAt");
CREATE INDEX "ItsapiInbox_cameraId_receivedAt_idx" ON "ItsapiInbox"("cameraId", "receivedAt");
