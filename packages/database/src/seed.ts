import { PrismaClient, type CameraDirection, type VehicleColor, type VehicleType } from "@prisma/client";
import { calculatePassageExpiry, displayLicensePlate, normalizeLicensePlate, PERMISSIONS } from "@anpr/shared";

const prisma = new PrismaClient();

const permissionDescriptions: Record<string, string> = {
  [PERMISSIONS.USERS_MANAGE]: "Gebruikers en rollen beheren",
  [PERMISSIONS.CAMERAS_MANAGE]: "Camera's toevoegen, wijzigen, testen en verwijderen",
  [PERMISSIONS.CAMERAS_VIEW]: "Camera's en camerastatus bekijken",
  [PERMISSIONS.PASSAGES_VIEW]: "Passages en dashboard bekijken",
  [PERMISSIONS.PLATES_MANAGE]: "Kentekens en groepen beheren",
  [PERMISSIONS.HITS_VIEW]: "Hits bekijken",
  [PERMISSIONS.SIMULATOR_RUN]: "Development-simulator bedienen",
  [PERMISSIONS.SYSTEM_VIEW]: "Systeemstatus bekijken",
  [PERMISSIONS.SETTINGS_MANAGE]: "Kritieke systeeminstellingen beheren",
  [PERMISSIONS.AUDIT_VIEW]: "Auditlog bekijken"
};

const rolePermissions: Record<string, string[]> = {
  Administrator: Object.values(PERMISSIONS),
  Operator: [PERMISSIONS.CAMERAS_VIEW, PERMISSIONS.PASSAGES_VIEW, PERMISSIONS.PLATES_MANAGE, PERMISSIONS.HITS_VIEW, PERMISSIONS.SIMULATOR_RUN],
  Viewer: [PERMISSIONS.CAMERAS_VIEW, PERMISSIONS.PASSAGES_VIEW, PERMISSIONS.HITS_VIEW]
};

async function seedSecurity() {
  const permissions = new Map<string, string>();
  for (const [key, description] of Object.entries(permissionDescriptions)) {
    const permission = await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
    permissions.set(key, permission.id);
  }
  for (const [name, keys] of Object.entries(rolePermissions)) {
    const role = await prisma.role.upsert({ where: { name }, update: { system: true }, create: { name, description: `${name}-rol`, system: true } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({ data: keys.map((key) => ({ roleId: role.id, permissionId: permissions.get(key)! })) });
  }
}

async function seedDemo() {
  if (process.env.DEMO_MODE !== "true") return;
  const definitions: Array<{ name: string; direction: CameraDirection; latitude: number; longitude: number }> = [
    { name: "Uddel Noord", direction: "INCOMING", latitude: 52.2726, longitude: 5.7802 },
    { name: "Uddel Oost", direction: "BOTH", latitude: 52.2579, longitude: 5.7971 },
    { name: "Uddel West", direction: "OUTGOING", latitude: 52.2568, longitude: 5.7609 }
  ];
  const cameras = [];
  for (const [index, item] of definitions.entries()) {
    cameras.push(await prisma.camera.upsert({ where: { name: item.name }, update: {}, create: {
      name: item.name, location: item.name, description: "DEMO-camera zonder echte RTSP-stream",
      direction: item.direction, latitude: item.latitude, longitude: item.longitude,
      displayOrder: index, active: true, status: "ONLINE", rtspHost: `demo-${index + 1}.invalid`, rtspPath: "/demo"
    }}));
  }
  const group = await prisma.plateGroup.upsert({ where: { name: "Aandacht" }, update: { hitEnabled: true, reasonRequired: true }, create: {
    name: "Aandacht", description: "DEMO-signaleringsgroep", color: "#dc2626", hitEnabled: true, pushNotifications: false, reasonRequired: true
  }});
  const normalized = normalizeLicensePlate("12-ABC-3");
  await prisma.plateGroupMember.upsert({
    where: { groupId_normalizedLicensePlate: { groupId: group.id, normalizedLicensePlate: normalized } }, update: {},
    create: { groupId: group.id, normalizedLicensePlate: normalized, displayLicensePlate: displayLicensePlate(normalized), reason: "DEMO: verdacht voertuig gemeld in de buurt" }
  });
  if (await prisma.passage.count({ where: { source: "DEMO" } }) === 0) {
    const colors: VehicleColor[] = ["BLACK", "BLUE", "SILVER"];
    const types: VehicleType[] = ["CAR", "VAN", "CAR"];
    for (const [index, camera] of cameras.entries()) {
      const timestamp = new Date(Date.now() - index * 45 * 60_000);
      const isHit = index === 0;
      const plate = isHit ? "12-ABC-3" : `DE-MO-${index + 1}`;
      const norm = normalizeLicensePlate(plate);
      const passage = await prisma.passage.create({ data: {
        originalLicensePlate: plate, normalizedLicensePlate: norm, displayLicensePlate: displayLicensePlate(plate),
        plateConfidence: 0.97, timestamp, cameraId: camera.id, location: camera.location,
        direction: camera.direction, vehicleColor: colors[index]!, vehicleType: types[index]!,
        vehicleConfidence: 0.93, isHit, source: "DEMO", expiresAt: calculatePassageExpiry(timestamp),
        vehicle: { create: { type: types[index]!, color: colors[index]!, confidence: 0.93, metadata: { demo: true } } },
        plateDetections: { create: { rawLicensePlate: plate, normalizedLicensePlate: norm, confidence: 0.97 } }
      }});
      if (isHit) await prisma.hit.create({ data: {
        passageId: passage.id, cameraId: camera.id, groupId: group.id, normalizedLicensePlate: norm,
        location: camera.location, timestamp, reason: "DEMO: verdacht voertuig gemeld in de buurt", notificationStatus: "PENDING",
        groups: { create: { groupId: group.id, reason: "DEMO: verdacht voertuig gemeld in de buurt" } }
      }});
    }
  }
  await prisma.systemSetting.upsert({ where: { key: "retention.normalDays" }, update: {}, create: { key: "retention.normalDays", value: 14, description: "Standaardretentie normale passages" } });
}

try {
  await seedSecurity();
  await seedDemo();
  console.log("Rollen, permissions en development/demo-data zijn bijgewerkt.");
} finally {
  await prisma.$disconnect();
}
