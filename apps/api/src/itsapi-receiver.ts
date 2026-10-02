import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import { resolveTimeZone } from "@anpr/shared";
import { PassageService } from "@anpr/shared/passage-service";
import { LocalStorageProvider, type StorageProvider } from "@anpr/shared/passage-storage";
import { ItsapiPayloadError, parseItsapiHeartbeat, parseItsapiTollgate } from "./lib/itsapi-parser.js";
import rateLimit from "@fastify/rate-limit";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { decryptSecret } from "./lib/crypto.js";
import { challenge, parseDigest, verifyDigest } from "./lib/itsapi-digest.js";
import { ITSAPI_PROTOCOL_GAP, ITSAPI_HEARTBEAT_PATH, ITSAPI_ANPR_PATH, payloadShape } from "./lib/itsapi-protocol.js";

// Shared, bounded receiver in the API process, with a separate upload-only listener.
export function buildItsapiReceiver(db: PrismaClient = prisma, storage: StorageProvider = new LocalStorageProvider(config.STORAGE_PATH, 8_000_000)) {
  const app = Fastify({ logger: true, disableRequestLogging: true, bodyLimit: 16_000_000, requestTimeout: 15_000, connectionTimeout: 20_000, keepAliveTimeout: 65_000, trustProxy: false });
  void app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
  const passageService = new PassageService({ prisma: db, storage, dedupeWindowMs: 0,
    // The receiver owns logging; do not forward arbitrary provider messages.
    logger: { info() {}, warn() {}, error() {} },
  });
  const authenticated = new WeakMap<object, { cameraId: string; version: number }>();
  let concurrent = 0;
  const slots = new WeakSet<object>();
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" && request.method === "GET") return;
    if (concurrent >= 4) return reply.code(503).header("Retry-After","5").send({ error: "RECEIVER_BUSY" });
    concurrent++; slots.add(request);
    if (!request.headers.authorization) return reply.code(401).header("WWW-Authenticate",challenge(config.CAMERA_CREDENTIALS_KEY)).send();
    const parsed = parseDigest(request.headers.authorization);
    const registration = parsed?.username ? await db.itsapiRegistration.findUnique({ where: { username: parsed.username }, include: { camera: true } }) : null;
    const camera = registration?.camera;
    const allowed = camera && !camera.archivedAt && camera.anprProvider === "DAHUA_ITSAPI" && (camera.active || (camera.isDraft && camera.draftExpiresAt && camera.draftExpiresAt > new Date()));
    const proof = allowed && registration ? verifyDigest({ header:request.headers.authorization, method:request.method, uri:request.raw.url!, username:registration.username, password:decryptSecret(registration.passwordEncrypted)!, key:config.CAMERA_CREDENTIALS_KEY }) : null;
    if (!proof || !camera) {
      if (allowed && registration) await db.itsapiRegistration.updateMany({where:{cameraId:registration.cameraId,camera:{archivedAt:null,configVersion:camera!.configVersion}},data:{lastRequestAt:new Date(),lastErrorCode:"UPLOAD_AUTH_FAILED"}});
      return reply.code(401).header("WWW-Authenticate",challenge(config.CAMERA_CREDENTIALS_KEY)).send();
    }
    // Atomic replay check across concurrent requests / API processes.
    const advanced = await db.itsapiDigestReplay.updateMany({where:{key:proof.key,count:{lt:proof.count}},data:{count:proof.count}});
    if (!advanced.count) {
      try { await db.itsapiDigestReplay.create({data:proof}); }
      catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return reply.code(401).header("WWW-Authenticate",challenge(config.CAMERA_CREDENTIALS_KEY)).send(); throw error; }
    }
    authenticated.set(request,{cameraId:camera.id,version:camera.configVersion});
  });
  app.addHook("onResponse", async (request, reply) => {
    if (slots.delete(request)) concurrent--;
    const path = request.url.split("?", 1)[0];
    if (path !== ITSAPI_ANPR_PATH && path !== ITSAPI_HEARTBEAT_PATH) return;
    const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    const length = request.headers["content-length"];
    // Never pass request, headers, errors, scalar payload values or raw URLs to the logger.
    app.log.info({
      event: "itsapi_response", method: request.method, path, statusCode: reply.statusCode,
      contentType: mediaType === "application/json" ? mediaType : mediaType ? "other" : "none",
      contentLength: length && /^[0-9]{1,10}$/.test(length) ? Number(length) : null,
      payloadStructure: request.body === undefined ? "not_parsed" : payloadShape(request.body),
    }, "ITSAPI receiver response");
  });
  app.addHook("onRequestAbort", async request => { if (slots.delete(request)) concurrent--; });
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const status = error.statusCode === 413 ? 413 : error.statusCode === 400 ? 400 : error.statusCode === 415 ? 415 : error.statusCode === 429 ? 429 : 503;
    return reply.code(status).send({ error:status === 413 ? "UPLOAD_TOO_LARGE" : status === 400 ? "INVALID_JSON" : status === 415 ? "CONTENT_TYPE_UNSUPPORTED" : status === 429 ? "RATE_LIMITED" : "RECEIVER_TEMPORARILY_UNAVAILABLE" });
  });
  app.get("/health", async () => {
    await db.$queryRaw`SELECT 1`;
    return {service:"itsapi-receiver",listening:true,protocolVerified:false,cameraConnectionProven:false};
  });
  async function diagnose(request: FastifyRequest, reply: FastifyReply, errorCode = "PROTOCOL_NOT_VERIFIED", missing: string[] = [], status = 422) {
    const identity = authenticated.get(request);
    if (!identity) return reply.code(401).send();
    const body = request.body;
    const fingerprint = createHash("sha256").update(`${request.method}:${request.url}:${JSON.stringify(body)}`).digest("hex");
    const now = new Date();
    const observedPath = request.url.split("?",1)[0]!;
    const path = observedPath === ITSAPI_HEARTBEAT_PATH || observedPath === ITSAPI_ANPR_PATH ? observedPath : "[afgeschermd]";
    const accepted = await db.$transaction(async tx => {
      const locked = await tx.camera.updateMany({where:{id:identity.cameraId,archivedAt:null,configVersion:identity.version,anprProvider:"DAHUA_ITSAPI",OR:[{active:true},{isDraft:true,draftExpiresAt:{gt:now}}]},data:{configVersion:identity.version}});
      if (!locked.count) return false;
      const registration = await tx.itsapiRegistration.findUnique({where:{cameraId:identity.cameraId}});
      if (!registration) return false;
      await tx.itsapiRegistration.update({where:{cameraId:identity.cameraId},data:{lastRequestAt:now,lastAuthenticatedAt:now,evidenceVersion:identity.version,...(registration.evidenceVersion !== identity.version ? {lastIdentityAt:null,lastHeartbeatAt:null,lastEventAt:null} : {}),lastErrorCode:errorCode}});
      const kind = path === ITSAPI_HEARTBEAT_PATH ? "HEARTBEAT_UNVERIFIED" : path === ITSAPI_ANPR_PATH ? "ANPR_UNVERIFIED" : "UNKNOWN";
      const evidence = { errorCode, missing, method:request.method,path,contentType:request.headers["content-type"]?.split(";",1)[0] === "application/json" ? "application/json" : "other",shape:registration.debugUntil && registration.debugUntil > now ? payloadShape(body) : "Tijdelijke structuurdiagnose staat uit; inhoud niet bewaard.",deviceIdentityVerified:false };
      await tx.itsapiInbox.upsert({where:{cameraId_configVersion_fingerprint:{cameraId:identity.cameraId,configVersion:identity.version,fingerprint}},create:{cameraId:identity.cameraId,configVersion:identity.version,fingerprint,kind,evidence:evidence as Prisma.InputJsonValue,expiresAt:new Date(now.getTime()+86_400_000)},update:{attempts:{increment:1},lastReceivedAt:now}});
      const excess = await tx.itsapiInbox.findMany({where:{cameraId:identity.cameraId},orderBy:{receivedAt:"desc"},skip:32,select:{id:true}});
      if (excess.length) await tx.itsapiInbox.deleteMany({where:{id:{in:excess.map(x=>x.id)}}});
      return true;
    });
    if (!accepted) return reply.code(403).send({error:"REGISTRATION_REVOKED"});
    return reply.code(status).send({ error:errorCode, message:ITSAPI_PROTOCOL_GAP, missing });
  }

  async function identityFor(request: FastifyRequest) {
    const identity = authenticated.get(request);
    if (!identity) throw new ItsapiPayloadError("UPLOAD_AUTH_FAILED");
    const registration = await db.itsapiRegistration.findUnique({ where:{cameraId:identity.cameraId}, include:{camera:{include:{vpnLocation:{select:{timezone:true}}}}} });
    if (!registration || registration.camera.configVersion !== identity.version) throw new ItsapiPayloadError("REGISTRATION_REVOKED");
    if (registration.protocolVersion !== "V1.19") throw new ItsapiPayloadError("UNSUPPORTED_PROTOCOL_VERSION");
    if (!registration.expectedDeviceId) throw new ItsapiPayloadError("DEVICE_ID_NOT_CONFIGURED");
    return { identity, registration };
  }
  async function accept(tx: Prisma.TransactionClient, cameraId: string, version: number, deviceId: string, kind: "heartbeat" | "passage") {
    const current = await tx.itsapiRegistration.findUnique({where:{cameraId}});
    const updated = await tx.itsapiRegistration.updateMany({ where:{cameraId,expectedDeviceId:deviceId,protocolVersion:"V1.19"}, data:{
      ...(current?.evidenceVersion !== version ? {lastHeartbeatAt:null,lastEventAt:null} : {}),
      lastRequestAt:new Date(), lastAuthenticatedAt:new Date(), lastIdentityAt:new Date(), evidenceVersion:version, lastErrorCode:null,
      ...(kind === "heartbeat" ? {lastHeartbeatAt:new Date()} : {lastEventAt:new Date()}),
    } });
    if (updated.count !== 1) throw new ItsapiPayloadError("REGISTRATION_REVOKED");
    await tx.camera.update({where:{id:cameraId},data:{anprConnectionStatus:"CONNECTED",lastAnprConnectionAt:new Date(),lastAnprErrorCode:null,lastAnprError:null}});
  }
  async function handleKnown(request: FastifyRequest, reply: FastifyReply, kind: "heartbeat" | "passage") {
    try {
      const {identity,registration} = await identityFor(request);
      if (kind === "heartbeat") {
        const heartbeat = parseItsapiHeartbeat(request.body);
        if (heartbeat.deviceId !== registration.expectedDeviceId) throw new ItsapiPayloadError("DEVICE_ID_MISMATCH");
        await db.$transaction(async tx => {
          const locked = await tx.camera.updateMany({where:{id:identity.cameraId,configVersion:identity.version,archivedAt:null,anprProvider:"DAHUA_ITSAPI",OR:[{active:true},{isDraft:true,draftExpiresAt:{gt:new Date()}}]},data:{configVersion:identity.version}});
          if (!locked.count) throw new ItsapiPayloadError("REGISTRATION_REVOKED");
          await accept(tx,identity.cameraId,identity.version,heartbeat.deviceId,"heartbeat");
        });
        return reply.code(200).send({Active:true,DeviceID:heartbeat.deviceId});
      }
      if (!registration.camera.active || registration.camera.isDraft) throw new ItsapiPayloadError("CAMERA_NOT_ACTIVE");
      const parsed = parseItsapiTollgate(request.body, {id:identity.cameraId,timezone:resolveTimeZone(registration.camera.vpnLocation?.timezone,config.PLATFORM_TIMEZONE),directionMapping:registration.camera.directionMapping});
      if (parsed.deviceId !== registration.expectedDeviceId) throw new ItsapiPayloadError("DEVICE_ID_MISMATCH");
      parsed.event.rawMetadata = {...parsed.event.rawMetadata,configVersion:identity.version};
      await passageService.store(parsed.event, { requireImagesStored:true,expectedProvider:"DAHUA_ITSAPI",expectedConfigVersion:identity.version,
        onAccepted:tx=>accept(tx,identity.cameraId,identity.version,parsed.deviceId,"passage"),
      });
      return reply.code(200).send({Result:true,DeviceID:parsed.deviceId});
    } catch (error) {
      if (error instanceof ItsapiPayloadError) return diagnose(request,reply,error.code,error.missing,["DEVICE_ID_MISMATCH","REGISTRATION_REVOKED"].includes(error.code)?403:422);
      if (error instanceof Error && error.message === "CAMERA_NOT_ACTIVE") return diagnose(request,reply,"REGISTRATION_REVOKED",[],403);
      throw error; // Safe global handler returns 503; never acknowledge failed storage/commit.
    }
  }
  app.post(ITSAPI_HEARTBEAT_PATH, (request,reply)=>handleKnown(request,reply,"heartbeat"));
  app.post(ITSAPI_ANPR_PATH, (request,reply)=>handleKnown(request,reply,"passage"));
  app.all("/*", (request,reply)=>diagnose(request,reply,"UNSUPPORTED_ENDPOINT",[],501));
  return app;
}
