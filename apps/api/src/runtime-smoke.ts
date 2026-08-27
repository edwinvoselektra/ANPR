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
  await expectStatus("GET", "/users", adminCookie, 200);
  const simulator = await app.inject({ method: "GET", url: "/simulator", headers: { cookie: adminCookie } });
  if (simulator.statusCode !== 200 || !simulator.json().cameras[0]) throw new Error("Simulator heeft geen demo-camera.");
  const simulatorCameraId = simulator.json().cameras[0].id as string;
  simulatorCameraBefore = await prisma.camera.findUniqueOrThrow({ where: { id: simulatorCameraId }, select: { id: true, lastVehicleRegistrationAt: true } });
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
  createdCameraIds.splice(createdCameraIds.indexOf(cameraId), 1);
  await expectStatus("POST", "/cameras", viewerCookie, 403);
  await expectStatus("GET", "/cameras", viewerCookie, 200);
  console.log("Runtime-smoketest geslaagd: login, sessies, dashboard, camera CRUD, RTSP-fouttest, simulator en Viewer-RBAC.");
} finally {
  await app.close();
  await prisma.hit.deleteMany({ where: { passageId: { in: createdPassageIds } } });
  await prisma.passage.deleteMany({ where: { id: { in: createdPassageIds } } });
  await prisma.camera.deleteMany({ where: { id: { in: createdCameraIds } } });
  if (simulatorCameraBefore) await prisma.camera.update({ where: { id: simulatorCameraBefore.id }, data: { lastVehicleRegistrationAt: simulatorCameraBefore.lastVehicleRegistrationAt } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: createdIds } }, { objectId: { in: createdIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
}
