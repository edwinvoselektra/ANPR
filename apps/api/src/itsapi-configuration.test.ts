import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const db = vi.hoisted(()=>({camera:{findUniqueOrThrow:vi.fn(),update:vi.fn()},itsapiRegistration:{upsert:vi.fn(),findUnique:vi.fn()},auditLog:{create:vi.fn()},userSession:{findUnique:vi.fn(),update:vi.fn()},$transaction:vi.fn()}));
vi.mock("./lib/prisma.js",()=>({prisma:db}));
import { buildServer } from "./server.js";
let app: ReturnType<typeof buildServer>;
const cameraId="11111111-1111-4111-8111-111111111111";
const body={receiverOrigin:"http://10.99.0.1:7070",addressConfirmed:true,expectedDeviceId:"synthetic-unique-device",protocolVersion:"V1.19",heartbeatSeconds:300,authenticationEnabled:false,expectedSourceIp:"10.99.0.11"};
beforeEach(()=>{
  vi.resetAllMocks();
  db.userSession.findUnique.mockResolvedValue({id:"session",expiresAt:new Date("2099-01-01"),lastSeenAt:new Date(),revokedAt:null,user:{id:"admin",active:true,roles:[{role:{name:"ADMIN",permissions:[]}}]}});
  db.camera.findUniqueOrThrow.mockResolvedValue({id:cameraId,rtspHost:"10.20.10.201"});
  db.$transaction.mockImplementation(async fn=>fn(db));
  app=buildServer();
});
afterEach(async()=>{await app.close()});
it("slaat expliciete peer op zonder RTSP-host te vervangen",async()=>{
  const response=await app.inject({headers:{cookie:"anpr_session=synthetic"},method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:body});
  expect(response.statusCode).toBe(200);
  expect(db.itsapiRegistration.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({expectedSourceIp:"10.99.0.11",expectedDeviceId:body.expectedDeviceId}),update:expect.objectContaining({expectedSourceIp:"10.99.0.11"})}));
  expect(db.camera.update).toHaveBeenCalledWith({where:{id:cameraId,archivedAt:null},data:{configVersion:{increment:1}}});
});
it.each(["10.99.0.0/24","router.invalid","10.99.0.999","::1","::ffff:10.99.0.11","1.2.3","01.2.3.4"])("weigert ongeldige bron %s voordat configuratie wijzigt",async expectedSourceIp=>{
  expect((await app.inject({headers:{cookie:"anpr_session=synthetic"},method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:{...body,expectedSourceIp}})).statusCode).toBe(400);
  expect(db.$transaction).not.toHaveBeenCalled();
});
it("geeft veilige 409 voor databaseconflict op Device ID",async()=>{
  db.itsapiRegistration.upsert.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("private database detail",{code:"P2002",clientVersion:"6.12.0",meta:{target:["expectedDeviceId"]}}));
  const response=await app.inject({headers:{cookie:"anpr_session=synthetic"},method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:body});
  expect(response.statusCode).toBe(409);
  expect(response.body).toContain("Deze Device ID is al aan een camera gekoppeld.");
  expect(response.body).not.toContain("private database detail");
  expect(db.auditLog.create).not.toHaveBeenCalled();
});
it("wist expliciete peer zodat directe bronvalidatie weer geldt",async()=>{
  expect((await app.inject({headers:{cookie:"anpr_session=synthetic"},method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:{...body,expectedSourceIp:""}})).statusCode).toBe(200);
  expect(db.itsapiRegistration.upsert).toHaveBeenCalledWith(expect.objectContaining({update:expect.objectContaining({expectedSourceIp:null})}));
});

it("behoudt peerconfiguratie als een oudere client het veld niet meestuurt",async()=>{
  const {expectedSourceIp,...legacyBody}=body;void expectedSourceIp;
  expect((await app.inject({headers:{cookie:"anpr_session=synthetic"},method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:legacyBody})).statusCode).toBe(200);
  expect(db.itsapiRegistration.upsert).toHaveBeenCalledWith(expect.objectContaining({update:expect.objectContaining({expectedSourceIp:undefined})}));
});

it.each(["GET","PUT"] as const)("weigert operator op %s met echte admin-middleware",async method=>{
  const session=await db.userSession.findUnique();
  session.user.roles=[{role:{name:"OPERATOR",permissions:[{permission:{key:"cameras.manage"}}]}}];
  const response=await app.inject({method,url:`/cameras/${cameraId}/itsapi`,headers:{cookie:"anpr_session=synthetic"},...(method==="PUT"?{payload:body}:{})});
  expect(response.statusCode).toBe(403);
  expect(response.json().error).toBe("ADMIN_REQUIRED");
  expect(db.$transaction).not.toHaveBeenCalled();
});
it("weigert niet-ingelogde wijziging",async()=>{
  expect((await app.inject({method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:body})).statusCode).toBe(401);
  expect(db.$transaction).not.toHaveBeenCalled();
});

it("leest opgeslagen bron terug zonder uploadwachtwoord te publiceren",async()=>{
  db.itsapiRegistration.findUnique.mockResolvedValue({...body,cameraId,passwordEncrypted:"encrypted-private-value"});
  const response=await app.inject({headers:{cookie:"anpr_session=synthetic"},method:"GET",url:`/cameras/${cameraId}/itsapi`});
  expect(response.statusCode).toBe(200);
  expect(response.json().registration.expectedSourceIp).toBe("10.99.0.11");
  expect(response.body).not.toContain("encrypted-private-value");
  expect(response.headers["cache-control"]).toContain("no-store");
});
