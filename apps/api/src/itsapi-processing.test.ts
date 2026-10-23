import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { formatLocalDate } from "@anpr/shared";
import { createDigestAuthorization } from "@anpr/shared/dahua";
import { buildItsapiReceiver } from "./itsapi-receiver.js";
import { encryptSecret } from "./lib/crypto.js";
import { publicHit } from "./lib/public-hit.js";
import { payloadFor } from "./lib/notification-dispatcher.js";
import { ITSAPI_ANPR_PATH, ITSAPI_HEARTBEAT_PATH } from "./lib/itsapi-protocol.js";
vi.mock("./lib/prisma.js", () => ({ prisma: {} }));

// Synthetic Picture-profile contract fixtures, never claimed to be a camera capture.
const device = "synthetic-device", username = "synthetic-user", password = "synthetic-password";
const jpeg = Buffer.from([255,216,255,217]).toString("base64");
const fixture = () => ({Picture:{
  Plate:{PlateNumber:"TEST123",IsExist:true,Confidence:204,Channel:0},
  SnapInfo:{DeviceID:device,AccurateTime:"2026-10-02 13:24:56.123",Direction:"Approach",SnapAddress:"Testlocatie",LanNo:1},
  Vehicle:{VehicleType:"SaloonCar",VehicleColor:"Blue",VehicleSign:"Test"},
  NormalPic:{Content:jpeg},CutoutPic:{Content:jpeg},VehiclePic:{Content:jpeg},
}});
let app: ReturnType<typeof buildItsapiReceiver>;
let db: any;
let storage: {storePassageImage: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>};
beforeEach(()=>{
  vi.useFakeTimers({toFake:["Date"]});
  vi.setSystemTime(new Date("2026-10-16T08:00:00.000Z"));
  let passage: any = null;
  const camera={id:"fixture-camera",active:true,isDraft:false,archivedAt:null,configVersion:1,anprProvider:"DAHUA_ITSAPI",rtspHost:"192.168.178.248",location:"Configured location",directionMapping:"TOWARD_CAMERA_IS_INCOMING",vpnLocation:{timezone:"Europe/Amsterdam"}};
  const registration={cameraId:camera.id,camera,expectedDeviceId:device,protocolVersion:"V1.19",authenticationEnabled:true,username,passwordEncrypted:encryptSecret(password)};
  db={
    itsapiRegistration:{findUnique:vi.fn().mockResolvedValue(registration),findMany:vi.fn().mockResolvedValue([registration]),updateMany:vi.fn().mockResolvedValue({count:1}),update:vi.fn()},
    itsapiDigestReplay:{updateMany:vi.fn().mockResolvedValue({count:1})},
    camera:{findFirst:vi.fn().mockResolvedValue(camera),updateMany:vi.fn().mockResolvedValue({count:1}),update:vi.fn()},
    passage:{findFirst:vi.fn().mockImplementation(async()=>passage),create:vi.fn().mockImplementation(async({data})=>{passage={id:"stored-passage",...data};return passage}),update:vi.fn()},
    plateGroupMember:{findMany:vi.fn().mockResolvedValue([])},hit:{create:vi.fn().mockResolvedValue({id:"hit"}),updateMany:vi.fn()},
    attentionAnalysisJob:{create:vi.fn()},
    itsapiInbox:{findUnique:vi.fn().mockResolvedValue(null),deleteMany:vi.fn(),upsert:vi.fn(),findMany:vi.fn().mockResolvedValue([])},
    $transaction:vi.fn().mockImplementation(async fn=>fn(db)),
  };
  storage={storePassageImage:vi.fn().mockImplementation(async()=>`passages/${randomUUID()}.jpg`),delete:vi.fn()};
  app=buildItsapiReceiver(db as PrismaClient,storage);
});
afterEach(async()=>{await app.close();vi.useRealTimers()});
async function upload(path: string, payload: unknown, secret = password) {
  const challenge = await app.inject({method:"POST",url:path});
  const authorization = createDigestAuthorization({challenge:String(challenge.headers["www-authenticate"]),method:"POST",uri:path,username,password:secret});
  return app.inject({method:"POST",url:path,headers:{authorization},payload:payload as object});
}
const uploadWithoutAuth = (payload: unknown, remoteAddress = "192.168.178.248", headers?: Record<string,string>) => app.inject({method:"POST",url:ITSAPI_ANPR_PATH,remoteAddress,headers,payload:payload as object});
describe("ITSAPI Picture-profiel verwerking",()=>{
  it("laat auth-uit met juiste Device ID en vast bron-IP toe",async()=>{
    (await db.itsapiRegistration.findUnique()).authenticationEnabled=false;
    const response=await uploadWithoutAuth(fixture());
    expect(response.statusCode).toBe(200);expect(response.json()).toEqual({Result:true,DeviceID:device});
    expect(db.passage.create).toHaveBeenCalledOnce();
    expect(db.itsapiRegistration.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({authenticationEnabled:false,OR:[{expectedSourceIp:"192.168.178.248"},{expectedSourceIp:null,camera:{rtspHost:"192.168.178.248"}}]}),data:expect.not.objectContaining({lastAuthenticatedAt:expect.anything()})}));
  });
  it("verwerkt KeepAlive zonder Digest via dezelfde Device ID- en bron-IP-controle",async()=>{
    (await db.itsapiRegistration.findUnique()).authenticationEnabled=false;
    const response=await app.inject({method:"POST",url:ITSAPI_HEARTBEAT_PATH,remoteAddress:"192.168.178.248",payload:{Active:"keepAlive",DeviceID:device}});
    expect(response.statusCode).toBe(200);expect(response.json()).toEqual({Active:true,DeviceID:device});
    expect(db.itsapiRegistration.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({authenticationEnabled:false,OR:[{expectedSourceIp:"192.168.178.248"},{expectedSourceIp:null,camera:{rtspHost:"192.168.178.248"}}]})}));
  });
  it("weigert auth-uit met onbekende Device ID",async()=>{
    (await db.itsapiRegistration.findUnique()).authenticationEnabled=false;
    db.itsapiRegistration.findMany.mockResolvedValue([]);
    const body=fixture();body.Picture.SnapInfo.DeviceID="unknown-device";
    const response=await uploadWithoutAuth(body);
    expect(response.statusCode).toBe(403);expect(response.json().error).toBe("DEVICE_ID_UNKNOWN");expect(db.passage.create).not.toHaveBeenCalled();
  });
  it("weigert auth-uit vanaf een ander bron-IP",async()=>{
    (await db.itsapiRegistration.findUnique()).authenticationEnabled=false;
    const response=await uploadWithoutAuth(fixture(),"192.168.178.247",{"x-forwarded-for":"192.168.178.248"});
    expect(response.statusCode).toBe(403);expect(response.json().error).toBe("SOURCE_IP_MISMATCH");expect(db.passage.create).not.toHaveBeenCalled();
  });
  it.each([ITSAPI_HEARTBEAT_PATH, ITSAPI_ANPR_PATH])("identificeert VPN-camera op %s met Device ID en expliciete peer", async path => {
    const registration = await db.itsapiRegistration.findUnique();
    Object.assign(registration, {authenticationEnabled:false, expectedSourceIp:"10.99.0.11"});
    registration.camera.rtspHost = "10.20.10.201";
    const payload = path === ITSAPI_HEARTBEAT_PATH ? {Active:"keepAlive", DeviceID:device} : fixture();
    const response = await app.inject({method:"POST",url:path,remoteAddress:"::ffff:10.99.0.11",payload});
    expect(response.statusCode).toBe(200);
    if(path === ITSAPI_ANPR_PATH) {
      expect(db.passage.create).toHaveBeenCalledOnce();
      expect(db.attentionAnalysisJob.create).toHaveBeenCalledOnce();
      expect(storage.storePassageImage).toHaveBeenCalledOnce();
    } else expect(db.passage.create).not.toHaveBeenCalled();
  });
  it.each([ITSAPI_HEARTBEAT_PATH, ITSAPI_ANPR_PATH])("weigert onbekende Device ID via vertrouwde peer op %s", async path => {
    const registration = await db.itsapiRegistration.findUnique();
    Object.assign(registration, {authenticationEnabled:false, expectedSourceIp:"10.99.0.11"});
    db.itsapiRegistration.findMany.mockResolvedValue([]);
    const payload = path === ITSAPI_HEARTBEAT_PATH ? {Active:"keepAlive",DeviceID:"wrong"} : fixture();
    if("Picture" in payload) payload.Picture.SnapInfo.DeviceID = "wrong";
    const response = await app.inject({method:"POST",url:path,remoteAddress:"10.99.0.11",payload});
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("DEVICE_ID_UNKNOWN");
    expect(db.passage.create).not.toHaveBeenCalled();
    expect(storage.storePassageImage).not.toHaveBeenCalled();
  });
  it.each([ITSAPI_HEARTBEAT_PATH, ITSAPI_ANPR_PATH])("weigert juiste Device ID via onbekende bron op %s", async path => {
    Object.assign(await db.itsapiRegistration.findUnique(), {authenticationEnabled:false, expectedSourceIp:"10.99.0.11"});
    const payload = path === ITSAPI_HEARTBEAT_PATH ? {Active:"keepAlive",DeviceID:device} : fixture();
    const response = await app.inject({method:"POST",url:path,remoteAddress:"10.99.0.12",headers:{"x-forwarded-for":"10.99.0.11"},payload});
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("SOURCE_IP_MISMATCH");
    expect(db.passage.create).not.toHaveBeenCalled();
  });
  it("past een expliciete peer ook bij geldige Digest toe", async () => {
    Object.assign(await db.itsapiRegistration.findUnique(),{expectedSourceIp:"10.99.0.11"});
    const challenge = await app.inject({method:"POST",url:ITSAPI_ANPR_PATH});
    const authorization = createDigestAuthorization({challenge:String(challenge.headers["www-authenticate"]),method:"POST",uri:ITSAPI_ANPR_PATH,username,password});
    expect((await app.inject({method:"POST",url:ITSAPI_ANPR_PATH,remoteAddress:"10.99.0.12",headers:{authorization},payload:fixture()})).statusCode).toBe(403);
    expect(db.passage.create).not.toHaveBeenCalled();
    expect((await app.inject({method:"POST",url:ITSAPI_ANPR_PATH,remoteAddress:"10.99.0.11",headers:{authorization},payload:fixture()})).statusCode).toBe(200);
  });
  it("weigert ambigue Device ID voordat broncontrole of opslag plaatsvindt", async () => {
    const registration = await db.itsapiRegistration.findUnique();
    registration.authenticationEnabled=false;
    db.itsapiRegistration.findMany.mockResolvedValue([registration, {...registration,cameraId:"other"}]);
    expect((await uploadWithoutAuth(fixture())).statusCode).toBe(403);
    expect(db.passage.create).not.toHaveBeenCalled();
  });
  it("trekt een gewijzigde peer tijdens verwerking in", async () => {
    const registration = await db.itsapiRegistration.findUnique();
    Object.assign(registration,{authenticationEnabled:false,expectedSourceIp:"10.99.0.11"});
    storage.storePassageImage.mockImplementation(async()=>{
      registration.expectedSourceIp="10.99.0.12";
      return "passages/synthetic.jpg";
    });
    expect((await uploadWithoutAuth(fixture(),"10.99.0.11")).statusCode).toBe(403);
    expect(storage.delete).toHaveBeenCalled();
  });
  it("blijft bij auth-aan zonder Digest een challenge geven",async()=>{
    const response=await uploadWithoutAuth(fixture());
    expect(response.statusCode).toBe(401);expect(response.body).toBe("");expect(response.headers["www-authenticate"]).toMatch(/^Digest /);
    expect(db.passage.create).not.toHaveBeenCalled();
  });
  it("laat auth-aan met geldige Digest toe",async()=>{
    const response=await upload(ITSAPI_ANPR_PATH,fixture());
    expect(response.statusCode).toBe(200);expect(db.passage.create).toHaveBeenCalledOnce();
  });
  it("verwerkt een geldige heartbeat en commit vóór ACK",async()=>{
    const response=await upload(ITSAPI_HEARTBEAT_PATH,{Active:"keepAlive",DeviceID:device});
    expect(response.statusCode).toBe(200);expect(response.json()).toEqual({Active:true,DeviceID:device});
    expect(db.itsapiRegistration.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({expectedDeviceId:device}),data:expect.objectContaining({lastHeartbeatAt:expect.any(Date),lastIdentityAt:expect.any(Date)})}));
    expect(db.camera.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({anprConnectionStatus:"CONNECTED"})}));
    expect(db.passage.create).not.toHaveBeenCalled();
  });
  it("maakt passage, drie beeldkoppelingen en analysetaak",async()=>{
    const response=await upload(ITSAPI_ANPR_PATH,fixture());
    expect(response.statusCode).toBe(200);expect(response.json()).toEqual({Result:true,DeviceID:device});
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(db.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({normalizedLicensePlate:"TEST123",timestamp:new Date("2026-10-16T08:00:00.000Z"),vehicleType:"CAR",vehicleColor:"BLUE",direction:"INCOMING",location:"Testlocatie",plateConfidence:0.8,vehicleImage1ObjectId:expect.any(String),plateImageObjectId:expect.any(String),vehicleImage2ObjectId:expect.any(String)})});
    expect(db.attentionAnalysisJob.create).toHaveBeenCalledOnce();
    expect(storage.storePassageImage).toHaveBeenCalledOnce();
  });
  it("gebruikt ontvangst vóór authenticatie ondanks verwerkingstijd en foutieve cameraklok",async()=>{
    const lookup=db.itsapiRegistration.findUnique.getMockImplementation();
    db.itsapiRegistration.findUnique.mockImplementation(async(...args: unknown[])=>{
      vi.setSystemTime(new Date("2026-10-16T08:02:00.000Z"));
      return lookup!(...args);
    });
    const response=await upload(ITSAPI_ANPR_PATH,fixture());
    expect(response.statusCode).toBe(200);
    expect(db.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({
      timestamp:new Date("2026-10-16T08:00:00.000Z"),
      rawEventMetadata:expect.objectContaining({timeSource:"SERVER_RECEIPT",receivedAt:"2026-10-16T08:00:00.000Z",cameraReportedAt:"2026-10-02T11:24:56.123Z",cameraTimeSource:"AccurateTime"}),
    })});
  });
  it.each([
    ["2026-07-14T05:30:00.123Z", "Europe/Amsterdam", "14-07-2026 07:30:00"],
    ["2026-01-14T06:30:00.123Z", "Europe/Amsterdam", "14-01-2026 07:30:00"],
    ["2026-07-14T05:30:00.123Z", "America/New_York", "14-07-2026 01:30:00"],
    ["2026-01-14T06:30:00.123Z", "Asia/Tokyo", "14-01-2026 15:30:00"],
  ])("gebruikt serverontvangst %s met locatiezone %s", async (utc, zone, local) => {
    vi.setSystemTime(new Date(utc));
    const camera = (await db.itsapiRegistration.findUnique()).camera;
    camera.vpnLocation.timezone = zone;
    const body = fixture(); body.Picture.SnapInfo.AccurateTime = "2000-01-01 00:00:00.123";
    db.plateGroupMember.findMany.mockResolvedValue([{groupId:"group",reason:"test",group:{id:"group",name:"Testlijst"}}]);
    expect((await upload(ITSAPI_ANPR_PATH, body)).statusCode).toBe(200);
    const stored = db.passage.create.mock.calls[0][0].data;
    expect(stored).toMatchObject({timestamp:new Date(utc),timezone:zone,rawEventMetadata:{timeSource:"SERVER_RECEIPT",cameraTimeSource:"AccurateTime",receivedAt:utc}});
    expect(stored.rawEventMetadata.cameraReportedAt).not.toBe(utc);
    expect(formatLocalDate(stored.timestamp, stored.timezone)).toBe(local);
    expect(db.hit.create).toHaveBeenCalledWith({data:expect.objectContaining({timestamp:new Date(utc)})});
    expect(db.plateGroupMember.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({AND:expect.arrayContaining([{OR:[{validFrom:null},{validFrom:{lte:new Date(utc)}}]}])})}));
  });
  it("valt bij ongeldige AccurateTime terug op geldige SnapTime", async () => {
    const body = fixture(); body.Picture.SnapInfo.AccurateTime = "invalid";
    Object.assign(body.Picture.SnapInfo, { SnapTime: "2026-01-14 07:30:00" });
    expect((await upload(ITSAPI_ANPR_PATH, body)).statusCode).toBe(200);
    expect(db.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({timestamp:new Date("2026-10-16T08:00:00Z"),rawEventMetadata:expect.objectContaining({timeSource:"SERVER_RECEIPT",cameraTimeSource:"SnapTime",cameraReportedAt:"2026-01-14T06:30:00.000Z"})})});
  });
  it("herkent retries ondanks gewijzigde uploadteller zonder dubbele passage/hit/pushjob",async()=>{
    db.plateGroupMember.findMany.mockResolvedValue([{groupId:"group",reason:"test",group:{id:"group",name:"Testlijst"}}]);
    expect((await upload(ITSAPI_ANPR_PATH,fixture())).statusCode).toBe(200);
    vi.setSystemTime(new Date("2026-10-16T08:05:00.000Z"));
    (await db.itsapiRegistration.findUnique()).camera.directionMapping="AWAY_FROM_CAMERA_IS_INCOMING";
    const retry=fixture();Object.assign(retry.Picture.Plate,{UploadNum:100});
    expect((await upload(ITSAPI_ANPR_PATH,retry)).statusCode).toBe(200);
    expect(db.passage.create).toHaveBeenCalledOnce();expect(db.hit.create).toHaveBeenCalledOnce();
    expect(db.hit.create).toHaveBeenCalledWith({data:expect.objectContaining({notificationStatus:"PENDING",passageId:"stored-passage"})});
    expect(db.attentionAnalysisJob.create).toHaveBeenCalledOnce();
    expect(db.passage.create.mock.calls[0][0].data.direction).toBe("INCOMING");
    expect(db.passage.update.mock.calls.every(([input]:any[])=>input.data.direction===undefined)).toBe(true);
    expect(db.passage.create.mock.calls[0][0].data.timestamp).toEqual(new Date("2026-10-16T08:00:00.000Z"));
    expect(db.passage.update).not.toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({timestamp:expect.any(Date)})}));
    const eventKeys=db.passage.findFirst.mock.calls.map(([args]: [{where:{sourceEventId:string}}])=>args.where.sourceEventId);
    expect(new Set(eventKeys).size).toBe(1);
  });
  it.each([ITSAPI_HEARTBEAT_PATH,ITSAPI_ANPR_PATH])("weigert onbekende Device ID op %s",async path=>{
    const passage=fixture();passage.Picture.SnapInfo.DeviceID="other";
    const result=await upload(path,path===ITSAPI_ANPR_PATH?passage:{Active:"keepAlive",DeviceID:"other"});
    expect(result.statusCode).toBe(403);expect(result.json().error).toBe("DEVICE_ID_MISMATCH");
    expect(db.passage.create).not.toHaveBeenCalled();expect(db.camera.update).not.toHaveBeenCalled();expect(storage.storePassageImage).not.toHaveBeenCalled();
  });
  it("weigert ongeldige Digest-auth",async()=>{
    expect((await upload(ITSAPI_ANPR_PATH,fixture(),"wrong")).statusCode).toBe(401);
    expect(db.passage.create).not.toHaveBeenCalled();expect(db.itsapiInbox.upsert).not.toHaveBeenCalled();
  });
  it("verwerkt zonder optionele velden of afbeeldingen",async()=>{
    const response=await upload(ITSAPI_ANPR_PATH,{Picture:{Plate:{PlateNumber:"TEST123"},SnapInfo:{DeviceID:device,SnapTime:"2026-10-02 13:24:56"}}});
    expect(response.statusCode).toBe(200);expect(db.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({vehicleType:"UNKNOWN",vehicleColor:"UNKNOWN",direction:"UNKNOWN",location:"Configured location",plateConfidence:undefined})});
  });
  it("bevestigt een volledig opgeslagen retry ook als de beeldopslag daarna faalt",async()=>{
    expect((await upload(ITSAPI_ANPR_PATH,fixture())).statusCode).toBe(200);
    storage.storePassageImage.mockRejectedValue(new Error("disk offline"));
    expect((await upload(ITSAPI_ANPR_PATH,fixture())).statusCode).toBe(200);
    expect(storage.storePassageImage).toHaveBeenCalledOnce();expect(db.passage.create).toHaveBeenCalledOnce();
  });
  it("wijst configuratiewijziging tijdens passageverwerking af",async()=>{
    db.camera.updateMany.mockResolvedValue({count:0});
    expect((await upload(ITSAPI_ANPR_PATH,fixture())).statusCode).toBe(403);
    expect(db.passage.create).not.toHaveBeenCalled();expect(storage.delete).toHaveBeenCalled();
  });
  it("geeft geen ACK bij mislukte beeldopslag",async()=>{
    storage.storePassageImage.mockRejectedValue(new Error("disk full"));
    expect((await upload(ITSAPI_ANPR_PATH,fixture())).statusCode).toBe(503);expect(db.passage.create).not.toHaveBeenCalled();
  });
  it("geeft geen ACK bij mislukte databasecommit",async()=>{
    db.$transaction.mockRejectedValue(new Error("commit failed"));
    expect((await upload(ITSAPI_ANPR_PATH,fixture())).statusCode).toBe(503);expect(storage.delete).toHaveBeenCalled();
  });
  it("bewaart bij onbekende structuur alleen diagnose",async()=>{
    const response=await upload(ITSAPI_ANPR_PATH,{Unexpected:{password:"private",Plate:"private",Content:"private"}});
    expect(response.statusCode).toBe(422);expect(response.json().missing).toEqual(["Picture"]);
    expect(JSON.stringify(db.itsapiInbox.upsert.mock.calls)).not.toContain("private");expect(db.passage.create).not.toHaveBeenCalled();
  });
  it("verwerkt geen conceptcamera als echte passage",async()=>{
    (await db.itsapiRegistration.findUnique()).camera.isDraft=true;
    expect((await upload(ITSAPI_ANPR_PATH,fixture())).statusCode).toBe(422);expect(db.passage.create).not.toHaveBeenCalled();
  });
  it("weigert ongeldige of ontbrekende tijd zonder ontvangsttijd-fallback",async()=>{
    const body=fixture();body.Picture.SnapInfo.AccurateTime="invalid";
    expect((await upload(ITSAPI_ANPR_PATH,body)).statusCode).toBe(422);expect(db.passage.create).not.toHaveBeenCalled();
  });
  it("weigert URL-afbeeldingen en ongeldige base64",async()=>{
    const body=fixture();body.Picture.NormalPic.Content="https://internal/private";
    expect((await upload(ITSAPI_ANPR_PATH,body)).statusCode).toBe(422);expect(storage.storePassageImage).not.toHaveBeenCalled();
  });
});


