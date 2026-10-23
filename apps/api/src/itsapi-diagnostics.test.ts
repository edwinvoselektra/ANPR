import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db=vi.hoisted(()=>({
  camera:{findUniqueOrThrow:vi.fn(),update:vi.fn(),deleteMany:vi.fn()},
  itsapiRegistration:{findUnique:vi.fn(),update:vi.fn()},itsapiInbox:{findMany:vi.fn()},
  userSession:{findUnique:vi.fn(),update:vi.fn()},auditLog:{create:vi.fn()},
}));
vi.mock("./lib/prisma.js",()=>({prisma:db}));
import { buildServer } from "./server.js";
import { safeItsapiEvidence } from "./lib/itsapi-diagnostics.js";
const id="11111111-1111-4111-8111-111111111111",now=new Date("2026-10-23T12:00:00Z");
let app:ReturnType<typeof buildServer>;
beforeEach(()=>{
  vi.resetAllMocks();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
  db.userSession.findUnique.mockResolvedValue({id:"session",revokedAt:null,lastSeenAt:now,expiresAt:new Date("2099-01-01"),user:{id:"admin",active:true,roles:[{role:{name:"ADMIN",permissions:[]}}]}});
  db.camera.findUniqueOrThrow.mockResolvedValue({id,name:"Staverhul",configVersion:3,anprProvider:"DAHUA_ITSAPI"});
  db.itsapiRegistration.findUnique.mockResolvedValue({cameraId:id,evidenceVersion:3,expectedDeviceId:"PRIVATE_DEVICE",passwordEncrypted:"PRIVATE_CREDENTIAL",debugUntil:new Date(now.getTime()+900_000),lastRequestAt:now});
  db.userSession.update.mockResolvedValue({});
  db.itsapiInbox.findMany.mockResolvedValue([{id:"inbox",kind:"ANPR_UNVERIFIED",receivedAt:now,lastReceivedAt:now,expiresAt:new Date(now.getTime()+86_400_000),attempts:174145,evidence:{errorCode:"UNSUPPORTED_TOLLGATE_PAYLOAD",httpStatus:422,structureCapturedAt:now.toISOString(),shape:{Picture:{Plate:{PlateNumber:"string",IsExist:"null"},SnapInfo:{DeviceID:"string"}}},violations:[{path:"Picture.Plate.IsExist",reason:"invalid_type",expected:"boolean",received:"null"}],deviceIdentityVerified:true}}]);
  app=buildServer();app.log.level="silent";
});
afterEach(async()=>{await app.close();vi.useRealTimers()});
const headers={cookie:"anpr_session=synthetic"};
describe("administratieve ITSAPI-structuurdiagnose zonder nieuwe databasetabellen",()=>{
  it("geeft exacte veldfouten en actuele capturestatus zonder camera-identiteit of credentials",async()=>{
    const r=await app.inject({url:`/cameras/${id}/itsapi/diagnostic`,headers});expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({camera:{name:"Staverhul"},capture:{active:true,until:"2026-10-23T12:15:00.000Z"},messages:[{httpStatus:422,errorCode:"UNSUPPORTED_TOLLGATE_PAYLOAD",attempts:174145,violations:[{path:"Picture.Plate.IsExist",expected:"boolean",received:"null",reason:"invalid_type"}]}]});
    expect(r.body).not.toMatch(/PRIVATE_DEVICE|PRIVATE_CREDENTIAL|passwordEncrypted|expectedDeviceId/);
    expect(r.headers["cache-control"]).toContain("no-store");
    expect(db.itsapiInbox.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{cameraId:id,configVersion:3,expiresAt:{gt:now}},orderBy:{lastReceivedAt:"desc"},take:5}));
    expect(db.camera.update).not.toHaveBeenCalled();
  });
  it("toont na 15 minuten automatisch uitgeschakeld",async()=>{
    vi.setSystemTime(new Date(now.getTime()+900_001));
    expect((await app.inject({url:`/cameras/${id}/itsapi/diagnostic`,headers})).json().capture.active).toBe(false);
  });
  it("kan vanuit de interface inschakelen en stoppen zonder instellingen te wijzigen",async()=>{
    const start=await app.inject({method:"POST",url:`/cameras/${id}/itsapi/debug`,headers,payload:{enabled:true}});
    expect(start.statusCode).toBe(200);expect(start.json()).toMatchObject({active:true,until:"2026-10-23T12:15:00.000Z"});
    expect(db.itsapiRegistration.update).toHaveBeenLastCalledWith({where:{cameraId:id},data:{debugUntil:new Date("2026-10-23T12:15:00Z")}});
    const stop=await app.inject({method:"POST",url:`/cameras/${id}/itsapi/debug`,headers,payload:{enabled:false}});
    expect(stop.statusCode).toBe(200);expect(stop.json().active).toBe(false);
    expect(db.itsapiRegistration.update).toHaveBeenLastCalledWith({where:{cameraId:id},data:{debugUntil:null}});
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({action:"ITSAPI_SHAPE_DEBUG_DISABLED"})}));
    expect(db.camera.update).not.toHaveBeenCalled();expect(db.camera.deleteMany).not.toHaveBeenCalled();
  });
  it.each(["GET","POST"] as const)("weigert operators voor %s",async method=>{
    const session=await db.userSession.findUnique();session.user.roles=[{role:{name:"OPERATOR",permissions:[{permission:{key:"cameras.view"}}]}}];
    expect((await app.inject({method,url:`/cameras/${id}/itsapi/${method==="GET"?"diagnostic":"debug"}`,headers,...(method==="POST"?{payload:{enabled:true}}:{})})).statusCode).toBe(403);
    expect(db.itsapiRegistration.update).not.toHaveBeenCalled();expect(db.itsapiInbox.findMany).not.toHaveBeenCalled();
  });
  it("weigert anonieme diagnose, vreemde origin en onverwachte mutatievelden",async()=>{
    expect((await app.inject({url:`/cameras/${id}/itsapi/diagnostic`})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url:`/cameras/${id}/itsapi/debug`,headers:{...headers,origin:"https://other.invalid"},payload:{enabled:true}})).statusCode).toBe(403);
    expect((await app.inject({method:"POST",url:`/cameras/${id}/itsapi/debug`,headers,payload:{enabled:true,expectedDeviceId:"replace"}})).statusCode).toBe(400);
    expect(db.itsapiRegistration.update).not.toHaveBeenCalled();
  });
  it("herpubliceert geen vervuilde oude evidence of algemene missinglijst",()=>{
    const safe=safeItsapiEvidence({errorCode:"PRIVATE_PLATE",missing:["PRIVATE_DEVICE"],shape:{Picture:{PlateNumber:"PRIVATE_PLATE",DeviceID:"PRIVATE_DEVICE",Content:"PRIVATE_IMAGE",Password:"PRIVATE_PASSWORD"},PRIVATE_TOKEN:"string"},violations:[{path:"Picture.Plate.IsExist",reason:"invalid_literal",expected:"boolean",received:"PRIVATE_TOKEN"},{path:"PRIVATE_DEVICE",reason:"invalid_type",expected:"string",received:"string"}],token:"PRIVATE_TOKEN"});
    expect(safe.violations).toEqual([]);expect(safe.errorCode).toBe("UNKNOWN_DIAGNOSTIC_ERROR");
    expect(JSON.stringify(safe)).not.toMatch(/PRIVATE|missing|Password|token/);
  });
});
