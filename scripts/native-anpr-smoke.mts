import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PassageService } from "../apps/anpr-worker/src/passage-service.js";
import { normalizeDahuaEvent } from "../apps/anpr-worker/src/providers/dahua-parser.js";
import { buildServer } from "../apps/api/src/server.js";
import { hashToken } from "../apps/api/src/lib/crypto.js";

const db = new PrismaClient();
const app = buildServer();
const marker = `native-smoke-${randomUUID()}`;
const cameraIds: string[] = [];
let userId: string | undefined;
let roleId: string | undefined;
let groupId: string | undefined;
try {
  // Run only against an isolated test database: never put fixture hits in a live dispatcher queue.
  assert(new URL(process.env.DATABASE_URL!).pathname.endsWith("/anpr_native_test"));
  const role = await db.role.create({data:{name:"ADMIN"}}); roleId = role.id;
  const user = await db.user.create({data:{email:`${marker}@example.invalid`,username:marker,displayName:marker,passwordHash:"unused-session-only-test",roles:{create:{roleId:role.id}}}}); userId = user.id;
  const token = randomUUID();
  await db.userSession.create({data:{userId:user.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+60000)}});
  const group = await db.plateGroup.create({data:{name:marker,color:"#000000",active:true,hitEnabled:true}}); groupId=group.id;
  await db.plateGroupMember.create({data:{groupId:group.id,normalizedLicensePlate:"TEST12",displayLicensePlate:"TEST12",active:true}});
  const camera = await db.camera.create({data:{name:marker,location:"DEMO integration fixture",direction:"INCOMING",active:true,rtspEnabled:false,rtspHost:"192.0.2.10",anprProvider:"NONE",zones:{create:{type:"RECTANGLE",points:[{x:0,y:0},{x:1,y:1}]}}}}); cameraIds.push(camera.id);
  const event=normalizeDahuaEvent(camera,{fields:{"Events[0].Code":"TrafficJunction","Events[0].EventID":marker,"Events[0].UTC":String(Math.floor(Date.now()/1000)),"Events[0].TrafficCar.PlateNumber":"te-st 12"}})!;
  const service=new PassageService({prisma:db,storage:{storePassageImage:async()=>{throw new Error("No fixture images")},delete:async()=>{}},dedupeWindowMs:3000,logger:{info:()=>{},warn:()=>{},error:()=>{}}});
  const outcomes=await Promise.all([service.store(event),service.store(event)]);
  assert.equal(outcomes.filter(x=>x.status==="stored").length,1);
  assert.equal(await db.passage.count({where:{cameraId:camera.id}}),1);
  assert.equal(await db.hit.count({where:{cameraId:camera.id}}),1);
  // Two distinct passages of the same plate within 500 ms must survive the fallback.
  await service.store({...event,sourceEventId:undefined,occurredAt:new Date(event.occurredAt.getTime()+100)});
  await service.store({...event,sourceEventId:undefined,occurredAt:new Date(event.occurredAt.getTime()+600)});
  assert.equal(await db.passage.count({where:{cameraId:camera.id}}),3);
  assert.equal(await db.hit.count({where:{cameraId:camera.id}}),3);
  const headers={cookie:`anpr_session=${token}`,origin:process.env.WEB_ORIGIN!};
  const denied=await app.inject({method:"DELETE",url:`/cameras/${camera.id}`}); assert.equal(denied.statusCode,401);
  const result=await app.inject({method:"DELETE",url:`/cameras/${camera.id}`,headers}); assert.equal(result.statusCode,204);
  const archived=await db.camera.findUniqueOrThrow({where:{id:camera.id}}); assert(archived.archivedAt); assert.equal(archived.active,false); assert.equal(archived.rtspHost,null);
  assert.equal(await db.cameraZone.count({where:{cameraId:camera.id}}),0);
  assert.equal(await db.passage.count({where:{cameraId:camera.id}}),3); assert.equal(await db.hit.count({where:{cameraId:camera.id}}),3);
  const details=await app.inject({method:"GET",url:`/cameras/${camera.id}`,headers}); assert.equal(details.statusCode,404);
  const history=await app.inject({method:"GET",url:"/passages",headers}); assert.equal(history.statusCode,200); assert.equal(history.json().passages[0].camera.name,marker);
  const hits=await app.inject({method:"GET",url:"/hits",headers}); assert.equal(hits.statusCode,200); assert.equal(hits.json().hits[0].camera.name,marker);
  const replacement=await db.camera.create({data:{name:marker,location:"DEMO integration fixture",direction:"INCOMING"}}); cameraIds.push(replacement.id);
  console.log("PASS: native fixture → PostgreSQL passage → watchlist hit; concurrent dedupe; authenticated ADMIN delete; history and original name retained; zones removed; name reusable.");
} finally {
  await db.hit.deleteMany({where:{cameraId:{in:cameraIds}}});
  await db.passage.deleteMany({where:{cameraId:{in:cameraIds}}});
  await db.camera.deleteMany({where:{id:{in:cameraIds}}});
  if(groupId) await db.plateGroup.delete({where:{id:groupId}});
  if(userId) { await db.auditLog.deleteMany({where:{actorId:userId}}); await db.user.delete({where:{id:userId}}); }
  if(roleId) await db.role.delete({where:{id:roleId}});
  await app.close(); await db.$disconnect();
}
