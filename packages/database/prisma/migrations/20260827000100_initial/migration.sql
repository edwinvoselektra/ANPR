CREATE TYPE "CameraDirection" AS ENUM ('INCOMING', 'OUTGOING', 'BOTH');
CREATE TYPE "CameraStatus" AS ENUM ('ONLINE', 'OFFLINE', 'CONNECTION_PROBLEM', 'ANPR_UNAVAILABLE', 'DISABLED');
CREATE TYPE "CameraConnectionMode" AS ENUM ('URL', 'FIELDS');
CREATE TYPE "CameraZoneType" AS ENUM ('RECTANGLE', 'POLYGON');
CREATE TYPE "PassageSource" AS ENUM ('DEMO', 'ANPR', 'MANUAL');
CREATE TYPE "PassageStatus" AS ENUM ('ACTIVE', 'REVIEW', 'DELETED');
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'VAN', 'TRUCK', 'MOTORCYCLE', 'BUS', 'TRAILER', 'UNKNOWN');
CREATE TYPE "VehicleColor" AS ENUM ('BLACK', 'WHITE', 'GRAY', 'SILVER', 'RED', 'BLUE', 'GREEN', 'YELLOW', 'BROWN', 'ORANGE', 'OTHER', 'UNKNOWN');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "User" (
  "id" UUID NOT NULL, "email" TEXT NOT NULL, "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "failedLoginCount" INTEGER NOT NULL DEFAULT 0, "lockedUntil" TIMESTAMP(3), "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Role" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "system" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Permission" (
  "id" UUID NOT NULL, "key" TEXT NOT NULL, "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "UserRole" ("userId" UUID NOT NULL, "roleId" UUID NOT NULL, CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId", "roleId"));
