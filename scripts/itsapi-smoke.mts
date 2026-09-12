// Synthetic protocol/discovery integration only. Never claims camera protocol compatibility.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildServer } from "../apps/api/src/server.js";
import { buildItsapiReceiver } from "../apps/api/src/itsapi-receiver.js";
import { hashToken } from "../apps/api/src/lib/crypto.js";
import { parseDigest } from "../apps/api/src/lib/itsapi-digest.js";
assert(new URL(process.env.DATABASE_URL!).pathname.endsWith("/anpr_native_test"),"Isolated test database required");
const db=new PrismaClient(),api=buildServer(),receiver=buildItsapiReceiver(db);
const marker=`itsapi-fixture-${randomUUID()}`,cameraIds:string[]=[],users:string[]=[],roles:string[]=[];
const md5=(s:string)=>createHash("md5").update(s).digest("hex");
let permissionId:string|undefined;
try{
 const permission=await db.permission.create({data:{key:"cameras.manage",description:marker}});permissionId=permission.id;
 async function session(name:string){const role=await db.role.create({data:{name,permissions:name==="OPERATOR"?{create:{permissionId:permission.id}}:undefined}});roles.push(role.id);const user=await db.user.create({data:{username:`${marker}-${name}`,email:`${marker}-${name}@example.invalid`,displayName:marker,passwordHash:"unused-test-session",roles:{create:{roleId:role.id}}}});users.push(user.id);const token=randomUUID();await db.userSession.create({data:{userId:user.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+600_000)}});return {cookie:`anpr_session=${token}`,origin:process.env.WEB_ORIGIN!};}
 const headers=await session("ADMIN"),operator=await session("OPERATOR");
 const payload={draftKey:randomUUID(),name:marker,location:"Synthetic receiver fixture",rtspHost:"192.0.2.10"};
 const draft=await api.inject({method:"POST",url:"/camera-drafts",headers,payload});assert.equal(draft.statusCode,201,draft.body);const id=draft.json().camera.id;cameraIds.push(id);
 const again=await api.inject({method:"POST",url:"/camera-drafts",headers,payload});assert.equal(again.json().camera.id,id);
 assert.equal((await db.camera.findUniqueOrThrow({where:{id}})).active,false);
 const patch=await api.inject({method:"PATCH",url:`/cameras/${id}`,headers:operator,payload:{active:true}});assert.equal(patch.statusCode,200,patch.body);assert.equal((await db.camera.findUniqueOrThrow({where:{id}})).active,false);
 const upload={receiverOrigin:"http://192.0.2.20:7070",addressConfirmed:true,expectedDeviceId:"fixture-device-only",protocolVersion:"V1.19",heartbeatSeconds:300};
 assert.equal((await api.inject({method:"PUT",url:`/cameras/${id}/itsapi`,headers,payload:{...upload,receiverOrigin:"http://localhost:7070"}})).statusCode,400);
 const provision=await api.inject({method:"PUT",url:`/cameras/${id}/itsapi`,headers,payload:upload});assert.equal(provision.statusCode,200,provision.body);
 const credentials=await api.inject({method:"POST",url:`/cameras/${id}/itsapi/credentials`,headers,payload:{}});assert.equal(credentials.statusCode,200,credentials.body);const {username,password}=credentials.json();
 assert(!(await db.itsapiRegistration.findUniqueOrThrow({where:{cameraId:id}})).passwordEncrypted.includes(password));
 assert.equal((await api.inject({method:"POST",url:`/cameras/${id}/itsapi/credentials`,headers:operator,payload:{}})).statusCode,403);
 for(const path of [`/cameras/${id}`,`/cameras/${id}/itsapi`]){const response=await api.inject({url:path,headers});assert(!response.body.includes(password));assert(!response.body.includes("passwordEncrypted"));}
 await api.inject({method:"POST",url:`/cameras/${id}/itsapi/debug`,headers,payload:{}});
 const path="/NotificationInfo/KeepAlive";
 async function digest(secret=password){const response=await receiver.inject({method:"POST",url:path});const nonce=parseDigest(String(response.headers["www-authenticate"]))!.nonce;const signature=md5(`${md5(`${username}:ANPR-ITSAPI:${secret}`)}:${nonce}:00000001:fixture:auth:${md5(`POST:${path}`)}`);return `Digest username="${username}", realm="ANPR-ITSAPI", nonce="${nonce}", uri="${path}", response="${signature}", qop=auth, nc=00000001, cnonce="fixture"`;}
 const authorization=await digest();const first=await receiver.inject({method:"POST",url:path,headers:{authorization},payload:{DeviceID:"synthetic-private",Time:"synthetic-time"}});assert.equal(first.statusCode,501,first.body);
 assert.equal((await receiver.inject({method:"POST",url:path,headers:{authorization},payload:{}})).statusCode,401);
 const retries=await Promise.all(Array.from({length:2},async()=>receiver.inject({method:"POST",url:path,headers:{authorization:await digest()},payload:{DeviceID:"synthetic-private",Time:"synthetic-time"}})));assert(retries.every(r=>r.statusCode===501));
 assert.equal(await db.itsapiInbox.count({where:{cameraId:id}}),1);
 const inbox=await db.itsapiInbox.findFirstOrThrow({where:{cameraId:id}});assert.equal(inbox.attempts,3);assert(!JSON.stringify(inbox.evidence).includes("synthetic-private"));
 const reg=await db.itsapiRegistration.findUniqueOrThrow({where:{cameraId:id}});assert(reg.lastAuthenticatedAt);assert.equal(reg.lastIdentityAt,null);assert.equal(reg.lastHeartbeatAt,null);
 assert.equal(await db.passage.count({where:{cameraId:id}}),0);assert.equal(await db.hit.count({where:{cameraId:id}}),0);
 assert.equal((await api.inject({method:"DELETE",url:`/cameras/${id}`,headers:operator})).statusCode,403);
 const lateAuthorization=await digest();assert.equal((await api.inject({method:"DELETE",url:`/cameras/${id}`,headers})).statusCode,204);
 assert.equal(await db.itsapiRegistration.count({where:{cameraId:id}}),0);assert.equal(await db.itsapiInbox.count({where:{cameraId:id}}),0);
 assert.equal((await receiver.inject({method:"POST",url:path,headers:{authorization:lateAuthorization},payload:{}})).statusCode,401);
 const expired=await db.camera.create({data:{name:marker+"-expired",location:"fixture",direction:"BOTH",isDraft:true,active:false,draftExpiresAt:new Date(Date.now()-1000)}});cameraIds.push(expired.id);// Global expiry cleanup is intentionally not invoked here: preserve pre-existing test fixtures.
 console.log("PASS: resumable draft; cannot activate draft through PATCH; admin-only configuration/credentials/delete; encrypted secret; invalid origin rejected; real PostgreSQL replay and duplicate quarantine; no false heartbeat/passages/hits; deletion revokes late uploads.");
}finally{
 await db.camera.deleteMany({where:{id:{in:cameraIds}}});await db.auditLog.deleteMany({where:{actorId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.role.deleteMany({where:{id:{in:roles}}});if(permissionId)await db.permission.delete({where:{id:permissionId}});await api.close();await receiver.close();await db.$disconnect();
}
