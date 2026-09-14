// Isolated synthetic fixtures only. No existing records are reset, migrated backwards or removed.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {PrismaClient} from "@prisma/client";
import {normalizeDahuaEvent} from "../apps/anpr-worker/src/providers/dahua-parser.js";
import {PassageService} from "../apps/anpr-worker/src/passage-service.js";
import {buildServer} from "../apps/api/src/server.js";
import {hashToken} from "../apps/api/src/lib/crypto.js";
import {payloadFor} from "../apps/api/src/lib/notification-dispatcher.js";
assert(new URL(process.env.DATABASE_URL!).pathname.endsWith('/anpr_native_test'));
const db=new PrismaClient(),app=buildServer(),marker='mobile-'+randomUUID();let cameraId:string|undefined,locationId:string|undefined,userId:string|undefined,roleId:string|undefined,groupId:string|undefined;
try{
 const location=await db.vpnLocation.create({data:{name:marker,routerType:'MANUAL_OTHER',vpnType:'WIREGUARD',vpnMode:'LOCATION_TO_SERVER',tunnelAddress:'10.254.254.254',remoteLanCidr:'192.0.2.0/24',timezone:'America/New_York'}});locationId=location.id;
 const camera=await db.camera.create({data:{name:marker,location:'Fixture region',locationId:location.id,direction:'BOTH',active:true,rtspEnabled:false,anprProvider:'DAHUA_CGI'},include:{vpnLocation:{select:{timezone:true}}}});cameraId=camera.id;
 const group=await db.plateGroup.create({data:{name:marker,color:'#123456',hitEnabled:true,members:{create:{normalizedLicensePlate:'FIXTURE12',displayLicensePlate:'FIXTURE12',reason:'Direction/time fixture'}}}});groupId=group.id;
 const role=await db.role.create({data:{name:'ADMIN'}});roleId=role.id;const user=await db.user.create({data:{username:marker,email:marker+'@example.invalid',displayName:marker,passwordHash:'unused',roles:{create:{roleId:role.id}}}});userId=user.id;const token=randomUUID();await db.userSession.create({data:{userId:user.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+600000)}});const headers={cookie:`anpr_session=${token}`,origin:process.env.WEB_ORIGIN!};
 const service=new PassageService({prisma:db,storage:{storePassageImage:async()=>{throw new Error('No images')},delete:async()=>{}},dedupeWindowMs:3000,logger:{info:()=>{},warn:()=>{},error:()=>{}}});
 const utc=new Date('2026-07-14T12:42:16Z');const event=normalizeDahuaEvent(camera,{fields:{'Events[0].Code':'TrafficJunction','Events[0].Object.Text':'FIXTURE12','Events[0].EventID':marker,'Events[0].UTC':String(+utc/1000+7200),'Events[0].RealUTC':String(+utc/1000),'Events[0].Direction':'Approach'}})!;
 await service.store(event);const passage=await db.passage.findFirstOrThrow({where:{cameraId:camera.id}});assert.equal(passage.timestamp.toISOString(),utc.toISOString());assert.equal(passage.direction,'INCOMING');assert.equal(passage.timezone,'America/New_York');
 const hit=await db.hit.findFirstOrThrow({where:{cameraId:camera.id},include:{passage:true,camera:{include:{vpnLocation:{select:{timezone:true}}}}}});const push=JSON.parse(payloadFor(hit));assert(push.body.includes('Inkomend'));assert(push.body.includes('14-07-2026 08:42:16'));
 const detail=await app.inject({url:`/hits/${hit.id}`,headers});assert.equal(detail.statusCode,200);assert.equal(detail.json().hit.timeZone,'America/New_York');assert.equal(detail.json().hit.passage.direction,'INCOMING');
 const search=await app.inject({url:`/search/passages?cameraId=${camera.id}&dateFrom=2026-07-14&dateTo=2026-07-14&timeFrom=08:42&timeTo=08:43`,headers});assert.equal(search.statusCode,200,search.body);assert.equal(search.json().total,1);assert.equal(search.json().timeZone,'America/New_York');
 const repeat=await service.store(event);assert.equal(repeat.status,'duplicate');assert.equal(await db.hit.count({where:{cameraId:camera.id}}),1);
 for(const direction of ['INCOMING','OUTGOING','UNKNOWN']){const r=await app.inject({method:'POST',url:'/simulator/passages',headers,payload:{cameraId:camera.id,licensePlate:'FIXTURE12',direction,timestamp:'2026-07-14T12:43:00Z'}});assert.equal(r.statusCode,201,r.body);assert.equal(r.json().passage.direction,direction);assert.equal(r.json().passage.timeZone,'America/New_York');}
 const fallback=await service.store({...event,sourceEventId:marker+'-unknown',direction:undefined});assert.equal(fallback.status,'stored');const unknown=await db.passage.findFirstOrThrow({where:{sourceEventId:marker+'-unknown'}});assert.equal(unknown.direction,'UNKNOWN');
 console.log('PASS: RealUTC storage, camera timezone snapshot, Dahua direction → passage → Hit/API/push, region-local search, simulator INCOMING/OUTGOING/UNKNOWN, legacy BOTH unknown fallback, duplicate preservation.');
}finally{
 if(cameraId){await db.hit.deleteMany({where:{cameraId}});await db.passage.deleteMany({where:{cameraId}});await db.camera.delete({where:{id:cameraId}})}if(groupId)await db.plateGroup.delete({where:{id:groupId}});if(locationId)await db.vpnLocation.delete({where:{id:locationId}});if(userId){await db.auditLog.deleteMany({where:{actorId:userId}});await db.user.delete({where:{id:userId}})}if(roleId)await db.role.delete({where:{id:roleId}});await app.close();await db.$disconnect();
}