CREATE TABLE "RolePermission" ("roleId" UUID NOT NULL, "permissionId" UUID NOT NULL, CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId"));
CREATE TABLE "UserSession" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "tokenHash" TEXT NOT NULL, "ipAddress" TEXT,
  "userAgent" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Camera" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "location" TEXT NOT NULL, "description" TEXT,
  "connectionMode" "CameraConnectionMode" NOT NULL DEFAULT 'FIELDS', "rtspProtocol" TEXT NOT NULL DEFAULT 'rtsp', "rtspHost" TEXT,
  "rtspPort" INTEGER NOT NULL DEFAULT 554, "rtspPath" TEXT, "rtspUsernameEncrypted" TEXT,
  "rtspPasswordEncrypted" TEXT, "direction" "CameraDirection" NOT NULL,
  "status" "CameraStatus" NOT NULL DEFAULT 'DISABLED', "lastConnectionAt" TIMESTAMP(3),
  "lastConnectionSuccessAt" TIMESTAMP(3), "lastConnectionErrorCode" TEXT, "lastConnectionError" TEXT,
  "lastVehicleRegistrationAt" TIMESTAMP(3), "lastSnapshotObjectId" TEXT, "active" BOOLEAN NOT NULL DEFAULT false,
  "anprSettings" JSONB, "vehicleDetectionSettings" JSONB, "latitude" DECIMAL(9,6), "longitude" DECIMAL(9,6),
  "displayOrder" INTEGER NOT NULL DEFAULT 0, "offlineTimeoutSeconds" INTEGER NOT NULL DEFAULT 120,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CameraZone" (
  "id" UUID NOT NULL, "cameraId" UUID NOT NULL, "name" TEXT NOT NULL DEFAULT 'Herkenningsgebied',
  "type" "CameraZoneType" NOT NULL, "points" JSONB NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CameraZone_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Passage" (
  "id" UUID NOT NULL, "originalLicensePlate" TEXT NOT NULL, "normalizedLicensePlate" TEXT NOT NULL,
  "displayLicensePlate" TEXT NOT NULL, "plateConfidence" DOUBLE PRECISION, "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cameraId" UUID NOT NULL, "location" TEXT NOT NULL, "direction" "CameraDirection" NOT NULL,
  "vehicleColor" "VehicleColor" NOT NULL DEFAULT 'UNKNOWN', "vehicleType" "VehicleType" NOT NULL DEFAULT 'UNKNOWN',
  "vehicleConfidence" DOUBLE PRECISION, "vehicleImage1ObjectId" TEXT, "vehicleImage2ObjectId" TEXT,
  "plateImageObjectId" TEXT, "isHit" BOOLEAN NOT NULL DEFAULT false, "status" "PassageStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "PassageSource" NOT NULL DEFAULT 'ANPR', "trackId" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Passage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Vehicle" (
  "id" UUID NOT NULL, "passageId" UUID NOT NULL, "type" "VehicleType" NOT NULL, "color" "VehicleColor" NOT NULL,
  "confidence" DOUBLE PRECISION, "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlateDetection" (
  "id" UUID NOT NULL, "passageId" UUID NOT NULL, "rawLicensePlate" TEXT NOT NULL,
  "normalizedLicensePlate" TEXT NOT NULL, "confidence" DOUBLE PRECISION NOT NULL, "frameObjectId" TEXT,
  "frameTimestampMs" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlateDetection_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlateGroup" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "description" TEXT, "color" TEXT NOT NULL, "icon" TEXT,
  "pushNotifications" BOOLEAN NOT NULL DEFAULT false, "active" BOOLEAN NOT NULL DEFAULT true,
  "reasonRequired" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PlateGroup_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PlateGroupMember" (
  "id" UUID NOT NULL, "groupId" UUID NOT NULL, "normalizedLicensePlate" TEXT NOT NULL,
  "displayLicensePlate" TEXT NOT NULL, "reason" TEXT, "description" TEXT, "note" TEXT,
  "validFrom" TIMESTAMP(3), "validUntil" TIMESTAMP(3), "active" BOOLEAN NOT NULL DEFAULT true,
  "addedById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlateGroupMember_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Hit" (
  "id" UUID NOT NULL, "passageId" UUID NOT NULL, "cameraId" UUID NOT NULL, "groupId" UUID NOT NULL,
  "normalizedLicensePlate" TEXT NOT NULL, "location" TEXT NOT NULL, "timestamp" TIMESTAMP(3) NOT NULL,
  "vehicleImageObjectId" TEXT, "plateImageObjectId" TEXT, "reason" TEXT,
  "notificationSent" BOOLEAN NOT NULL DEFAULT false, "notificationStatus" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Hit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Notification" (
  "id" UUID NOT NULL, "hitId" UUID NOT NULL, "recipientId" UUID, "channel" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING', "sentAt" TIMESTAMP(3), "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PushSubscription" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "endpoint" TEXT NOT NULL, "p256dh" TEXT NOT NULL, "auth" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL, "actorId" UUID, "action" TEXT NOT NULL, "objectType" TEXT, "objectId" TEXT,
  "ipAddress" TEXT, "oldValue" JSONB, "newValue" JSONB, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SystemSetting" ("key" TEXT NOT NULL, "value" JSONB NOT NULL, "description" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key"));
CREATE TABLE "RetentionException" (
  "id" UUID NOT NULL, "passageId" UUID NOT NULL, "userId" UUID NOT NULL, "reason" TEXT NOT NULL,
  "originalExpiresAt" TIMESTAMP(3) NOT NULL, "newExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "RetentionException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");
CREATE UNIQUE INDEX "Camera_name_key" ON "Camera"("name");
CREATE INDEX "Camera_active_displayOrder_idx" ON "Camera"("active", "displayOrder");
CREATE INDEX "Camera_status_idx" ON "Camera"("status");
CREATE INDEX "CameraZone_cameraId_idx" ON "CameraZone"("cameraId");
CREATE INDEX "Passage_normalizedLicensePlate_idx" ON "Passage"("normalizedLicensePlate");
CREATE INDEX "Passage_timestamp_idx" ON "Passage"("timestamp");
CREATE INDEX "Passage_cameraId_timestamp_idx" ON "Passage"("cameraId", "timestamp");
CREATE INDEX "Passage_vehicleColor_idx" ON "Passage"("vehicleColor");
CREATE INDEX "Passage_vehicleType_idx" ON "Passage"("vehicleType");
CREATE INDEX "Passage_isHit_timestamp_idx" ON "Passage"("isHit", "timestamp");
CREATE INDEX "Passage_expiresAt_idx" ON "Passage"("expiresAt");
CREATE UNIQUE INDEX "Vehicle_passageId_key" ON "Vehicle"("passageId");
CREATE INDEX "PlateDetection_passageId_idx" ON "PlateDetection"("passageId");
CREATE INDEX "PlateDetection_normalizedLicensePlate_idx" ON "PlateDetection"("normalizedLicensePlate");
CREATE UNIQUE INDEX "PlateGroup_name_key" ON "PlateGroup"("name");
CREATE INDEX "PlateGroup_active_idx" ON "PlateGroup"("active");
CREATE UNIQUE INDEX "PlateGroupMember_groupId_normalizedLicensePlate_key" ON "PlateGroupMember"("groupId", "normalizedLicensePlate");
CREATE INDEX "PlateGroupMember_normalizedLicensePlate_active_idx" ON "PlateGroupMember"("normalizedLicensePlate", "active");
CREATE INDEX "PlateGroupMember_groupId_idx" ON "PlateGroupMember"("groupId");
CREATE INDEX "Hit_timestamp_idx" ON "Hit"("timestamp");
CREATE INDEX "Hit_normalizedLicensePlate_idx" ON "Hit"("normalizedLicensePlate");
CREATE INDEX "Hit_cameraId_idx" ON "Hit"("cameraId");
CREATE INDEX "Hit_groupId_idx" ON "Hit"("groupId");
CREATE INDEX "Notification_hitId_idx" ON "Notification"("hitId");
CREATE INDEX "Notification_recipientId_status_idx" ON "Notification"("recipientId", "status");
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_active_idx" ON "PushSubscription"("userId", "active");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_objectType_objectId_idx" ON "AuditLog"("objectType", "objectId");
CREATE INDEX "RetentionException_passageId_idx" ON "RetentionException"("passageId");
CREATE INDEX "RetentionException_newExpiresAt_idx" ON "RetentionException"("newExpiresAt");

ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CameraZone" ADD CONSTRAINT "CameraZone_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Passage" ADD CONSTRAINT "Passage_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "Passage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlateDetection" ADD CONSTRAINT "PlateDetection_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "Passage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlateGroupMember" ADD CONSTRAINT "PlateGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PlateGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlateGroupMember" ADD CONSTRAINT "PlateGroupMember_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Hit" ADD CONSTRAINT "Hit_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "Passage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Hit" ADD CONSTRAINT "Hit_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Hit" ADD CONSTRAINT "Hit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "PlateGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_hitId_fkey" FOREIGN KEY ("hitId") REFERENCES "Hit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetentionException" ADD CONSTRAINT "RetentionException_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "Passage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RetentionException" ADD CONSTRAINT "RetentionException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
