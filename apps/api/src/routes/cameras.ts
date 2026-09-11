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
import { encryptedDahuaConnection } from "../lib/device-connections.js";
import { prisma } from "../lib/prisma.js";
import { testRtsp } from "../lib/rtsp.js";

const rtspFields = z.object({
  connectionMode: z.enum(["URL", "FIELDS"]).default("FIELDS"), rtspUrl: z.string().max(2048).optional(),
  rtspHost: z.string().max(253).optional(), rtspPort: z.coerce.number().int().min(1).max(65535).optional(),
  rtspPath: z.string().max(1000).optional(), username: z.string().max(200).optional(), password: z.string().max(500).optional()
});
const connection = rtspFields.superRefine((value, ctx) => {
  if (value.connectionMode === "URL" && !value.rtspUrl) ctx.addIssue({ code: "custom", message: "RTSP URL is verplicht.", path: ["rtspUrl"] });
  if (value.connectionMode === "FIELDS" && !value.rtspHost) ctx.addIssue({ code: "custom", message: "IP-adres of hostnaam is verplicht.", path: ["rtspHost"] });
});
const dahuaTcp = z.object({
  host: z.string().trim().min(1).max(253), port: z.coerce.number().int().min(1).max(65535).default(37777),
  username: z.string().max(200).optional(), password: z.string().max(500).optional(), category: z.enum(["CAMERA", "NVR", "AUTO"]).default("AUTO")
});
const zone = z.object({ type: z.enum(["RECTANGLE", "POLYGON"]), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(20) });
const cameraBody = rtspFields.merge(z.object({
  name: z.string().trim().min(2).max(100), location: z.string().trim().min(2).max(150), description: z.string().trim().max(1000).optional(),
  direction: z.enum(["INCOMING", "OUTGOING", "BOTH"]), latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(), active: z.boolean().default(false),
  displayOrder: z.coerce.number().int().min(0).max(10_000).default(0), offlineTimeoutSeconds: z.coerce.number().int().min(30).max(86_400).default(120),
  zone: zone.optional(), anprProvider: z.enum(["NONE", "DAHUA_CGI"]).default("NONE"),
  anprHttpProtocol: z.enum(["http", "https"]).default("http"),
  anprHttpPort: z.coerce.number().int().min(1).max(65535).default(80),
  anprChannel: z.coerce.number().int().min(1).max(64).default(1)
  ,locationId: z.string().uuid().nullable().optional(), recorderId: z.string().uuid().nullable().optional(),
  primaryConnection: z.enum(["RTSP", "DAHUA_TCP_SDK"]).default("RTSP"), rtspEnabled: z.boolean().default(true), dahuaTcp: dahuaTcp.optional()
})).superRefine((value,ctx)=>{
  if(value.primaryConnection==="DAHUA_TCP_SDK"&&!value.dahuaTcp)ctx.addIssue({code:"custom",message:"Vul de Dahua TCP-gegevens in.",path:["dahuaTcp"]});
  if(value.primaryConnection==="RTSP"&&!value.rtspEnabled)ctx.addIssue({code:"custom",message:"RTSP moet actief zijn wanneer RTSP de primaire verbinding is.",path:["rtspEnabled"]});
  if(value.anprProvider!=="NONE"&&!value.rtspEnabled)ctx.addIssue({code:"custom",message:"De bestaande Dahua CGI-eventprovider vereist ook een geconfigureerde apparaathost via RTSP.",path:["anprProvider"]});
  if(value.rtspEnabled&&value.connectionMode==="URL"&&!value.rtspUrl)ctx.addIssue({code:"custom",message:"RTSP URL is verplicht.",path:["rtspUrl"]});
  if(value.rtspEnabled&&value.connectionMode==="FIELDS"&&!value.rtspHost&&!value.dahuaTcp?.host)ctx.addIssue({code:"custom",message:"IP-adres of hostnaam is verplicht voor RTSP.",path:["rtspHost"]});
});
const updateBody = z.object({
  name: z.string().trim().min(2).max(100).optional(), location: z.string().trim().min(2).max(150).optional(),
  description: z.string().trim().max(1000).optional(), direction: z.enum(["INCOMING", "OUTGOING", "BOTH"]).optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(), longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  active: z.boolean().optional(), displayOrder: z.coerce.number().int().min(0).max(10_000).optional(),
  offlineTimeoutSeconds: z.coerce.number().int().min(30).max(86_400).optional(), zone: zone.optional(),
  connectionMode: z.enum(["URL", "FIELDS"]).optional(), rtspUrl: z.string().max(2048).optional(),
  rtspHost: z.string().max(253).optional(), rtspPort: z.coerce.number().int().min(1).max(65535).optional(),
  rtspPath: z.string().max(1000).optional(), username: z.string().max(200).optional(), password: z.string().max(500).optional()
  , anprProvider: z.enum(["NONE", "DAHUA_CGI"]).optional(), anprHttpProtocol: z.enum(["http", "https"]).optional(),
  anprHttpPort: z.coerce.number().int().min(1).max(65535).optional(), anprChannel: z.coerce.number().int().min(1).max(64).optional()
  , locationId: z.string().uuid().nullable().optional(), recorderId: z.string().uuid().nullable().optional()
  , primaryConnection: z.enum(["RTSP", "DAHUA_TCP_SDK"]).optional(), rtspEnabled: z.boolean().optional(), dahuaTcp: dahuaTcp.nullable().optional()
});

