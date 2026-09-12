import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { challenge, parseDigest, verifyDigest } from "./lib/itsapi-digest.js";
import { cameraDiagnostics } from "./lib/camera-diagnostics.js";
import { payloadShape, ITSAPI_HEARTBEAT_PATH, ITSAPI_ANPR_PATH } from "./lib/itsapi-protocol.js";
import { buildItsapiReceiver } from "./itsapi-receiver.js";
import { encryptSecret } from "./lib/crypto.js";
const key="0".repeat(64), user="synthetic-upload", password="fixture-only", now=Date.now();
const md5=(s:string)=>createHash("md5").update(s).digest("hex");
function authorization(nonce:string,uri=ITSAPI_HEARTBEAT_PATH,secret=password,nc="00000001") {
 const response=md5(`${md5(`${user}:ANPR-ITSAPI:${secret}`)}:${nonce}:${nc}:fixture:auth:${md5(`POST:${uri}`)}`);
 return `Digest username="${user}", realm="ANPR-ITSAPI", nonce="${nonce}", uri="${uri}", response="${response}", qop=auth, nc=${nc}, cnonce="fixture"`;
}
describe("synthetische ITSAPI Digest-tests (geen hardwarebewijs)",()=>{
 const nonce=parseDigest(challenge(key,now))!.nonce!;
 it("verifieert handtekening en levert atomaire replay-identiteit",()=>{
  const proof=verifyDigest({header:authorization(nonce),method:"POST",uri:ITSAPI_HEARTBEAT_PATH,username:user,password,key,now});
  expect(proof).toMatchObject({count:1,expiresAt:new Date(now+300_000)});
 });
 it.each(["wrong password","wrong path","stale nonce","forged nonce"])("weigert %s",failure=>{
  expect(verifyDigest({header:authorization(failure==="forged nonce"?nonce+"x":nonce,ITSAPI_HEARTBEAT_PATH,failure==="wrong password"?"bad":password),method:"POST",uri:failure==="wrong path"?ITSAPI_ANPR_PATH:ITSAPI_HEARTBEAT_PATH,username:user,password,key,now:now+(failure==="stale nonce"?300_001:0)})).toBeNull();
 });
 it("weigert Basic en dubbele velden",()=>{expect(parseDigest("Basic abc")).toBeNull();expect(parseDigest('Digest username="a", username="b"')).toBeNull()});
});
describe("diagnose zonder verzonnen camerabewijs",()=>{
 const camera={configVersion:2,rtspEnabled:true,anprProvider:"DAHUA_ITSAPI"};
 it("interne ontvangerstatus maakt heartbeat of registratie niet groen",()=>{
  const checks=cameraDiagnostics(camera,{heartbeatSeconds:300},true);
  expect(checks.find(c=>c.checkId==="receiver")?.status).toBe("SUCCESS");
  expect(checks.find(c=>c.checkId==="heartbeat")?.status).toBe("WAITING_CAMERA");
  expect(checks.find(c=>c.checkId==="registration")?.status).toBe("NOT_TESTED");
 });
 it("Digest is geen bewijs van Device ID of heartbeat",()=>{
  const checks=cameraDiagnostics(camera,{evidenceVersion:2,lastAuthenticatedAt:new Date(),heartbeatSeconds:300},true);
  expect(checks.find(c=>c.checkId==="upload_identity")?.status).toBe("WARNING");
  expect(checks.find(c=>c.checkId==="heartbeat")?.status).toBe("WAITING_CAMERA");
 });
 it("veroudert video en uploadbewijs na configuratiewijziging",()=>{
  const checks=cameraDiagnostics({...camera,videoTest:{success:true},videoTestVersion:1,videoTestAt:new Date()},{evidenceVersion:1,lastIdentityAt:new Date(),lastHeartbeatAt:new Date()},true);
  expect(checks.find(c=>c.checkId==="video")?.status).toBe("STALE");
  expect(checks.find(c=>c.checkId==="heartbeat")?.status).not.toBe("SUCCESS");
 });
 it("toont echte CGI-opslag afzonderlijk zonder daarvan ITSAPI-bewijs te maken",()=>{
  const checks=cameraDiagnostics({...camera,anprProvider:"DAHUA_CGI"},null,true,new Date(),{createdAt:new Date(),vehicleImage1ObjectId:"overview",plateImageObjectId:null,vehicleImage2ObjectId:null,hits:[{notificationStatus:"SENT"}]});
  expect(checks.find(c=>c.checkId==="database")?.status).toBe("SUCCESS");
  expect(checks.find(c=>c.checkId==="images")?.status).toBe("WARNING");
  expect(checks.find(c=>c.checkId==="push")?.message).toContain("toestelontvangst apart controleren");
  expect(checks.find(c=>c.checkId==="heartbeat")?.status).toBe("DISABLED");
 });
 it("begrensde structuurdiagnose bewaart geen scalars, secrets of beelden",()=>{
  const result=JSON.stringify(payloadShape({DeviceID:"private-device",PlateNo:"private-plate",Password:"secret",Picture:"base64",nested:{Time:"private-time"}}));
  expect(result).toContain('"DeviceID":"string"');expect(result).not.toMatch(/private|secret|base64|PlateNo|Picture/);
 });
});
describe("receiver requestcyclus",()=>{
 let app:ReturnType<typeof buildItsapiReceiver>|undefined;
 afterEach(async()=>{await app?.close()});
 function setup(options:{deleted?:boolean;replay?:boolean;revoked?:boolean}={}) {
  const reg={cameraId:"fixture",username:user,passwordEncrypted:encryptSecret(password),debugUntil:new Date(Date.now()+10000),camera:{id:"fixture",active:true,archivedAt:options.deleted?new Date():null,anprProvider:"DAHUA_ITSAPI",configVersion:2}};
  const db={itsapiRegistration:{findUnique:vi.fn().mockResolvedValue(reg),update:vi.fn(),updateMany:vi.fn()},itsapiDigestReplay:{updateMany:vi.fn().mockResolvedValue({count:0}),create:options.replay?vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate",{code:"P2002",clientVersion:"6"})):vi.fn()},camera:{updateMany:vi.fn().mockResolvedValue({count:options.revoked?0:1})},itsapiInbox:{upsert:vi.fn(),findMany:vi.fn().mockResolvedValue([])},$queryRaw:vi.fn(),$transaction:vi.fn()};
  db.$transaction.mockImplementation(fn=>fn(db));app=buildItsapiReceiver(db as unknown as PrismaClient);return db;
 }
 async function auth(path=ITSAPI_HEARTBEAT_PATH,secret=password){const first=await app!.inject({method:"POST",url:path});expect(first.statusCode).toBe(401);const n=parseDigest(String(first.headers["www-authenticate"]))!.nonce!;return authorization(n,path,secret)}
 it("challenge zonder credentials en verkeerd wachtwoord schrijven geen inbox",async()=>{const db=setup();const header=await auth(ITSAPI_HEARTBEAT_PATH,"wrong");expect((await app!.inject({method:"POST",url:ITSAPI_HEARTBEAT_PATH,headers:{authorization:header},payload:{}})).statusCode).toBe(401);expect(db.itsapiInbox.upsert).not.toHaveBeenCalled()});
 it.each([ITSAPI_HEARTBEAT_PATH,ITSAPI_ANPR_PATH])("quarantaine op bevestigd pad %s geeft nooit succesvolle ACK",async path=>{const db=setup();const header=await auth(path);const response=await app!.inject({method:"POST",url:path,headers:{authorization:header},payload:{DeviceID:"synthetic"}});expect(response.statusCode).toBe(501);expect(response.json().error).toBe("PROTOCOL_NOT_VERIFIED");expect(db.itsapiRegistration.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.not.objectContaining({lastHeartbeatAt:expect.anything()})}));expect(db.itsapiInbox.upsert).toHaveBeenCalledOnce()});
 it.each([{deleted:true},{replay:true}])("weigert verwijderde camera of replay %j",async options=>{const db=setup(options);const header=await auth();expect((await app!.inject({method:"POST",url:ITSAPI_HEARTBEAT_PATH,headers:{authorization:header},payload:{}})).statusCode).toBe(401);expect(db.itsapiInbox.upsert).not.toHaveBeenCalled()});
 it("verwijderen tijdens request voorkomt opslag",async()=>{const db=setup({revoked:true});const header=await auth();expect((await app!.inject({method:"POST",url:ITSAPI_HEARTBEAT_PATH,headers:{authorization:header},payload:{}})).statusCode).toBe(403);expect(db.itsapiInbox.upsert).not.toHaveBeenCalled()});
 it("databasefout geeft geen ACK en een nieuwe poging kan opnieuw registreren",async()=>{const db=setup();db.itsapiInbox.upsert.mockRejectedValueOnce(new Error("temporary"));const upload=async()=>app!.inject({method:"POST",url:ITSAPI_HEARTBEAT_PATH,headers:{authorization:await auth()},payload:{}});expect((await upload()).statusCode).toBe(503);expect((await upload()).statusCode).toBe(501);expect(db.itsapiInbox.upsert).toHaveBeenCalledTimes(2)});
 it("malformed JSON en grote payload krijgen veilige fouten",async()=>{const db=setup();let header=await auth();expect((await app!.inject({method:"POST",url:ITSAPI_HEARTBEAT_PATH,headers:{authorization:header,"content-type":"application/json"},payload:"{"})).statusCode).toBe(400);header=await auth();expect((await app!.inject({method:"POST",url:ITSAPI_HEARTBEAT_PATH,headers:{authorization:header,"content-type":"application/json"},payload:JSON.stringify({data:"x".repeat(16_000_000)})})).statusCode).toBe(413);expect(db.itsapiInbox.upsert).not.toHaveBeenCalled()});
});
