import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { config } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { decryptSecret } from "./lib/crypto.js";
import { challenge, parseDigest, verifyDigest } from "./lib/itsapi-digest.js";
import { ITSAPI_PROTOCOL_GAP, ITSAPI_HEARTBEAT_PATH, ITSAPI_ANPR_PATH, payloadShape } from "./lib/itsapi-protocol.js";

// Shared, bounded receiver in the API process, with a separate upload-only listener.
export function buildItsapiReceiver(db: PrismaClient = prisma) {
  const app = Fastify({ logger: false, bodyLimit: 16_000_000, requestTimeout: 15_000, connectionTimeout: 20_000, keepAliveTimeout: 65_000, trustProxy: false });
  void app.register(rateLimit, { max: 60, timeWindow: "1 minute" });
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
      if (allowed && registration) await db.itsapiRegistration.updateMany({where:{cameraId:registration.cameraId,camera:{archivedAt:null,configVersion:camera!.configVersion}},data:{lastRequestAt:new Date(),lastErrorCode:"UPLOAD_AUTH_FAILED",evidenceVersion:camera!.configVersion}});
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
  app.addHook("onResponse", async request => { if (slots.delete(request)) concurrent--; });
  app.addHook("onRequestAbort", async request => { if (slots.delete(request)) concurrent--; });
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const status = error.statusCode === 413 ? 413 : error.statusCode === 400 ? 400 : error.statusCode === 415 ? 415 : 503;
    return reply.code(status).send({ error:status === 413 ? "UPLOAD_TOO_LARGE" : status === 400 ? "INVALID_JSON" : status === 415 ? "CONTENT_TYPE_UNSUPPORTED" : "RECEIVER_TEMPORARILY_UNAVAILABLE" });
  });
  app.get("/health", async () => {
    await db.$queryRaw`SELECT 1`;
    return {service:"itsapi-receiver",listening:true,protocolVerified:false,cameraConnectionProven:false};
  });
  // No undocumented successful endpoint. Catch requests for discovery and return explicit unsupported.
  app.all("/*", async (request,reply) => {
    const identity = authenticated.get(request);
    if (!identity) return reply.code(401).send();
    const body = request.body;
    const fingerprint = createHash("sha256").update(`${request.method}:${request.url}:${JSON.stringify(body)}`).digest("hex");
    const now = new Date();
    const observedPath = request.url.split("?",1)[0]!;
    const path = /^\/[A-Za-z0-9_/-]{0,160}$/.test(observedPath) ? observedPath : "[afgeschermd]";
    const accepted = await db.$transaction(async tx => {
      const locked = await tx.camera.updateMany({where:{id:identity.cameraId,archivedAt:null,configVersion:identity.version,anprProvider:"DAHUA_ITSAPI",OR:[{active:true},{isDraft:true,draftExpiresAt:{gt:now}}]},data:{configVersion:identity.version}});
      if (!locked.count) return false;
      const registration = await tx.itsapiRegistration.findUnique({where:{cameraId:identity.cameraId}});
      if (!registration) return false;
      await tx.itsapiRegistration.update({where:{cameraId:identity.cameraId},data:{lastRequestAt:now,lastAuthenticatedAt:now,evidenceVersion:identity.version,lastErrorCode:"PROTOCOL_NOT_VERIFIED"}});
      const kind = path === ITSAPI_HEARTBEAT_PATH ? "HEARTBEAT_UNVERIFIED" : path === ITSAPI_ANPR_PATH ? "ANPR_UNVERIFIED" : "UNKNOWN";
      const evidence = { method:request.method,path,contentType:request.headers["content-type"]?.split(";",1)[0] ?? "none",shape:registration.debugUntil && registration.debugUntil > now ? payloadShape(body) : "Tijdelijke structuurdiagnose staat uit; inhoud niet bewaard.",deviceIdentityVerified:false };
      await tx.itsapiInbox.upsert({where:{cameraId_configVersion_fingerprint:{cameraId:identity.cameraId,configVersion:identity.version,fingerprint}},create:{cameraId:identity.cameraId,configVersion:identity.version,fingerprint,kind,evidence:evidence as Prisma.InputJsonValue,expiresAt:new Date(now.getTime()+86_400_000)},update:{attempts:{increment:1},lastReceivedAt:now}});
      const excess = await tx.itsapiInbox.findMany({where:{cameraId:identity.cameraId},orderBy:{receivedAt:"desc"},skip:32,select:{id:true}});
      if (excess.length) await tx.itsapiInbox.deleteMany({where:{id:{in:excess.map(x=>x.id)}}});
      return true;
    });
    if (!accepted) return reply.code(403).send({error:"REGISTRATION_REVOKED"});
    // The camera must NOT consider a quarantined, unknown message successfully processed.
    return reply.code(501).send({error:"PROTOCOL_NOT_VERIFIED",message:ITSAPI_PROTOCOL_GAP});
  });
  return app;
}
