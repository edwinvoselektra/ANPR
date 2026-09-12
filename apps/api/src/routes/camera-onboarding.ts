import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { normalizeCameraHost, PERMISSIONS } from "@anpr/shared";
import { requireAdmin, requirePermission } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { encryptedConnection, buildRtspUrl, publicCamera } from "../lib/camera.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import { testRtsp } from "../lib/rtsp.js";
import { config } from "../config.js";
import { cameraDiagnostics } from "../lib/camera-diagnostics.js";
import { ITSAPI_PROTOCOL_GAP } from "../lib/itsapi-protocol.js";

const params = z.object({id:z.string().uuid()});
const draftBody = z.object({
  draftKey:z.string().uuid(), name:z.string().trim().min(2).max(100),location:z.string().trim().min(2).max(150),
  locationId:z.string().uuid().nullable().optional(), connectionMode:z.enum(["FIELDS","URL"]).default("FIELDS"),
  rtspHost:z.string().max(253).optional(),rtspUrl:z.string().max(2048).optional(),rtspPort:z.coerce.number().int().min(1).max(65535).default(554),
  rtspPath:z.string().max(1000).default("/cam/realmonitor?channel=1&subtype=0"),username:z.string().max(200).optional(),password:z.string().max(500).optional(),
  rtspEnabled:z.boolean().default(true),anprProvider:z.enum(["DAHUA_ITSAPI","DAHUA_CGI","NONE"]).default("DAHUA_ITSAPI"),
  direction:z.enum(["INCOMING","OUTGOING","BOTH"]).default("BOTH")
});
export function receiverOrigin(value: string, cameraHost: string | null) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || host === cameraHost?.toLowerCase() || ['localhost','api','web','postgres','redis','0.0.0.0','[::1]'].includes(host) || /^127\.|^169\.254\./.test(host) || !host.includes('.')) throw Object.assign(new Error("Gebruik een door de camera bereikbaar LAN-/VPN-adres, zonder pad of inloggegevens. Gebruik geen camera-IP, localhost of interne servicenaam."),{statusCode:400});
  return url.origin;
}
export async function cleanupCameraDrafts() {
  const now=new Date();
  await prisma.$transaction(async tx => {
    const expired=await tx.camera.findMany({where:{isDraft:true,draftExpiresAt:{lt:now}},select:{id:true}});
    const ids=expired.map(x=>x.id);
    // First revoke/lock configuration. Never delete historical relations or unrelated cameras.
    await tx.camera.updateMany({where:{id:{in:ids},isDraft:true,draftExpiresAt:{lt:now}},data:{active:false,archivedAt:now,rtspUsernameEncrypted:null,rtspPasswordEncrypted:null,rtspHost:null,lastSnapshotObjectId:null,videoTest:Prisma.DbNull,anprProvider:"NONE"}});
    await tx.itsapiRegistration.deleteMany({where:{cameraId:{in:ids},camera:{archivedAt:{not:null}}}});
    await tx.itsapiInbox.deleteMany({where:{OR:[{expiresAt:{lt:now}},{cameraId:{in:ids},camera:{archivedAt:{not:null}}}]}});
    await tx.camera.deleteMany({where:{id:{in:ids},archivedAt:{not:null},isDraft:true,passages:{none:{}},hits:{none:{}}}});
    await tx.itsapiDigestReplay.deleteMany({where:{expiresAt:{lt:now}}});
  });
}
export async function onboardingRoutes(app: FastifyInstance) {
  app.post("/camera-drafts",{preHandler:requireAdmin()},async(request,reply)=>{
    const body=draftBody.parse(request.body);
    if(body.locationId&&!await prisma.vpnLocation.findUnique({where:{id:body.locationId}}))return reply.code(400).send({message:"Kies een bestaande VPN-locatie."});
    const existing=await prisma.camera.findUnique({where:{draftKey:body.draftKey}});
    if(existing){if(!existing.isDraft||existing.archivedAt||!existing.draftExpiresAt||existing.draftExpiresAt<new Date())return reply.code(409).send({message:"Dit concept is al afgerond of verlopen. Start een nieuwe camera."});return {camera:publicCamera(existing)};}
    const connection=encryptedConnection(body);
    const camera=await prisma.camera.upsert({where:{draftKey:body.draftKey},update:{},create:{...connection,name:body.name,location:body.location,locationId:body.locationId,direction:body.direction,rtspEnabled:body.rtspEnabled,anprProvider:body.anprProvider,isDraft:true,draftKey:body.draftKey,draftExpiresAt:new Date(Date.now()+7*86_400_000),active:false}});
    await audit(request,"CAMERA_DRAFT_CREATED",{objectType:"Camera",objectId:camera.id});
    return reply.code(201).send({camera:publicCamera(camera)});
  });
  app.post("/cameras/:id/finalize",{preHandler:requireAdmin()},async(request)=>{
    const {id}=params.parse(request.params);const {active}=z.object({active:z.boolean().default(true)}).parse(request.body??{});
    const camera=await prisma.camera.update({where:{id,archivedAt:null},data:{isDraft:false,draftExpiresAt:null,active,status:active?"OFFLINE":"DISABLED"}});
    await audit(request,"CAMERA_DRAFT_FINALIZED",{objectType:"Camera",objectId:id});
    return {camera:publicCamera(camera),message:camera.anprProvider==="DAHUA_ITSAPI"?"Opgeslagen – ITSAPI nog niet bevestigd.":"Opgeslagen. Controleer de afzonderlijke diagnose."};
  });
  app.post("/cameras/:id/test-video",{preHandler:requirePermission(PERMISSIONS.CAMERAS_MANAGE),config:{rateLimit:{max:6,timeWindow:"1 minute"}}},async(request,reply)=>{
    const {id}=params.parse(request.params);
    const camera=await prisma.camera.findUniqueOrThrow({where:{id,archivedAt:null}});
    const result=await testRtsp(buildRtspUrl(camera));
    const updated=await prisma.camera.updateMany({where:{id,archivedAt:null,configVersion:camera.configVersion},data:{lastConnectionSuccessAt:result.success?new Date():undefined,videoTest:result as Prisma.InputJsonValue,videoTestAt:new Date(),videoTestVersion:camera.configVersion,lastSnapshotObjectId:result.snapshotObjectId??null}});
    return reply.header("Cache-Control","no-store").send({...result,configVersion:camera.configVersion,stale:updated.count===0});
  });
  app.get("/cameras/:id/itsapi",{preHandler:requireAdmin()},async(request,reply)=>{
    const {id}=params.parse(request.params);await prisma.camera.findUniqueOrThrow({where:{id,archivedAt:null}});
    const r=await prisma.itsapiRegistration.findUnique({where:{cameraId:id}});
    if(!r)return {registration:null,publishedPort:config.ITSAPI_PUBLISHED_PORT,protocolVerified:false,protocolGap:ITSAPI_PROTOCOL_GAP};
    const {passwordEncrypted, ...safe}=r;void passwordEncrypted;
    return reply.header("Cache-Control","no-store").send({registration:safe,publishedPort:config.ITSAPI_PUBLISHED_PORT,protocolVerified:false,protocolGap:ITSAPI_PROTOCOL_GAP,internalPort:config.ITSAPI_PORT});
  });
  app.put("/cameras/:id/itsapi",{preHandler:requireAdmin()},async(request)=>{
    const {id}=params.parse(request.params);
    const body=z.object({receiverOrigin:z.string().url(),addressConfirmed:z.literal(true),expectedDeviceId:z.string().trim().min(1).max(200),protocolVersion:z.string().trim().min(1).max(100),heartbeatSeconds:z.coerce.number().int().min(5).max(86400)}).parse(request.body);
    const camera=await prisma.camera.findUniqueOrThrow({where:{id,archivedAt:null}});
    const origin=receiverOrigin(body.receiverOrigin,camera.rtspHost?normalizeCameraHost(camera.rtspHost):null);
    await prisma.$transaction(async tx=>{
      // Lock the camera before provisioning so delete cannot leave working upload credentials behind.
      await tx.camera.update({where:{id,archivedAt:null},data:{configVersion:{increment:1}}});
      await tx.itsapiRegistration.upsert({where:{cameraId:id},create:{cameraId:id,username:`upload-${randomBytes(8).toString("hex")}`,passwordEncrypted:encryptSecret(randomBytes(24).toString("base64url"))!,receiverOrigin:origin,expectedDeviceId:body.expectedDeviceId,protocolVersion:body.protocolVersion,heartbeatSeconds:body.heartbeatSeconds},update:{receiverOrigin:origin,expectedDeviceId:body.expectedDeviceId,protocolVersion:body.protocolVersion,heartbeatSeconds:body.heartbeatSeconds,lastErrorCode:null}});
    });
    await audit(request,"ITSAPI_REGISTRATION_CONFIGURED",{objectType:"Camera",objectId:id});
    return {success:true,message:"Uploadinstellingen opgeslagen. Wachten op geverifieerd protocol en cameraberichten."};
  });
  app.post("/cameras/:id/itsapi/credentials",{preHandler:requireAdmin()},async(request,reply)=>{
    const {id}=params.parse(request.params);const {rotate}=z.object({rotate:z.boolean().default(false)}).parse(request.body??{});
    const result=await prisma.$transaction(async tx=>{
      const camera=await tx.camera.update({where:{id,archivedAt:null},data:rotate?{configVersion:{increment:1}}:{}});
      if(camera.anprProvider!=="DAHUA_ITSAPI")throw Object.assign(new Error("Kies eerst de ITSAPI-koppeling."),{statusCode:400});
      const r=await tx.itsapiRegistration.findUniqueOrThrow({where:{cameraId:id}});
      return rotate?tx.itsapiRegistration.update({where:{cameraId:id},data:{passwordEncrypted:encryptSecret(randomBytes(24).toString("base64url"))!}}):r;
    });
    await audit(request,rotate?"ITSAPI_CREDENTIALS_ROTATED":"ITSAPI_CREDENTIALS_REVEALED",{objectType:"Camera",objectId:id});
    return reply.header("Cache-Control","no-store").send({username:result.username,password:decryptSecret(result.passwordEncrypted)});
  });
  app.post("/cameras/:id/itsapi/debug",{preHandler:requireAdmin()},async(request)=>{
    const {id}=params.parse(request.params);await prisma.camera.findUniqueOrThrow({where:{id,archivedAt:null}});
    await prisma.itsapiRegistration.update({where:{cameraId:id},data:{debugUntil:new Date(Date.now()+15*60_000)}});
    await audit(request,"ITSAPI_SHAPE_DEBUG_ENABLED",{objectType:"Camera",objectId:id});
    return {message:"Structuurdiagnose 15 minuten ingeschakeld; alleen veldnamen en typen, geen waarden of beelden. Bewaring maximaal 24 uur."};
  });
  app.get("/cameras/:id/diagnostics",{preHandler:requirePermission(PERMISSIONS.CAMERAS_VIEW)},async(request,reply)=>{
    const {id}=params.parse(request.params);const camera=await prisma.camera.findUniqueOrThrow({where:{id,archivedAt:null}});
    const registration=await prisma.itsapiRegistration.findUnique({where:{cameraId:id}});
    let receiverActive=false;
    try{const r=await fetch(`http://127.0.0.1:${config.ITSAPI_PORT}/health`,{signal:AbortSignal.timeout(1500)});const body=await r.json() as any;receiverActive=r.ok&&body.service==="itsapi-receiver"&&body.listening===true;}catch{ /* An internal failure is not a camera failure. */ }
    const latestPassage=camera.anprProvider==="DAHUA_CGI"?await prisma.passage.findFirst({where:{cameraId:id,source:"DAHUA_CAMERA",status:"ACTIVE"},orderBy:{createdAt:"desc"},select:{createdAt:true,vehicleImage1ObjectId:true,plateImageObjectId:true,vehicleImage2ObjectId:true,hits:{select:{notificationStatus:true}}}}):null;
    const checks=cameraDiagnostics(camera,registration,receiverActive,new Date(),latestPassage);
    const admin=request.authUser?.roles.some(r=>r==="ADMIN"||r==="Administrator");
    const inbox=admin?await prisma.itsapiInbox.findMany({where:{cameraId:id,expiresAt:{gt:new Date()}},orderBy:{receivedAt:"desc"},take:5,select:{id:true,state:true,kind:true,receivedAt:true,lastReceivedAt:true,attempts:true,evidence:true}}):[];
    return reply.header("Cache-Control","no-store").send({camera:{id:camera.id,name:camera.name,isDraft:camera.isDraft,active:camera.active,anprProvider:camera.anprProvider,configVersion:camera.configVersion},summary:camera.anprProvider==="DAHUA_ITSAPI"?registration?.evidenceVersion===camera.configVersion&&registration?.lastAuthenticatedAt?"Uploadcredentials gecontroleerd; ITSAPI-berichtformaat en camera-identiteit nog niet bevestigd.":"Wachten op verbinding vanuit de camera; ITSAPI-protocol nog niet bevestigd.":"Bestaande camera: bekijk video en het afzonderlijke CGI-alternatief.",nextAction:camera.anprProvider==="DAHUA_ITSAPI"?"Bevestig de uploadinstellingen en lever de ontbrekende firmware-specifieke protocolinformatie aan.":"Test een nieuw beeld; CGI is geen ITSAPI.",checks,inbox});
  });
}
