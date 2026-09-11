import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { buildServer } from "./server.js";
import { prisma } from "./lib/prisma.js";

const app = buildServer();
const suffix = randomBytes(8).toString("hex");
const password = `Test-${randomBytes(18).toString("base64url")}Aa1`;
const createdIds: string[] = [];
const createdCameraIds: string[] = [];
const createdPassageIds: string[] = [];
const createdGroupIds: string[] = [];
const createdPlates: string[] = [];
let simulatorCameraBefore: { id: string; lastVehicleRegistrationAt: Date | null } | undefined;

async function createUser(roleName: "Administrator" | "Viewer") {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({ data: {
    email: `smoke-${roleName.toLowerCase()}-${suffix}@example.invalid`,
    username: `smoke-${roleName.toLowerCase()}-${suffix}`,
    displayName: `Runtime smoketest ${roleName}`,
    passwordHash: await bcrypt.hash(password, 12),
    roles: { create: { roleId: role.id } }
  }});
  createdIds.push(user.id);
  return user;
}

async function login(identifier: string) {
  const response = await app.inject({ method: "POST", url: "/auth/login", headers: { origin: "http://localhost:3000" }, payload: { identifier, password } });
  if (response.statusCode !== 200) throw new Error(`Login mislukt met status ${response.statusCode}: ${response.body}`);
  const setCookie = response.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error("Login gaf geen sessiecookie terug.");
  return raw.split(";", 1)[0]!;
}

async function expectStatus(method: "GET" | "POST", url: string, cookie: string, expected: number) {
  const response = await app.inject({ method, url, headers: { cookie, origin: "http://localhost:3000" }, payload: method === "POST" ? {} : undefined });
  if (response.statusCode !== expected) throw new Error(`${method} ${url}: verwacht ${expected}, kreeg ${response.statusCode}: ${response.body}`);
}