async function validateLocationLink(locationId?: string|null, recorderId?: string|null) {
  if (!locationId && recorderId) throw Object.assign(new Error("Kies ook de locatie van deze recorder."), { statusCode: 400 });
  if (!locationId) return;
  const location = await prisma.vpnLocation.findUnique({ where: { id: locationId }, select: { id: true } });
  if (!location) throw Object.assign(new Error("De gekozen locatie bestaat niet."), { statusCode: 400 });
  if (recorderId) {
    const recorder = await prisma.recorder.findFirst({ where: { id: recorderId, locationId }, select: { id: true } });
    if (!recorder) throw Object.assign(new Error("De gekozen recorder hoort niet bij deze locatie."), { statusCode: 400 });
  }
}

function capabilities(provider: "NONE" | "DAHUA_CGI") {
  return { rtsp: true, snapshot: true, cameraAnpr: provider !== "NONE", eventStream: provider !== "NONE", plateCrop: provider !== "NONE", vehicleMetadata: provider !== "NONE" };
}

function temporaryRtspUrl(body: z.infer<typeof connection>) {
  const parsed = parseConnection(body);
  return buildRtspUrl({
    rtspProtocol: parsed.rtspProtocol,
    rtspHost: parsed.rtspHost,
    rtspPort: parsed.rtspPort,
    rtspPath: parsed.rtspPath,
    rtspUsernameEncrypted: encryptSecret(parsed.username),
    rtspPasswordEncrypted: encryptSecret(parsed.password)
  } as any);
}

