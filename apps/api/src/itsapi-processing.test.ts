import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createDigestAuthorization } from "@anpr/shared/dahua";
import { buildItsapiReceiver } from "./itsapi-receiver.js";
import { encryptSecret } from "./lib/crypto.js";
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
  let passage: any = null;
  const camera={id:"fixture-camera",active:true,isDraft:false,archivedAt:null,configVersion:1,anprProvider:"DAHUA_ITSAPI",location:"Configured location",directionMapping:"TOWARD_CAMERA_IS_INCOMING",vpnLocation:{timezone:"Europe/Amsterdam"}};
  const registration={cameraId:camera.id,camera,expectedDeviceId:device,protocolVersion:"V1.19",username,passwordEncrypted:encryptSecret(password)};
  db={
    itsapiRegistration:{findUnique:vi.fn().mockResolvedValue(registration),updateMany:vi.fn().mockResolvedValue({count:1}),update:vi.fn()},
    itsapiDigestReplay:{updateMany:vi.fn().mockResolvedValue({count:1})},
    camera:{findFirst:vi.fn().mockResolvedValue(camera),updateMany:vi.fn().mockResolvedValue({count:1}),update:vi.fn()},
    passage:{findFirst:vi.fn().mockImplementation(async()=>passage),create:vi.fn().mockImplementation(async({data})=>{passage={id:"stored-passage",...data};return passage}),update:vi.fn()},
    plateGroupMember:{findMany:vi.fn().mockResolvedValue([])},hit:{create:vi.fn().mockResolvedValue({id:"hit"}),updateMany:vi.fn()},
    attentionAnalysisJob:{create:vi.fn()},
    itsapiInbox:{upsert:vi.fn(),findMany:vi.fn().mockResolvedValue([])},
    $transaction:vi.fn().mockImplementation(async fn=>fn(db)),
  };
  storage={storePassageImage:vi.fn().mockImplementation(async()=>`passages/${randomUUID()}.jpg`),delete:vi.fn()};
  app=buildItsapiReceiver(db as PrismaClient,storage);
});
afterEach(async()=>{await app.close()});
async function upload(path: string, payload: unknown, secret = password) {
  const challenge = await app.inject({method:"POST",url:path});
  const authorization = createDigestAuthorization({challenge:String(challenge.headers["www-authenticate"]),method:"POST",uri:path,username,password:secret});
  return app.inject({method:"POST",url:path,headers:{authorization},payload:payload as object});
}
describe("ITSAPI Picture-profiel verwerking",()=>{
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
    expect(db.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({normalizedLicensePlate:"TEST123",timestamp:new Date("2026-10-02T11:24:56.123Z"),vehicleType:"CAR",vehicleColor:"BLUE",direction:"INCOMING",location:"Testlocatie",plateConfidence:0.8,vehicleImage1ObjectId:expect.any(String),plateImageObjectId:expect.any(String),vehicleImage2ObjectId:expect.any(String)})});
    expect(db.attentionAnalysisJob.create).toHaveBeenCalledOnce();
    expect(storage.storePassageImage).toHaveBeenCalledOnce();
  });
  it("herkent retries ondanks gewijzigde uploadteller zonder dubbele passage/hit/pushjob",async()=>{
    db.plateGroupMember.findMany.mockResolvedValue([{groupId:"group",reason:"test",group:{id:"group",name:"Testlijst"}}]);
    expect((await upload(ITSAPI_ANPR_PATH,fixture())).statusCode).toBe(200);
    const retry=fixture();Object.assign(retry.Picture.Plate,{UploadNum:100});
    expect((await upload(ITSAPI_ANPR_PATH,retry)).statusCode).toBe(200);
    expect(db.passage.create).toHaveBeenCalledOnce();expect(db.hit.create).toHaveBeenCalledOnce();
    expect(db.hit.create).toHaveBeenCalledWith({data:expect.objectContaining({notificationStatus:"PENDING",passageId:"stored-passage"})});
    expect(db.attentionAnalysisJob.create).toHaveBeenCalledOnce();
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
    expect(response.statusCode).toBe(422);expect(response.json().missing).toContain("Picture.Plate.PlateNumber");
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
