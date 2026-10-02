// Real PostgreSQL/storage integration; synthetic camera data and stubbed push only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { LocalStorageProvider } from "@anpr/shared/passage-storage";
import { createDigestAuthorization } from "@anpr/shared/dahua";
import { buildItsapiReceiver } from "../apps/api/src/itsapi-receiver.js";
import { encryptSecret } from "../apps/api/src/lib/crypto.js";
import { dispatchHit } from "../apps/api/src/lib/notification-dispatcher.js";
assert.equal(new URL(process.env.DATABASE_URL!).pathname,"/anpr_native_test","Only isolated anpr_native_test database permitted");
const db = new PrismaClient({log:[]}), marker=`itsapi-${randomUUID()}`;
const cameraId=randomUUID(),groupId=randomUUID(),userId=randomUUID();
const root=resolve("data",marker), storage=new LocalStorageProvider(root,8_000_000);
const app=buildItsapiReceiver(db,storage);
const heartbeat="/NotificationInfo/KeepAlive",tollgate="/NotificationInfo/TollgateInfo";
const password="synthetic-test-only",deviceId=`fixture-${randomUUID()}`;
const jpeg=Buffer.from([255,216,255,217]);
async function send(path:string,payload:object,secret=password) {
 const challenge=await app.inject({method:"POST",url:path});
 const authorization=createDigestAuthorization({challenge:String(challenge.headers["www-authenticate"]),method:"POST",uri:path,username:marker,password:secret});
 return app.inject({method:"POST",url:path,headers:{authorization},payload});
}
const payload={Picture:{Plate:{PlateNumber:"ITS123",Confidence:204,Channel:0},SnapInfo:{DeviceID:deviceId,AccurateTime:"2026-10-02 13:24:56.123"},NormalPic:{Content:jpeg.toString("base64")},CutoutPic:{Content:jpeg.toString("base64")},VehiclePic:{Content:jpeg.toString("base64")}}};
try {
 await db.camera.create({data:{id:cameraId,name:marker,location:"ITSAPI integration",direction:"BOTH",active:true,rtspEnabled:false,anprProvider:"DAHUA_ITSAPI",uploadRegistration:{create:{username:marker,passwordEncrypted:encryptSecret(password)!,expectedDeviceId:deviceId,protocolVersion:"V1.19"}}}});
 await db.plateGroup.create({data:{id:groupId,name:marker,color:"#000000",hitEnabled:true,members:{create:{normalizedLicensePlate:"ITS123",displayLicensePlate:"ITS123",reason:"Synthetic test"}}}});
 await db.user.create({data:{id:userId,username:marker,email:`${marker}@example.invalid`,displayName:"ITSAPI fixture",passwordHash:"unused-synthetic",notificationPreference:{create:{pushEnabled:true,allHitGroups:false,groups:{create:{groupId}}}},pushSubscriptions:{create:{endpoint:`https://example.invalid/${marker}`,p256dh:"synthetic",auth:"synthetic"}}}});
 assert.equal((await send(heartbeat,{Active:"keepAlive",DeviceID:deviceId})).statusCode,200);
 assert((await db.itsapiRegistration.findUniqueOrThrow({where:{cameraId}})).lastHeartbeatAt);
 assert.equal((await send(heartbeat,{Active:"keepAlive",DeviceID:"wrong"})).statusCode,403);
 assert.equal((await send(tollgate,payload,"wrong")).statusCode,401);
 // Concurrent uploads exercise the real camera row lock and unique constraint.
 const responses=await Promise.all([send(tollgate,payload),send(tollgate,payload)]);
 assert(responses.every(r=>r.statusCode===200),responses.map(r=>r.statusCode).join(","));
 assert.equal(await db.passage.count({where:{cameraId}}),1);
 assert.equal(await db.hit.count({where:{cameraId}}),1);
 const passage=await db.passage.findFirstOrThrow({where:{cameraId}});
 assert(passage.vehicleImage1ObjectId&&passage.plateImageObjectId&&passage.vehicleImage2ObjectId);
 for(const id of [passage.vehicleImage1ObjectId,passage.plateImageObjectId,passage.vehicleImage2ObjectId])assert((await readFile(resolve(root,id))).equals(jpeg));
 const hit=await db.hit.findFirstOrThrow({where:{cameraId}});let pushes=0;
 const sender={async send(){pushes++}};
 await dispatchHit(db,hit.id,sender);
 assert.equal((await send(tollgate,payload)).statusCode,200);
 await dispatchHit(db,hit.id,sender);
 assert.equal(pushes,1);assert.equal(await db.notification.count({where:{hitId:hit.id,status:"SENT"}}),1);
 assert.equal(await db.hit.count({where:{cameraId}}),1);
 // Same upload counter with a different timestamp is a new passage.
 const optional={Picture:{Plate:{PlateNumber:"ITS123"},SnapInfo:{DeviceID:deviceId,AccurateTime:"2026-10-02 13:24:57.123"}}};
 assert.equal((await send(tollgate,optional)).statusCode,200);
 assert.equal(await db.passage.count({where:{cameraId}}),2);
 const late={Picture:{...payload.Picture,SnapInfo:optional.Picture.SnapInfo}};
 assert.equal((await send(tollgate,late)).statusCode,200);
 assert.equal(await db.passage.count({where:{cameraId}}),2);
 const enriched=await db.passage.findFirstOrThrow({where:{cameraId,timestamp:new Date("2026-10-02T11:24:57.123Z")}});
 assert(enriched.vehicleImage1ObjectId&&enriched.plateImageObjectId&&enriched.vehicleImage2ObjectId);
 assert.equal(await db.hit.count({where:{cameraId}}),2);
 assert.equal((await send(tollgate,{Unexpected:{}})).statusCode,422);
 console.log("PASS: heartbeat, Device ID, Digest, concurrent retry deduplication, three images, optional fields, late images, one push per hit despite camera retry. Synthetic fixtures; no hardware claim.");
} finally {
 await app.close();
 await db.passage.deleteMany({where:{cameraId}});
 await db.camera.deleteMany({where:{id:cameraId}});
 await db.user.deleteMany({where:{id:userId}});
 await db.plateGroup.deleteMany({where:{id:groupId}});
 await db.$disconnect();
 await rm(root,{recursive:true,force:true});
}
