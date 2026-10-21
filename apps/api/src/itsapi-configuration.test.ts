import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const db = vi.hoisted(()=>({camera:{findUniqueOrThrow:vi.fn(),update:vi.fn()},itsapiRegistration:{upsert:vi.fn()},auditLog:{create:vi.fn()},$transaction:vi.fn()}));
vi.mock("./lib/prisma.js",()=>({prisma:db}));
vi.mock("./lib/auth.js", async importOriginal=>({...await importOriginal<typeof import("./lib/auth.js")>(),requireAdmin:()=>async()=>undefined,requirePermission:()=>async()=>undefined}));
import { buildServer } from "./server.js";
let app: ReturnType<typeof buildServer>;
const cameraId="11111111-1111-4111-8111-111111111111";
const body={receiverOrigin:"http://10.99.0.1:7070",addressConfirmed:true,expectedDeviceId:"synthetic-unique-device",protocolVersion:"V1.19",heartbeatSeconds:300,authenticationEnabled:false,expectedSourceIp:"10.99.0.11"};
beforeEach(()=>{
  vi.resetAllMocks();
  db.camera.findUniqueOrThrow.mockResolvedValue({id:cameraId,rtspHost:"10.20.10.201"});
  db.$transaction.mockImplementation(async fn=>fn(db));
  app=buildServer();
});
afterEach(async()=>{await app.close()});
it("slaat expliciete peer op zonder RTSP-host te vervangen",async()=>{
  const response=await app.inject({method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:body});
  expect(response.statusCode).toBe(200);
  expect(db.itsapiRegistration.upsert).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({expectedSourceIp:"10.99.0.11",expectedDeviceId:body.expectedDeviceId}),update:expect.objectContaining({expectedSourceIp:"10.99.0.11"})}));
  expect(db.camera.update).toHaveBeenCalledWith({where:{id:cameraId,archivedAt:null},data:{configVersion:{increment:1}}});
});
it.each(["10.99.0.0/24","router.invalid","10.99.0.999"])("weigert ongeldige bron %s voordat configuratie wijzigt",async expectedSourceIp=>{
  expect((await app.inject({method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:{...body,expectedSourceIp}})).statusCode).toBe(400);
  expect(db.$transaction).not.toHaveBeenCalled();
});
it("geeft veilige 409 voor databaseconflict op Device ID",async()=>{
  db.itsapiRegistration.upsert.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("private database detail",{code:"P2002",clientVersion:"6.12.0",meta:{target:["expectedDeviceId"]}}));
  const response=await app.inject({method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:body});
  expect(response.statusCode).toBe(409);
  expect(response.body).toContain("Deze Device ID is al aan een camera gekoppeld.");
  expect(response.body).not.toContain("private database detail");
  expect(db.auditLog.create).not.toHaveBeenCalled();
});
it("wist expliciete peer zodat directe bronvalidatie weer geldt",async()=>{
  expect((await app.inject({method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:{...body,expectedSourceIp:""}})).statusCode).toBe(200);
  expect(db.itsapiRegistration.upsert).toHaveBeenCalledWith(expect.objectContaining({update:expect.objectContaining({expectedSourceIp:null})}));
});

it("behoudt peerconfiguratie als een oudere client het veld niet meestuurt",async()=>{
  const {expectedSourceIp,...legacyBody}=body;void expectedSourceIp;
  expect((await app.inject({method:"PUT",url:`/cameras/${cameraId}/itsapi`,payload:legacyBody})).statusCode).toBe(200);
  expect(db.itsapiRegistration.upsert).toHaveBeenCalledWith(expect.objectContaining({update:expect.objectContaining({expectedSourceIp:undefined})}));
});
