CREATE TYPE "LocationRouterType" AS ENUM ('TP_LINK_OMADA_ER605', 'MANUAL_OTHER');
CREATE TYPE "VpnType" AS ENUM ('WIREGUARD');
CREATE TYPE "VpnMode" AS ENUM ('SERVER_TO_LOCATION', 'LOCATION_TO_SERVER');
CREATE TYPE "LocationConnectionStatus" AS ENUM ('UNKNOWN', 'CONNECTING', 'ONLINE', 'DEGRADED', 'OFFLINE');

CREATE TABLE "VpnLocation" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "routerType" "LocationRouterType" NOT NULL,
  "vpnType" "VpnType" NOT NULL DEFAULT 'WIREGUARD',
  "vpnMode" "VpnMode" NOT NULL DEFAULT 'LOCATION_TO_SERVER',
  "tunnelAddress" TEXT NOT NULL,
  "remoteLanCidr" TEXT NOT NULL,
  "remoteGatewayIp" TEXT,
  "endpointHost" TEXT,
  "listenPort" INTEGER NOT NULL DEFAULT 51820,
  "mtu" INTEGER NOT NULL DEFAULT 1420,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "publicKey" TEXT,
  "privateKeyEncrypted" TEXT,
  "connectionStatus" "LocationConnectionStatus" NOT NULL DEFAULT 'UNKNOWN',
  "tunnelOnline" BOOLEAN,
  "routeReachable" BOOLEAN,
  "recorderReachable" BOOLEAN,
  "recorderPortOpen" BOOLEAN,
  "lastHandshakeAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "lastHealthErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VpnLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Recorder" (
  "id" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "ipAddress" TEXT NOT NULL,
  "rtspPort" INTEGER NOT NULL DEFAULT 554,
  "channelCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Recorder_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Camera" ADD COLUMN "locationId" UUID;
ALTER TABLE "Camera" ADD COLUMN "recorderId" UUID;

CREATE UNIQUE INDEX "VpnLocation_name_key" ON "VpnLocation"("name");
CREATE UNIQUE INDEX "VpnLocation_tunnelAddress_key" ON "VpnLocation"("tunnelAddress");
CREATE INDEX "VpnLocation_active_name_idx" ON "VpnLocation"("active", "name");
CREATE INDEX "VpnLocation_connectionStatus_idx" ON "VpnLocation"("connectionStatus");
CREATE UNIQUE INDEX "Recorder_locationId_name_key" ON "Recorder"("locationId", "name");
CREATE INDEX "Recorder_locationId_idx" ON "Recorder"("locationId");
CREATE INDEX "Camera_locationId_idx" ON "Camera"("locationId");
CREATE INDEX "Camera_recorderId_idx" ON "Camera"("recorderId");

ALTER TABLE "Recorder" ADD CONSTRAINT "Recorder_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "VpnLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "VpnLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_recorderId_fkey" FOREIGN KEY ("recorderId") REFERENCES "Recorder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bestaande installaties krijgen de nieuwe rechten zonder dat seed bestaande data hoeft te wijzigen.
INSERT INTO "Permission" ("id", "key", "description") VALUES
  ('24500000-0000-4000-8000-000000000001', 'locations.manage', 'VPN-locaties beheren en verbindingen testen'),
  ('24500000-0000-4000-8000-000000000002', 'locations.view', 'VPN-locaties en verbindingsstatus bekijken')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id" FROM "Role" role CROSS JOIN "Permission" permission
WHERE role."name" = 'Administrator' AND permission."key" IN ('locations.manage', 'locations.view')
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id" FROM "Role" role CROSS JOIN "Permission" permission
WHERE role."name" = 'Operator' AND permission."key" = 'locations.view'
ON CONFLICT DO NOTHING;
