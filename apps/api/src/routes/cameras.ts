import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { PERMISSIONS } from "@anpr/shared";
import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { buildRtspUrl, encryptedConnection, parseConnection, publicCamera } from "../lib/camera.js";
import { encryptSecret } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { testRtsp } from "../lib/rtsp.js";

const connection = z.object({
  connectionMode: z.enum(["URL", "FIELDS"]), rtspUrl: z.string().max(2048).optional(),
  rtspHost: z.string().max(253).optional(), rtspPort: z.coerce.number().int().min(1).max(65535).optional(),
  rtspPath: z.string().max(1000).optional(), username: z.string().max(200).optional(), password: z.string().max(500).optional()
}).superRefine((value, ctx) => {
  if (value.connectionMode === "URL" && !value.rtspUrl) ctx.addIssue({ code: "custom", message: "RTSP URL is verplicht.", path: ["rtspUrl"] });
  if (value.connectionMode === "FIELDS" && !value.rtspHost) ctx.addIssue({ code: "custom", message: "IP-adres of hostnaam is verplicht.", path: ["rtspHost"] });
});
const zone = z.object({ type: z.enum(["RECTANGLE", "POLYGON"]), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(20) });
const cameraBody = connection.and(z.object({
  name: z.string().trim().min(2).max(100), location: z.string().trim().min(2).max(150), description: z.string().trim().max(1000).optional(),
  direction: z.enum(["INCOMING", "OUTGOING", "BOTH"]), latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(), active: z.boolean().default(false),
  displayOrder: z.coerce.number().int().min(0).max(10_000).default(0), offlineTimeoutSeconds: z.coerce.number().int().min(30).max(86_400).default(120),
  zone: zone.optional()
}));
const updateBody = z.object({
  name: z.string().trim().min(2).max(100).optional(), location: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(1000).optional(), direction: z.enum(["INCOMING", "OUTGOING", "BOTH"]).optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(), longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  active: z.boolean().optional(), displayOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  offlineTimeoutSeconds: z.coerce.number().int().min(30).max(86_400).optional(), zone: zone.optional(),
  connectionMode: z.enum(["URL", "FIELDS"]).optional(), rtspUrl: z.string().max(2048).optional(),
  rtspHost: z.string().max(253).optional(), rtspPort: z.coerce.number().int().min(1).max(65535).optional(),
  rtspPath: z.string().max(1000).optional(), username: z.string().max(200).optional(), password: z.string().max(500).optional()
});

