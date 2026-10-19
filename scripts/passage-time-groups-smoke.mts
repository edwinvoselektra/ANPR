// Only isolated synthetic fixtures. Never run against a production database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { formatLocalDate } from "@anpr/shared";
import { PassageService } from "@anpr/shared/passage-service";
import { buildServer } from "../apps/api/src/server.js";
import { parseItsapiTollgate } from "../apps/api/src/lib/itsapi-parser.js";
import { hashToken } from "../apps/api/src/lib/crypto.js";
import { prisma } from "../apps/api/src/lib/prisma.js";

assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/anpr_native_test", "Only isolated anpr_native_test database permitted");
const db = new PrismaClient({ log: [] }), app = buildServer();
const marker = `time-groups-${randomUUID()}`, cameraId = randomUUID(), locationId = randomUUID(), userId = randomUUID();
const groupIds = [randomUUID(), randomUUID()];
const plate = `T${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
let createdRoleId: string | undefined;
try {
  let role = await db.role.findUnique({ where: { name: "ADMIN" } });
  if (!role) {
    role = await db.role.create({ data: { name: "ADMIN" } });
    createdRoleId = role.id;
  }
  await db.user.create({ data: { id: userId, username: marker, email: `${marker}@example.invalid`, displayName: marker, passwordHash: "unused-fixture", roles: { create: { roleId: role.id } } } });
  const token = randomUUID();
  await db.userSession.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600_000) } });
  const headers = { cookie: `anpr_session=${token}`, origin: process.env.WEB_ORIGIN! };
  await db.vpnLocation.create({ data: { id: locationId, name: marker, routerType: "MANUAL_OTHER", vpnType: "WIREGUARD", vpnMode: "LOCATION_TO_SERVER", tunnelAddress: "10.254.254.253", remoteLanCidr: "192.0.2.0/24", timezone: "Europe/Amsterdam" } });
  await db.camera.create({ data: { id: cameraId, name: marker, location: "Synthetic timezone test", locationId, direction: "BOTH", active: true, rtspEnabled: false, anprProvider: "DAHUA_ITSAPI" } });
  for (const id of groupIds) await db.plateGroup.create({ data: { id, name: `${marker}-${id}`, color: "#123456", active: true, hitEnabled: true } });
  const service = new PassageService({ prisma: db, storage: { storePassageImage: async () => { throw new Error("No fixture images"); }, delete: async () => {} }, dedupeWindowMs: 3000, logger: { info: () => {}, warn: () => {}, error: () => {} } });
  const store = async (local: string, expectedUtc: string) => {
    const { event } = parseItsapiTollgate({ Picture: { Plate: { PlateNumber: plate }, SnapInfo: { DeviceID: marker, AccurateTime: local.replace("2026", "2000") } } }, { id: cameraId, timezone: "Europe/Amsterdam", directionMapping: "TOWARD_CAMERA_IS_INCOMING" });
    assert.notEqual(event.occurredAt.toISOString(), expectedUtc);
    // Explicit synthetic server ingress, independently of an incorrect camera clock.
    await service.store({...event, receivedAt:new Date(expectedUtc)});
    const passage = await db.passage.findFirstOrThrow({ where: { cameraId, sourceEventId: event.sourceEventId } });
    assert.equal(passage.timestamp.toISOString(), expectedUtc);
    assert.equal(formatLocalDate(passage.timestamp, passage.timezone), `${local.slice(8, 10)}-${local.slice(5, 7)}-${local.slice(0, 4)} 07:30:00`);
    return passage;
  };
  const original = await store("2026-01-14 07:30:00", "2026-01-14T06:30:00.000Z");
  assert.equal(original.isHit, false);
  const path = `/plates/${plate}/groups`;
  for (const id of groupIds) {
    const results = await Promise.all([1, 2].map(() => app.inject({ method: "PUT", url: `${path}/${id}`, headers, payload: { reason: "Synthetic fixture reason" } })));
    assert(results.every(result => result.statusCode === 204));
  }
  assert.equal(await db.plateGroupMember.count({ where: { normalizedLicensePlate: plate } }), 2);
  assert.equal(await db.auditLog.count({ where: { actorId: userId, action: "PLATE_ADDED_TO_GROUP" } }), 2);
  const passage = await store("2026-07-14 07:30:00", "2026-07-14T05:30:00.000Z");
  const hit = await db.hit.findFirstOrThrow({ where: { passageId: passage.id }, include: { groups: true } });
  assert.equal(hit.groups.length, 2);
  assert.equal(hit.timestamp.getTime(), passage.timestamp.getTime());
  for (const url of [`/passages/${passage.id}`, "/passages", "/dashboard", "/hits", `/hits/${hit.id}`, `/plates/${plate}`]) {
    const response = await app.inject({ url, headers });
    assert.equal(response.statusCode, 200, url);
    if (url === `/passages/${passage.id}`) assert.equal(response.json().passage.timeZone, "Europe/Amsterdam");
    if (url === `/plates/${plate}`) {
      assert.equal(response.json().firstSeenTimeZone, "Europe/Amsterdam");
      assert.equal(response.json().lastSeenTimeZone, "Europe/Amsterdam");
    }
  }
  const search = await app.inject({ url: `/search/passages?cameraId=${cameraId}&dateFrom=2026-07-14&dateTo=2026-07-14&timeFrom=07:30&timeTo=07:31`, headers });
  assert.equal(search.statusCode, 200); assert.equal(search.json().total, 1);
  for (const id of groupIds) assert.equal((await app.inject({ method: "DELETE", url: `${path}/${id}`, headers })).statusCode, 204);
  assert.equal(await db.plateGroupMember.count({ where: { normalizedLicensePlate: plate } }), 0);
  const afterRemoval = await store("2026-07-15 07:30:00", "2026-07-15T05:30:00.000Z");
  assert.equal(afterRemoval.isHit, false);
  assert.equal(await db.hit.count({ where: { cameraId } }), 1);
  assert.deepEqual(await db.passage.findUniqueOrThrow({ where: { id: original.id } }), original);
  assert.equal(await db.auditLog.count({ where: { actorId: userId, action: "PLATE_REMOVED_FROM_GROUP" } }), 2);
  console.log("PASS: Amsterdam winter/summer server receipt times, UTC persistence, API views/search, concurrent group additions, two groups → one new hit, removal including last group, audit and original passage preservation. Synthetic fixtures only; no hardware claim.");
} finally {
  await app.close();
  await db.passage.deleteMany({ where: { cameraId } });
  await db.camera.deleteMany({ where: { id: cameraId } });
  await db.vpnLocation.deleteMany({ where: { id: locationId } });
  await db.plateGroup.deleteMany({ where: { id: { in: groupIds } } });
  await db.auditLog.deleteMany({ where: { actorId: userId } });
  await db.user.deleteMany({ where: { id: userId } });
  if (createdRoleId) await db.role.delete({ where: { id: createdRoleId } });
  await db.$disconnect(); await prisma.$disconnect();
}
