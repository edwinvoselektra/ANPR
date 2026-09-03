-- Fase 2.4: veilige Web Push-apparaten, gebruikersvoorkeuren en afleverhistorie.
ALTER TYPE "NotificationStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "PushSubscription" RENAME COLUMN "active" TO "enabled";
ALTER TABLE "PushSubscription"
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "deviceName" TEXT,
  ADD COLUMN "lastSuccessfulAt" TIMESTAMP(3),
  ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS "PushSubscription_userId_active_idx";
CREATE INDEX "PushSubscription_userId_enabled_idx" ON "PushSubscription"("userId", "enabled");

CREATE TABLE "NotificationPreference" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
  "allHitGroups" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "NotificationPreferenceGroup" (
  "preferenceId" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  CONSTRAINT "NotificationPreferenceGroup_pkey" PRIMARY KEY ("preferenceId", "groupId")
);
CREATE INDEX "NotificationPreferenceGroup_groupId_idx" ON "NotificationPreferenceGroup"("groupId");
ALTER TABLE "NotificationPreferenceGroup" ADD CONSTRAINT "NotificationPreferenceGroup_preferenceId_fkey"
  FOREIGN KEY ("preferenceId") REFERENCES "NotificationPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreferenceGroup" ADD CONSTRAINT "NotificationPreferenceGroup_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "PlateGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Notification" ALTER COLUMN "hitId" DROP NOT NULL;
ALTER TABLE "Notification"
  ADD COLUMN "subscriptionId" UUID,
  ADD COLUMN "deduplicationKey" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failureCategory" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Notification" SET "deduplicationKey" = 'legacy:' || "id" WHERE "deduplicationKey" IS NULL;
ALTER TABLE "Notification" ALTER COLUMN "deduplicationKey" SET NOT NULL;
CREATE UNIQUE INDEX "Notification_deduplicationKey_key" ON "Notification"("deduplicationKey");
CREATE INDEX "Notification_subscriptionId_status_idx" ON "Notification"("subscriptionId", "status");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