describe("ITSAPI direction contracts (production direction observations in synthetic envelopes)",()=>{
  it.each([
    // Exact tokens and path reported from production tcpdump, 2026-10-20.
    // Envelope, plate, identity, times and JPEG remain synthetic contract data.
    ["Obverse","INCOMING"],["Reverse","OUTGOING"],[" obverse ","INCOMING"],[" REVERSE ","OUTGOING"],
    ["Approach","INCOMING"],["Leave","OUTGOING"],["Incoming","INCOMING"],["Outgoing","OUTGOING"],["Unknown","UNKNOWN"],
    [0,"UNKNOWN"],[1,"UNKNOWN"],[2,"UNKNOWN"],["0","UNKNOWN"],
    ["Approaching","UNKNOWN"],["Leaving","UNKNOWN"],["FutureFirmware","UNKNOWN"],[undefined,"UNKNOWN"]
  ])("stores %s as %s without guessing firmware enums",async(value,expected)=>{
    const body=fixture();Object.assign(body.Picture.SnapInfo,{Direction:value});
    db.plateGroupMember.findMany.mockResolvedValue([{groupId:"group",reason:"Test",group:{id:"group",name:"Test"}}]);
    expect((await upload(ITSAPI_ANPR_PATH,body)).statusCode).toBe(200);
    expect(db.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({direction:expected,timestamp:new Date("2026-10-16T08:00:00Z")})});
    expect(db.hit.create).toHaveBeenCalledOnce();expect(db.attentionAnalysisJob.create).toHaveBeenCalledOnce();
    const stored=db.passage.create.mock.calls[0][0].data;
    const hit={id:"hit",...db.hit.create.mock.calls[0][0].data,passage:stored,camera:{name:"Fixture"}};
    expect(publicHit(hit).passage.direction).toBe(expected);
    const push=JSON.parse(payloadFor(hit));
    if(expected==="UNKNOWN")expect(push.body).not.toMatch(/Inkomend|Uitgaand/);
    else expect(push.body).toContain(expected==="INCOMING"?"Inkomend":"Uitgaand");
    if(value!==undefined)expect(db.passage.create.mock.calls[0][0].data.rawEventMetadata.rawDirection).toBe(typeof value==="string"?value.trim():value);
  });
  it.each([["Obverse","OUTGOING"],["Reverse","INCOMING"],["Unknown","UNKNOWN"],[undefined,"UNKNOWN"],["FutureFirmware","UNKNOWN"]])("reverses %s safely for this camera only",async(value,expected)=>{
    (await db.itsapiRegistration.findUnique()).camera.directionMapping="AWAY_FROM_CAMERA_IS_INCOMING";
    const body=fixture();Object.assign(body.Picture.SnapInfo,{Direction:value});
    expect((await upload(ITSAPI_ANPR_PATH,body)).statusCode).toBe(200);
    expect(db.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({direction:expected,rawEventMetadata:expect.objectContaining({directionMapping:"AWAY_FROM_CAMERA_IS_INCOMING"})})});
  });
  it("stores two camera mappings independently and keeps the earlier passage unchanged",async()=>{
    const original=await db.itsapiRegistration.findUnique();
    const registrations=[original,{...original,cameraId:"camera-b",camera:{...original.camera,id:"camera-b",directionMapping:"AWAY_FROM_CAMERA_IS_INCOMING"}}];
    let selected=registrations[0];
    db.itsapiRegistration.findUnique.mockImplementation(async()=>selected);
    db.itsapiRegistration.findMany.mockImplementation(async()=>[selected]);
    db.camera.findFirst.mockImplementation(async()=>selected.camera);
    db.passage.findFirst.mockResolvedValue(null);
    for(const registration of registrations){
      selected=registration;
      const body=fixture();body.Picture.SnapInfo.Direction="Obverse";
      expect((await upload(ITSAPI_ANPR_PATH,body)).statusCode).toBe(200);
    }
    const records=db.passage.create.mock.calls.map(([input]:any[])=>input.data);
    expect(records.map((record:any)=>[record.cameraId,record.direction])).toEqual([["fixture-camera","INCOMING"],["camera-b","OUTGOING"]]);
    expect(db.passage.update.mock.calls.every(([input]:any[])=>input.data.direction===undefined)).toBe(true);
  });
  it("respects the reversed physical camera mapping",async()=>{
    (await db.itsapiRegistration.findUnique()).camera.directionMapping="AWAY_FROM_CAMERA_IS_INCOMING";
    expect((await upload(ITSAPI_ANPR_PATH,fixture())).statusCode).toBe(200);
    expect(db.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({direction:"OUTGOING"})});
  });
  it("logs direction-only TollgateInfo evidence during the existing temporary debug window",async()=>{
    (await db.itsapiRegistration.findUnique()).debugUntil=new Date("2026-10-16T08:15:00Z");
    const log=vi.spyOn(app.log,"info"),body=fixture();
    Object.assign(body.Picture.SnapInfo,{DrivingDirection:["Approach","PRIVATE_ROAD","PRIVATE_ROAD"],CaptureDirection:"Approaching",Password:"PRIVATE_PASSWORD"});
    expect((await upload(ITSAPI_ANPR_PATH,body)).statusCode).toBe(200);
    const diagnostics=log.mock.calls.filter(([entry])=>typeof entry==="object" && entry!==null && "event" in entry && entry.event==="itsapi_direction_diagnostic");
    expect(diagnostics).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).toContain("Picture.SnapInfo.DrivingDirection[0]");
    expect(JSON.stringify(diagnostics)).not.toMatch(/PRIVATE|TEST123|synthetic-device|Content|PlateNumber|Password/);
  });
  it("does not log direction values after the debug window expires",async()=>{
    (await db.itsapiRegistration.findUnique()).debugUntil=new Date("2026-10-16T07:59:00Z");
    const log=vi.spyOn(app.log,"info");await upload(ITSAPI_ANPR_PATH,fixture());
    expect(log.mock.calls.some(([entry])=>typeof entry==="object" && entry!==null && "event" in entry && entry.event==="itsapi_direction_diagnostic")).toBe(false);
  });
});
