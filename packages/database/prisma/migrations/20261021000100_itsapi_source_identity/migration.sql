-- Fail closed on existing duplicates; never silently reassign a device identity.
BEGIN;
CREATE UNIQUE INDEX "ItsapiRegistration_expectedDeviceId_key" ON "ItsapiRegistration"("expectedDeviceId");
ALTER TABLE "ItsapiRegistration" ADD COLUMN "expectedSourceIp" TEXT;
COMMIT;