export async function cameraRoutes(app: FastifyInstance) {
  app.get("/cameras", { preHandler: requirePermission(PERMISSIONS.CAMERAS_VIEW) }, async () => {
    const cameras = await prisma.camera.findMany({ include: { zones: true, _count: { select: { passages: { where: { timestamp: { gte: new Date(Date.now() - 86_400_000) } } } } } }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
    return { cameras: cameras.map(publicCamera) };
  });

  app.get("/cameras/:id", { preHandler: requirePermission(PERMISSIONS.CAMERAS_VIEW) }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { camera: publicCamera(await prisma.camera.findUniqueOrThrow({ where: { id }, include: { zones: true } })) };
  });

  app.post("/cameras", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request, reply) => {
    const body = cameraBody.parse(request.body);
    const connectionData = encryptedConnection(body);
    const camera = await prisma.camera.create({ data: {
      name: body.name, location: body.location, description: body.description, direction: body.direction,
      latitude: body.latitude, longitude: body.longitude, active: body.active,
      status: body.active ? "OFFLINE" : "DISABLED", displayOrder: body.displayOrder,
      offlineTimeoutSeconds: body.offlineTimeoutSeconds, ...connectionData,
      zones: body.zone ? { create: { type: body.zone.type, points: body.zone.points } } : undefined
    }, include: { zones: true } });
    await audit(request, "CAMERA_CREATED", { objectType: "Camera", objectId: camera.id, newValue: publicCamera(camera) });
    return reply.code(201).send({ camera: publicCamera(camera) });
  });

  app.patch("/cameras/:id", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateBody.parse(request.body);
    const current = await prisma.camera.findUniqueOrThrow({ where: { id }, include: { zones: true } });
    let connectionData = {};
    if (body.connectionMode || body.rtspUrl || body.rtspHost) {
      connectionData = encryptedConnection({
        connectionMode: body.connectionMode ?? current.connectionMode,
        rtspUrl: body.rtspUrl, rtspHost: body.rtspHost ?? current.rtspHost ?? undefined,
        rtspPort: body.rtspPort ?? current.rtspPort, rtspPath: body.rtspPath ?? current.rtspPath ?? undefined,
        username: body.username, password: body.password
      }, current);
    } else {
      connectionData = {
        rtspPort: body.rtspPort, rtspPath: body.rtspPath,
        rtspUsernameEncrypted: body.username ? encryptSecret(body.username) : undefined,
        rtspPasswordEncrypted: body.password ? encryptSecret(body.password) : undefined
      };
    }
    const camera = await prisma.$transaction(async (tx) => {
      if (body.zone) {
        await tx.cameraZone.deleteMany({ where: { cameraId: id } });
        await tx.cameraZone.create({ data: { cameraId: id, type: body.zone.type, points: body.zone.points } });
      }
      return tx.camera.update({ where: { id }, data: {
        name: body.name, location: body.location, description: body.description, direction: body.direction,
        latitude: body.latitude, longitude: body.longitude, active: body.active,
        status: body.active === false ? "DISABLED" : body.active === true && current.status === "DISABLED" ? "OFFLINE" : undefined,
        displayOrder: body.displayOrder, offlineTimeoutSeconds: body.offlineTimeoutSeconds, ...connectionData
      }, include: { zones: true } });
    });
    await audit(request, "CAMERA_UPDATED", { objectType: "Camera", objectId: id, oldValue: publicCamera(current), newValue: publicCamera(camera) });
    return { camera: publicCamera(camera) };
  });

  app.delete("/cameras/:id", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const camera = await prisma.camera.findUniqueOrThrow({ where: { id }, include: { _count: { select: { passages: true } } } });
    if (camera._count.passages > 0) return reply.code(409).send({ error: "CAMERA_HAS_PASSAGES", message: "Deze camera heeft passages en kan voor behoud van historie alleen worden uitgeschakeld." });
    await prisma.camera.delete({ where: { id } });
    await audit(request, "CAMERA_DELETED", { objectType: "Camera", objectId: id, oldValue: publicCamera(camera) });
    return reply.code(204).send();
  });

  app.post("/cameras/test-connection", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request) => {
    const body = connection.parse(request.body);
    const parsed = parseConnection(body);
    const temporary = {
      rtspProtocol: parsed.rtspProtocol, rtspHost: parsed.rtspHost, rtspPort: parsed.rtspPort, rtspPath: parsed.rtspPath,
      rtspUsernameEncrypted: encryptSecret(parsed.username), rtspPasswordEncrypted: encryptSecret(parsed.password)
    };
    return testRtsp(buildRtspUrl(temporary as any));
  });

  app.post("/cameras/:id/test", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const camera = await prisma.camera.findUniqueOrThrow({ where: { id } });
    const result = await testRtsp(buildRtspUrl(camera));
    await prisma.camera.update({ where: { id }, data: result.success ? {
      status: camera.active ? "ONLINE" : "DISABLED", lastConnectionAt: new Date(), lastConnectionSuccessAt: new Date(),
      lastConnectionError: null, lastConnectionErrorCode: null, lastSnapshotObjectId: result.snapshotObjectId ?? camera.lastSnapshotObjectId
    } : { status: camera.active ? "CONNECTION_PROBLEM" : "DISABLED", lastConnectionAt: new Date(), lastConnectionError: result.message, lastConnectionErrorCode: result.code } });
    await audit(request, "CAMERA_CONNECTION_TESTED", { objectType: "Camera", objectId: id, metadata: { success: result.success, errorCode: result.success ? undefined : result.code } });
    return result;
  });

  app.get("/cameras/:id/snapshot", { preHandler: requirePermission(PERMISSIONS.CAMERAS_VIEW) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const camera = await prisma.camera.findUniqueOrThrow({ where: { id }, select: { lastSnapshotObjectId: true } });
    if (!camera.lastSnapshotObjectId) return reply.code(404).send({ error: "NO_SNAPSHOT", message: "Er is nog geen snapshot beschikbaar." });
    const root = resolve(config.STORAGE_PATH);
    const file = resolve(root, camera.lastSnapshotObjectId);
    if (!file.startsWith(`${root}${sep}`)) return reply.code(400).send({ error: "INVALID_OBJECT", message: "Ongeldig opslagobject." });
    await stat(file);
    return reply.type("image/jpeg").header("Cache-Control", "private, max-age=30").send(createReadStream(file));
  });

  app.get("/cameras/test-snapshot/:file", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request, reply) => {
    const { file: filename } = z.object({ file: z.string().regex(/^[0-9a-f-]{36}\.jpg$/i) }).parse(request.params);
    const file = resolve(config.STORAGE_PATH, "snapshots", filename);
    await stat(file);
    return reply.type("image/jpeg").header("Cache-Control", "no-store").send(createReadStream(file));
  });
}
