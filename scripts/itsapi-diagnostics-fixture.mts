import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { LocalStorageProvider } from "@anpr/shared/passage-storage";
import { hashToken } from "../apps/api/src/lib/crypto.js";

export function assertDiagnosticTestDatabase() {
  const url=new URL(process.env.DATABASE_URL??"postgresql://invalid/invalid");
  assert.equal(url.hostname,"127.0.0.1");assert.equal(url.port,"55440");assert.equal(url.pathname,"/itsapi_diagnostics_test","Only the isolated diagnostics database is allowed");
  assert.equal(resolve(process.env.STORAGE_PATH??""),resolve("data/itsapi-diagnostics-test-store"));
}
export const syntheticDevice="SYNTHETIC_PRIVATE_DEVICE";
export const syntheticSource="192.0.2.40";
export const syntheticPassword="Synthetic-browser-test-only-2026!";
export const jpeg=Buffer.from([255,216,255,217]);
export const syntheticPayload=()=>({Picture:{Plate:{PlateNumber:"PRIVATE123",IsExist:null},SnapInfo:{DeviceID:syntheticDevice,SnapTime:"2026-10-23 13:00:00"},NormalPic:{Content:jpeg.toString("base64")}}});
export async function createDiagnosticFixture(db:PrismaClient) {
  assertDiagnosticTestDatabase();
  await db.notification.deleteMany();await db.auditLog.deleteMany();await db.hit.deleteMany();
  await db.passage.deleteMany();await db.camera.deleteMany();await db.user.deleteMany();await db.plateGroup.deleteMany();
  const permissionKeys=["cameras.view","passages.view"];
  const roles=[];
  for(const name of ["ADMIN","OPERATOR"]){
    const role=await db.role.upsert({where:{name},update:{},create:{name,description:"Synthetic diagnostics test"}});roles.push(role);
    for(const key of permissionKeys){const p=await db.permission.upsert({where:{key},update:{},create:{key,description:"Synthetic test"}});await db.rolePermission.upsert({where:{roleId_permissionId:{roleId:role.id,permissionId:p.id}},update:{},create:{roleId:role.id,permissionId:p.id}})}
  }
  const passwordHash=await bcrypt.hash(syntheticPassword,4);
  const users=[];
  for(let i=0;i<2;i++)users.push(await db.user.create({data:{username:i===0?"diagnostics-admin":"diagnostics-operator",email:`diagnostics-${i}@example.invalid`,displayName:i===0?"Testbeheerder":"Testoperator",passwordHash,roles:{create:{roleId:roles[i]!.id}},sessions:{create:{tokenHash:hashToken(`diagnostics-${i===0?"admin":"operator"}`),expiresAt:new Date(Date.now()+86_400_000)}},notificationPreference:{create:{pushEnabled:true,allHitGroups:true}},pushSubscriptions:{create:{endpoint:`https://push.example.invalid/diagnostics-${i}`,p256dh:"SYNTHETIC_PUSH_KEY",auth:"SYNTHETIC_PUSH_AUTH"}}}}));
  const camera=await db.camera.create({data:{name:"Staverhul",location:"Synthetische testlocatie",direction:"BOTH",configVersion:3,rtspEnabled:false,active:true,rtspHost:"192.0.2.201",anprProvider:"DAHUA_ITSAPI",uploadRegistration:{create:{username:"SYNTHETIC_UPLOAD_USER",passwordEncrypted:"SYNTHETIC_ENCRYPTED_CREDENTIAL",expectedDeviceId:syntheticDevice,expectedSourceIp:syntheticSource,protocolVersion:"V1.19",receiverOrigin:"http://192.0.2.1:7070",authenticationEnabled:false}}}});
  const other=await db.camera.create({data:{name:"Bestaande testcamera",location:"Synthetische historie",direction:"BOTH",rtspEnabled:false,active:false}});
  const storage=new LocalStorageProvider(process.env.STORAGE_PATH!,8_000_000);
  const objectId=await storage.storePassageImage({data:jpeg,contentType:"image/jpeg"},new Date());
  const passage=await db.passage.create({data:{cameraId:other.id,originalLicensePlate:"LEGACY123",normalizedLicensePlate:"LEGACY123",displayLicensePlate:"LEGACY123",location:other.location,direction:"UNKNOWN",source:"DAHUA_CAMERA",expiresAt:new Date(Date.now()+86_400_000),vehicleImage1ObjectId:objectId}});
  return {cameraId:camera.id,otherCameraId:other.id,passageId:passage.id,objectId,storage,adminId:users[0]!.id,operatorId:users[1]!.id};
}
export async function preservationSnapshot(db:PrismaClient,otherCameraId:string,objectId:string) {
  const [cameras,other,passages,users,preferences,subscriptions,registrations]=await Promise.all([
    db.camera.findMany({orderBy:{id:"asc"},select:{id:true,name:true,location:true,active:true,configVersion:true,anprProvider:true,rtspHost:true,rtspUsernameEncrypted:true,rtspPasswordEncrypted:true}}),
    db.camera.findUnique({where:{id:otherCameraId}}),db.passage.findMany({orderBy:{id:"asc"}}),db.user.findMany({orderBy:{id:"asc"}}),db.notificationPreference.findMany({orderBy:{id:"asc"}}),db.pushSubscription.findMany({orderBy:{id:"asc"}}),
    db.itsapiRegistration.findMany({orderBy:{cameraId:"asc"},select:{cameraId:true,username:true,passwordEncrypted:true,expectedDeviceId:true,expectedSourceIp:true,protocolVersion:true,authenticationEnabled:true,heartbeatSeconds:true,receiverOrigin:true}}),
  ]);
  const digest=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
  return {records:digest(JSON.stringify({cameras,other,passages,users,preferences,subscriptions,registrations})),image:digest(await readFile(resolve(process.env.STORAGE_PATH!,objectId)))};
}