export async function cameraRoutes(app: FastifyInstance) {
  app.get("/cameras", { preHandler: requirePermission(PERMISSIONS.CAMERAS_VIEW) }, async (_request, reply) => {
    const cameras = await prisma.camera.findMany({ include: { zones: true, deviceConnections: true, _count: { select: { passages: { where: { timestamp: { gte: new Date(Date.now() - 86_400_000) } } } } } }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
    return reply.header("Cache-Control", "private, no-store").send({ cameras: cameras.map(publicCamera) });
  });

  app.get("/cameras/:id", { preHandler: requirePermission(PERMISSIONS.CAMERAS_VIEW) }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return { camera: publicCamera(await prisma.camera.findUniqueOrThrow({ where: { id }, include: { zones: true, deviceConnections: true } })) };
  });

  app.get("/cameras/name-availability", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request) => {
    const { name } = z.object({ name: z.string().trim().min(2).max(100) }).parse(request.query);
    const camera = await prisma.camera.findUnique({ where: { name }, select: { id: true } });
    return { available: camera === null };
  });

  app.post("/cameras", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request, reply) => {
    const body = cameraBody.parse(request.body);
    await validateLocationLink(body.locationId, body.recorderId);
    const connectionData = body.rtspEnabled ? encryptedConnection({...body,rtspHost:body.rtspHost??body.dahuaTcp?.host,username:body.username??body.dahuaTcp?.username,password:body.password??body.dahuaTcp?.password}) : { connectionMode:"FIELDS" as const,rtspProtocol:"rtsp",rtspHost:null,rtspPort:554,rtspPath:null,rtspUsernameEncrypted:null,rtspPasswordEncrypted:null };
    const camera = await prisma.camera.create({ data: {
      name: body.name, location: body.location, description: body.description, direction: body.direction,
      latitude: body.latitude, longitude: body.longitude, active: body.active,
      status: body.active ? "OFFLINE" : "DISABLED", displayOrder: body.displayOrder,
      offlineTimeoutSeconds: body.offlineTimeoutSeconds, ...connectionData,
      anprProvider: body.anprProvider, anprHttpProtocol: body.anprHttpProtocol, anprHttpPort: body.anprHttpPort,
      anprChannel: body.anprChannel, anprConnectionStatus: body.active && body.anprProvider !== "NONE" ? "CONNECTING" : "DISABLED",
      capabilities: capabilities(body.anprProvider),
      locationId: body.locationId, recorderId: body.recorderId,
      deviceConnections: body.dahuaTcp ? { create: encryptedDahuaConnection(body.dahuaTcp) } : undefined,
      zones: body.zone ? { create: { type: body.zone.type, points: body.zone.points } } : undefined
    }, include: { zones: true, deviceConnections: true } });
    await audit(request, "CAMERA_CREATED", { objectType: "Camera", objectId: camera.id, newValue: publicCamera(camera) });
    return reply.code(201).send({ camera: publicCamera(camera) });
  });

  app.patch("/cameras/:id", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = updateBody.parse(request.body);
    const current = await prisma.camera.findUniqueOrThrow({ where: { id }, include: { zones: true, deviceConnections: true } });
    await validateLocationLink(body.locationId === undefined ? current.locationId : body.locationId, body.recorderId === undefined ? current.recorderId : body.recorderId);
    let connectionData = {};
    if (body.rtspEnabled === false) {
      connectionData = { rtspHost:null,rtspPath:null,rtspUsernameEncrypted:null,rtspPasswordEncrypted:null };
    } else if (body.connectionMode || body.rtspUrl || body.rtspHost) {
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
      if (body.dahuaTcp === null) await tx.deviceConnection.deleteMany({where:{cameraId:id,type:"DAHUA_TCP_SDK"}});
      else if (body.dahuaTcp) {
        const existing=current.deviceConnections?.find((item:any)=>item.type==="DAHUA_TCP_SDK");
        const data=encryptedDahuaConnection(body.dahuaTcp,existing);
        await tx.deviceConnection.upsert({where:{cameraId_type:{cameraId:id,type:"DAHUA_TCP_SDK"}},create:{cameraId:id,...data},update:data});
      }
      return tx.camera.update({ where: { id }, data: {
        name: body.name, location: body.location, description: body.description, direction: body.direction,
        latitude: body.latitude, longitude: body.longitude, active: body.active,
        status: body.active === false ? "DISABLED" : body.active === true && current.status === "DISABLED" ? "OFFLINE" : undefined,
        displayOrder: body.displayOrder, offlineTimeoutSeconds: body.offlineTimeoutSeconds,
        anprProvider: body.anprProvider, anprHttpProtocol: body.anprHttpProtocol, anprHttpPort: body.anprHttpPort, anprChannel: body.anprChannel,
        anprConnectionStatus: body.active === false || body.anprProvider === "NONE" ? "DISABLED"
          : body.anprProvider === "DAHUA_CGI" || body.active === true ? "CONNECTING" : undefined,
        capabilities: body.anprProvider ? capabilities(body.anprProvider) : undefined,
        locationId: body.locationId, recorderId: body.locationId === null ? null : body.recorderId,
        ...connectionData,
        ...(body.rtspEnabled===false?{rtspHost:null,rtspPath:null,rtspUsernameEncrypted:null,rtspPasswordEncrypted:null}:{}),
      }, include: { zones: true, deviceConnections: true } });
    });
    await audit(request, "CAMERA_UPDATED", { objectType: "Camera", objectId: id, oldValue: publicCamera(current), newValue: publicCamera(camera) });
    return { camera: publicCamera(camera) };
  });

  app.delete("/cameras/:id", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const camera = await prisma.camera.findUnique({ where: { id }, include: { _count: { select: { passages: true, hits: true } } } });
    if (!camera) return reply.code(204).send();
    if (camera._count.passages > 0 || camera._count.hits > 0) {
      return reply.code(409).send({ error: "CAMERA_HAS_HISTORY", message: "Deze camera heeft historische passages of hits en kan voor behoud van historie alleen worden uitgeschakeld." });
    }
    const deleted = await prisma.camera.deleteMany({ where: { id } });
    if (deleted.count === 0) return reply.code(204).send();
    await audit(request, "CAMERA_DELETED", { objectType: "Camera", objectId: id, oldValue: publicCamera(camera) });
    return reply.code(204).send();
  });

  app.post("/cameras/test-connection", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request) => {
    const body = connection.parse(request.body);
    return testRtsp(temporaryRtspUrl(body), false);
  });

  app.post("/cameras/test-snapshot", { preHandler: requirePermission(PERMISSIONS.CAMERAS_MANAGE) }, async (request) => {
    const body = connection.parse(request.body);
    return testRtsp(temporaryRtspUrl(body), true);
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
