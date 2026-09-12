// New synthetic fixtures only; existing test data is never reset or removed.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {PrismaClient} from "@prisma/client";
import {PassageService} from "../apps/anpr-worker/src/passage-service.js";
import {loadDashboard} from "../apps/api/src/routes/dashboard.js";
import {dispatchHit} from "../apps/api/src/lib/notification-dispatcher.js";
assert(new URL(process.env.DATABASE_URL!).pathname.endsWith('/anpr_native_test'));
const db=new PrismaClient(),marker=`group-fixture-${randomUUID()}`,groups:string[]=[],cameras:string[]=[],users:string[]=[];
const now=new Date('2099-09-12T12:00:00Z');
try{
 const before=await loadDashboard(db,now);
 const group=await db.plateGroup.create({data:{name:marker,color:'#123456',hitEnabled:false}});groups.push(group.id);
 const camera=await db.camera.create({data:{name:marker,location:'Synthetic fixture',direction:'INCOMING',active:true,rtspEnabled:false}});cameras.push(camera.id);
 const plate='T'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
 await db.plateGroupMember.create({data:{groupId:group.id,normalizedLicensePlate:plate,displayLicensePlate:plate,reason:'Fixture reason A'}});
 const service=new PassageService({prisma:db,storage:{storePassageImage:async()=>{throw new Error('No fixture images')},delete:async()=>{}},dedupeWindowMs:3000,logger:{info:()=>{},warn:()=>{},error:()=>{}}});
 const event={cameraId:camera.id,originalPlate:plate,normalizedPlate:plate,source:'DAHUA_CAMERA' as const,occurredAt:now,sourceEventId:marker+'-off'};
 await service.store(event);assert.equal(await db.hit.count({where:{cameraId:camera.id}}),0);
 await db.plateGroup.update({where:{id:group.id},data:{hitEnabled:true}});
 await service.store({...event,sourceEventId:marker+'-one'});
 let hits=await db.hit.findMany({where:{cameraId:camera.id},include:{groups:true}});assert.equal(hits.length,1);assert.equal(hits[0].groups[0].reason,'Fixture reason A');
 const firstDashboard=await loadDashboard(db,now);assert.equal(firstDashboard.counters.hitsToday,before.counters.hitsToday+1);assert(firstDashboard.recentHits.some(h=>h.id===hits[0].id));
 const second=await db.plateGroup.create({data:{name:marker+'-second',color:'#345678',hitEnabled:true}});groups.push(second.id);await db.plateGroupMember.create({data:{groupId:second.id,normalizedLicensePlate:plate,displayLicensePlate:plate,reason:'Fixture reason B'}});
 const two={...event,sourceEventId:marker+'-two',occurredAt:new Date(now.getTime()+500)};
 const results=await Promise.all([service.store(two),service.store(two)]);assert.equal(results.filter(r=>r.status==='stored').length,1);
 hits=await db.hit.findMany({where:{cameraId:camera.id},include:{groups:true},orderBy:{timestamp:'desc'}});assert.equal(hits.length,2);assert.equal(hits[0].groups.length,2);
 const user=await db.user.create({data:{username:marker,email:marker+'@example.invalid',displayName:'Fixture',passwordHash:'unused',notificationPreference:{create:{pushEnabled:true,allHitGroups:true}},pushSubscriptions:{create:{endpoint:'https://push.example.invalid/'+marker,p256dh:'fixture',auth:'fixture'}}}});users.push(user.id);
 const pushDb=db.$extends({query:{user:{findMany({args,query}){args.where={...args.where,id:user.id};return query(args)}}}}) as unknown as PrismaClient;
 let sends=0;const sender={send:async()=>{sends++}};await dispatchHit(pushDb,hits[0].id,sender);await dispatchHit(pushDb,hits[0].id,sender);assert.equal(sends,1);assert.equal(await db.notification.count({where:{hitId:hits[0].id}}),1);assert.equal((await db.hit.findUniqueOrThrow({where:{id:hits[0].id}})).notificationStatus,'SENT');
 // Rules may change later. Existing Hit/HitGroup history must still drive the dashboard.
 await db.plateGroup.updateMany({where:{id:{in:groups}},data:{hitEnabled:false,active:false}});
 const after=await loadDashboard(db,now);assert.equal(after.counters.hitsToday,before.counters.hitsToday+2);const listed=after.recentHits.find(h=>h.id===hits[0].id);assert(listed);assert.equal(listed.groups.length,2);assert.deepEqual(new Set(listed.groups.map((g:any)=>g.reason)),new Set(['Fixture reason A','Fixture reason B']));
 console.log('PASS: HIT off/on; historical group + reason; two groups → one Hit; concurrent retry → no duplicate Hit; one push per device; retry retains SENT; dashboard count/list same Hit source even after rules disabled. Independent individual hit rule: not present in current model.');
}finally{
 await db.hit.deleteMany({where:{cameraId:{in:cameras}}});await db.passage.deleteMany({where:{cameraId:{in:cameras}}});await db.camera.deleteMany({where:{id:{in:cameras}}});await db.plateGroup.deleteMany({where:{id:{in:groups}}});await db.user.deleteMany({where:{id:{in:users}}});await db.$disconnect();
}
