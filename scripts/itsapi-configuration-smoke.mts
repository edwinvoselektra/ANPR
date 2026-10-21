// Isolated PostgreSQL test: real authenticated admin API -> registration -> receiver.
// No camera, real plates, external notifications or production database allowed.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {buildServer} from "../apps/api/src/server.js";
import {buildItsapiReceiver} from "../apps/api/src/itsapi-receiver.js";
import {prisma as db} from "../apps/api/src/lib/prisma.js";
import {hashToken} from "../apps/api/src/lib/crypto.js";
assert.equal(new URL(process.env.DATABASE_URL!).pathname,"/anpr_native_test","Only isolated anpr_native_test database permitted");
const marker=`source-${randomUUID()}`, cameraId=randomUUID(), userId=randomUUID();
const token=randomUUID(), deviceId=`synthetic-${randomUUID()}`;
const admin=buildServer(), receiver=buildItsapiReceiver(db);
const existingRole=await db.role.findUnique({where:{name:"ADMIN"}});
const role=existingRole??await db.role.create({data:{name:"ADMIN"}});
const url=`/cameras/${cameraId}/itsapi`, headers={cookie:`anpr_session=${token}`};
const settings={receiverOrigin:"http://192.0.2.1:7070",addressConfirmed:true,expectedDeviceId:deviceId,protocolVersion:"V1.19",heartbeatSeconds:300,authenticationEnabled:false};
const heartbeat="/NotificationInfo/KeepAlive", tollgate="/NotificationInfo/TollgateInfo";
try{
  await db.user.create({data:{id:userId,username:marker,email:`${marker}@example.invalid`,displayName:"Synthetic admin",passwordHash:"unused-test-only",roles:{create:{roleId:role.id}},sessions:{create:{tokenHash:hashToken(token),expiresAt:new Date(Date.now()+3600_000)}}}});
  await db.camera.create({data:{id:cameraId,name:marker,location:"Synthetic test",direction:"BOTH",active:true,rtspEnabled:false,rtspHost:"192.0.2.201",anprProvider:"DAHUA_ITSAPI"}});
  for(const expectedSourceIp of ["192.0.2.11","192.0.2.12",""]){
    const response=await admin.inject({method:"PUT",url,headers,payload:{...settings,expectedSourceIp}});
    assert.equal(response.statusCode,200,response.body);
    // Independent DB read proves persistence beyond API/component state.
    assert.equal((await db.itsapiRegistration.findUniqueOrThrow({where:{cameraId}})).expectedSourceIp,expectedSourceIp||null);
    const read=await admin.inject({method:"GET",url,headers});
    assert.equal(read.statusCode,200);
    assert.equal(read.json().registration.expectedSourceIp,expectedSourceIp||null);
    assert.equal(read.json().registration.passwordEncrypted,undefined);
  }
  for(const bad of ["192.0.2.999","::1","192.0.2.0/24"]){
    assert.equal((await admin.inject({method:"PUT",url,headers,payload:{...settings,expectedSourceIp:bad}})).statusCode,400);
    assert.equal((await db.itsapiRegistration.findUniqueOrThrow({where:{cameraId}})).expectedSourceIp,null);
  }
  const send=(path:string,source:string,id=deviceId)=>receiver.inject({method:"POST",url:path,remoteAddress:source,payload:path===heartbeat?{Active:"keepAlive",DeviceID:id}:{Picture:{Plate:{PlateNumber:"TEST123"},SnapInfo:{DeviceID:id,AccurateTime:"2026-10-21 12:00:00.123"}}}});
  for(const path of [heartbeat,tollgate]){
    assert.equal((await send(path,"192.0.2.201")).statusCode,200);
    assert.equal((await send(path,"192.0.2.11")).statusCode,403);
  }
  assert.equal((await admin.inject({method:"PUT",url,headers,payload:{...settings,expectedSourceIp:"192.0.2.11"}})).statusCode,200);
  for(const path of [heartbeat,tollgate]){
    assert.equal((await send(path,"192.0.2.11")).statusCode,200);
    assert.equal((await send(path,"192.0.2.12")).statusCode,403);
    assert.equal((await send(path,"192.0.2.11","unknown-synthetic")).statusCode,403);
  }
  assert.equal((await db.camera.findUniqueOrThrow({where:{id:cameraId}})).rtspHost,"192.0.2.201");
  assert.equal(await db.passage.count({where:{cameraId}}),1); // Repeated event remains idempotent.
  await db.userRole.deleteMany({where:{userId}}); // Authenticated user with no admin role.
  assert.equal((await admin.inject({method:"PUT",url,headers,payload:{...settings,expectedSourceIp:"192.0.2.12"}})).statusCode,403);
  assert.equal((await db.itsapiRegistration.findUniqueOrThrow({where:{cameraId}})).expectedSourceIp,"192.0.2.11");
  console.log("PASS: real admin API saves/reads/changes/clears PostgreSQL source setting, rejects IPv6/invalid IPv4 and non-admin, receiver accepts direct/NAT and rejects unknown identities/sources on both endpoints.");
}finally{
  await admin.close();await receiver.close();
  await db.passage.deleteMany({where:{cameraId}});
  await db.camera.deleteMany({where:{id:cameraId}});
  await db.auditLog.deleteMany({where:{actorId:userId}});
  await db.user.deleteMany({where:{id:userId}});
  if(!existingRole)await db.role.deleteMany({where:{id:role.id}});
  await db.$disconnect();
}