try {
  const admin = await createUser("Administrator");
  const viewer = await createUser("Viewer");
  const adminCookie = await login(admin.username);
  const viewerCookie = await login(viewer.username);
  await expectStatus("GET", "/auth/me", adminCookie, 200);
  await expectStatus("GET", "/dashboard", adminCookie, 200);
  await expectStatus("GET", "/cameras", adminCookie, 200);
  await expectStatus("GET", "/passages", adminCookie, 200);
  await expectStatus("GET", "/users", adminCookie, 200);
  const simulator = await app.inject({ method: "GET", url: "/simulator", headers: { cookie: adminCookie } });
  if (simulator.statusCode !== 200 || !simulator.json().cameras[0]) throw new Error("Simulator heeft geen demo-camera.");
  const simulatorCameraId = simulator.json().cameras[0].id as string;
  simulatorCameraBefore = await prisma.camera.findUniqueOrThrow({ where: { id: simulatorCameraId }, select: { id: true, lastVehicleRegistrationAt: true } });

  const groupResponse = await app.inject({ method: "POST", url: "/plate-groups", headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: {
    name: `Runtime aandacht ${suffix}`, description: "Tijdelijke runtime-smoketest", color: "#dc2626", active: true, hitEnabled: true, reasonRequired: true
  } });
  if (groupResponse.statusCode !== 201) throw new Error(`Signaleringsgroep aanmaken mislukt: ${groupResponse.body}`);
  const groupId = groupResponse.json().group.id as string;
  createdGroupIds.push(groupId);
  const smokePlate = `SMK${suffix.slice(0, 8).toUpperCase()}`;
  const plateResponse = await app.inject({ method: "POST", url: "/plates", headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: {
    licensePlate: smokePlate, groupIds: [groupId], reason: "Tijdelijke smoketest", active: true
  } });
  if (plateResponse.statusCode !== 201) throw new Error(`Signaleringskenteken aanmaken mislukt: ${plateResponse.body}`);
  createdPlates.push(smokePlate);
  const hitPassage = await app.inject({ method: "POST", url: "/simulator/passages", headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: {
    cameraId: simulatorCameraId, licensePlate: smokePlate, vehicleColor: "BLACK", vehicleType: "VAN", direction: "OUTGOING"
  } });
  if (hitPassage.statusCode !== 201 || hitPassage.json().hit !== true || hitPassage.json().matchedGroups[0]?.id !== groupId) {
    throw new Error(`Automatische hitdetectie via simulator mislukt: ${hitPassage.body}`);
  }
  const hitPassageId = hitPassage.json().passage.id as string;
  createdPassageIds.push(hitPassageId);
  const hit = await prisma.hit.findUniqueOrThrow({ where: { passageId: hitPassageId }, select: { id: true } });
  const hitDetail = await app.inject({ method: "GET", url: `/hits/${hit.id}`, headers: { cookie: adminCookie } });
  if (hitDetail.statusCode !== 200 || hitDetail.json().hit.groups[0]?.id !== groupId) throw new Error(`Hitdetail klopt niet: ${hitDetail.body}`);

  const patchPlate = async (payload: Record<string, unknown>) => {
    const response = await app.inject({ method: "PATCH", url: `/plates/${smokePlate}`, headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload });
    if (response.statusCode !== 200) throw new Error(`Signaleringskenteken wijzigen mislukt: ${response.body}`);
  };
  const simulateWithoutHit = async (label: string) => {
    const response = await app.inject({ method: "POST", url: "/simulator/passages", headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: {
      cameraId: simulatorCameraId, licensePlate: smokePlate, vehicleColor: "GRAY", vehicleType: "CAR"
    } });
    if (response.statusCode !== 201 || response.json().hit !== false) throw new Error(`${label} maakte ten onrechte een hit: ${response.body}`);
    createdPassageIds.push(response.json().passage.id as string);
  };
  await patchPlate({ active: false });
  await simulateWithoutHit("Inactief kenteken");
  await patchPlate({ active: true, validUntil: new Date(Date.now() - 60_000).toISOString() });
  await simulateWithoutHit("Verlopen kenteken");
  await patchPlate({ validUntil: null });
  const disableGroup = await app.inject({ method: "PATCH", url: `/plate-groups/${groupId}`, headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: { active: false } });
  if (disableGroup.statusCode !== 200) throw new Error(`Signaleringsgroep deactiveren mislukt: ${disableGroup.body}`);
  await simulateWithoutHit("Inactieve groep");
  const enableGroup = await app.inject({ method: "PATCH", url: `/plate-groups/${groupId}`, headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: { active: true } });
  if (enableGroup.statusCode !== 200) throw new Error(`Signaleringsgroep activeren mislukt: ${enableGroup.body}`);
  const disableHitDetection = await app.inject({ method: "PATCH", url: `/plate-groups/${groupId}`, headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: { hitEnabled: false } });
  if (disableHitDetection.statusCode !== 200) throw new Error(`Hitdetectie uitschakelen mislukt: ${disableHitDetection.body}`);
  await simulateWithoutHit("Groep met hitdetectie uit");
  const enableHitDetection = await app.inject({ method: "PATCH", url: `/plate-groups/${groupId}`, headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: { hitEnabled: true } });
  if (enableHitDetection.statusCode !== 200) throw new Error(`Hitdetectie inschakelen mislukt: ${enableHitDetection.body}`);

  const search = await app.inject({ method: "GET", url: `/search/passages?plate=${smokePlate.slice(0, 5)}&color=BLACK&type=VAN&cameraId=${simulatorCameraId}&groupId=${groupId}&onlyHits=true&direction=OUTGOING`, headers: { cookie: adminCookie } });
  if (search.statusCode !== 200 || search.json().total !== 1 || search.json().passages[0]?.id !== hitPassageId) throw new Error(`Gecombineerd zoeken klopt niet: ${search.body}`);
  const dossier = await app.inject({ method: "GET", url: `/plates/${smokePlate}`, headers: { cookie: adminCookie } });
  if (dossier.statusCode !== 200 || dossier.json().total !== 5 || dossier.json().plate.groups[0]?.id !== groupId) throw new Error(`Kentekendossier klopt niet: ${dossier.body}`);
  await expectStatus("GET", "/hits", viewerCookie, 200);
  await expectStatus("GET", `/search/passages?plate=${smokePlate}`, viewerCookie, 200);
  const viewerPlateDelete = await app.inject({ method: "DELETE", url: `/plates/${smokePlate}`, headers: { cookie: viewerCookie, origin: "http://localhost:3000" } });
  if (viewerPlateDelete.statusCode !== 403) throw new Error(`Viewer kon kenteken verwijderen: ${viewerPlateDelete.body}`);
  const viewerGroupCreate = await app.inject({ method: "POST", url: "/plate-groups", headers: { cookie: viewerCookie, origin: "http://localhost:3000" }, payload: { name: `Verboden ${suffix}` } });
  if (viewerGroupCreate.statusCode !== 403) throw new Error(`Viewer kon groep aanmaken: ${viewerGroupCreate.body}`);

  const simulated = await app.inject({ method: "POST", url: "/simulator/passages", headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: { cameraId: simulatorCameraId, licensePlate: "SMOKE-TEST", vehicleColor: "BLUE", vehicleType: "CAR" } });
  if (simulated.statusCode !== 201 || simulated.json().passage.source !== "DEMO") throw new Error(`Simulatorgeneratie mislukt: ${simulated.body}`);
  createdPassageIds.push(simulated.json().passage.id as string);

  const createdCamera = await app.inject({ method: "POST", url: "/cameras", headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: {
    name: `Runtime testcamera ${suffix}`, location: "Smoketest", direction: "INCOMING", connectionMode: "FIELDS",
    rtspHost: "does-not-exist.invalid", rtspPort: 554, rtspPath: "/stream", username: "test", password: "niet-opgeslagen-na-test", active: false
  }});
  if (createdCamera.statusCode !== 201) throw new Error(`Camera aanmaken mislukt: ${createdCamera.body}`);
  const cameraId = createdCamera.json().camera.id as string;
  createdCameraIds.push(cameraId);
  const updatedCamera = await app.inject({ method: "PATCH", url: `/cameras/${cameraId}`, headers: { cookie: adminCookie, origin: "http://localhost:3000" }, payload: { active: true } });
  if (updatedCamera.statusCode !== 200 || !updatedCamera.json().camera.active) throw new Error(`Camera activeren mislukt: ${updatedCamera.body}`);
  const rtspTest = await app.inject({ method: "POST", url: `/cameras/${cameraId}/test`, headers: { cookie: adminCookie, origin: "http://localhost:3000" } });
  if (rtspTest.statusCode !== 200 || rtspTest.json().success !== false || !rtspTest.json().code) throw new Error(`RTSP-foutclassificatie mislukt: ${rtspTest.body}`);
  const deletedCamera = await app.inject({ method: "DELETE", url: `/cameras/${cameraId}`, headers: { cookie: adminCookie, origin: "http://localhost:3000" } });
  if (deletedCamera.statusCode !== 204) throw new Error(`Camera verwijderen mislukt: ${deletedCamera.body}`);
  // The archived camera reference is cleaned up below with the fixture records.
  await expectStatus("POST", "/cameras", viewerCookie, 403);
  await expectStatus("GET", "/cameras", viewerCookie, 200);
  await expectStatus("GET", "/passages", viewerCookie, 200);
  console.log("Runtime-smoketest geslaagd: login, dashboard, camera CRUD, RTSP-fouttest, groepen, kentekens, actieve/inactieve/verlopen hitregels, hitdetectie aan/uit, simulator-hit, hits, zoeken, dossier en Viewer-RBAC.");
} finally {
  await app.close();
  await prisma.hit.deleteMany({ where: { passageId: { in: createdPassageIds } } });
  await prisma.passage.deleteMany({ where: { id: { in: createdPassageIds } } });
  await prisma.plateGroupMember.deleteMany({ where: { normalizedLicensePlate: { in: createdPlates } } });
  await prisma.plateGroup.deleteMany({ where: { id: { in: createdGroupIds } } });
  await prisma.camera.deleteMany({ where: { id: { in: createdCameraIds } } });
  if (simulatorCameraBefore) await prisma.camera.update({ where: { id: simulatorCameraBefore.id }, data: { lastVehicleRegistrationAt: simulatorCameraBefore.lastVehicleRegistrationAt } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: createdIds } }, { objectId: { in: createdIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
}
