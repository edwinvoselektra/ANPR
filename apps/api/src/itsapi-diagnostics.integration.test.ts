import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";
import { buildItsapiReceiver } from "./itsapi-receiver.js";
import { prisma } from "./lib/prisma.js";
import { cleanupCameraDrafts } from "./routes/camera-onboarding.js";
import { assertDiagnosticTestDatabase,createDiagnosticFixture,preservationSnapshot,syntheticPayload,syntheticSource } from "../../../scripts/itsapi-diagnostics-fixture.mjs";
const suite=process.env.ITSAPI_DIAGNOSTICS_INTEGRATION==="1"?describe:describe.skip;
suite("tijdelijke cameradiagnose met echte PostgreSQL en behoud van gegevens",()=>{
  let api:ReturnType<typeof buildServer>,receiver:ReturnType<typeof buildItsapiReceiver>,fixture:Awaited<ReturnType<typeof createDiagnosticFixture>>;
  const admin={cookie:"anpr_session=diagnostics-admin"},operator={cookie:"anpr_session=diagnostics-operator"};
  beforeAll(async()=>{assertDiagnosticTestDatabase();await prisma.$connect()});
  beforeEach(async()=>{fixture=await createDiagnosticFixture(prisma);api=buildServer();api.log.level="silent";receiver=buildItsapiReceiver(prisma,fixture.storage);receiver.log.level="silent"});
  afterEach(async()=>{await api.close();await receiver.close()});
  afterAll(async()=>{await prisma.$disconnect()});
  const path=()=>`/cameras/${fixture.cameraId}/itsapi`;
  const reject=()=>receiver.inject({method:"POST",url:"/NotificationInfo/TollgateInfo",remoteAddress:syntheticSource,payload:syntheticPayload()});
  const report=async()=>{const r=await api.inject({url:`${path()}/diagnostic`,headers:admin});expect(r.statusCode).toBe(200);return r.json()};
  it("behoudt camera’s, passages, gebruikers, voorkeuren en afbeeldingsbytes bij starten, capture, stoppen en retentie",async()=>{
    const before=await preservationSnapshot(prisma,fixture.otherCameraId,fixture.objectId);
    expect((await api.inject({method:"POST",url:`${path()}/debug`,headers:admin,payload:{enabled:true}})).statusCode).toBe(200);
    expect((await reject()).statusCode).toBe(422);
    const capture=await report();expect(capture.messages[0]).toMatchObject({httpStatus:422,errorCode:"UNSUPPORTED_TOLLGATE_PAYLOAD",violations:[{path:"Picture.Plate.IsExist",expected:"boolean",received:"null",reason:"invalid_type"}]});
    expect(JSON.stringify(capture)).not.toMatch(/PRIVATE123|SYNTHETIC_PRIVATE_DEVICE|ENCRYPTED_CREDENTIAL|PUSH_KEY|PUSH_AUTH/);
    await api.inject({method:"POST",url:`${path()}/debug`,headers:admin,payload:{enabled:false}});
    await prisma.itsapiInbox.updateMany({where:{cameraId:fixture.cameraId},data:{expiresAt:new Date(Date.now()-1000)}});
    await cleanupCameraDrafts();expect((await report()).messages).toEqual([]);
    expect(await preservationSnapshot(prisma,fixture.otherCameraId,fixture.objectId)).toEqual(before);
    const image=await api.inject({url:`/passages/${fixture.passageId}/image/overview`,headers:admin});expect(image.statusCode).toBe(200);
  });
  it("vernieuwt dezelfde inboxregel na starten, slaat na verlopen geen nieuwe structuur op en houdt 200/403/422 gescheiden",async()=>{
    await reject();const first=(await report()).messages[0];expect(first.shape).toBeNull();
    await api.inject({method:"POST",url:`${path()}/debug`,headers:admin,payload:{enabled:true}});
    await reject();const active=await report();expect(active.messages[0]).toMatchObject({id:first.id,attempts:2,shape:{Picture:{Plate:{IsExist:"null"}}}});expect(active.messages[0].capturedAt).toBeTruthy();
    await prisma.itsapiRegistration.update({where:{cameraId:fixture.cameraId},data:{debugUntil:new Date(Date.now()-1000)}});
    await reject();const expired=await report();expect(expired.capture.active).toBe(false);expect(expired.messages[0].shape).toEqual(active.messages[0].shape);expect(expired.messages[0].capturedAt).toBe(active.messages[0].capturedAt);expect(expired.messages[0].attempts).toBe(3);
    const different={...syntheticPayload(),OtherEventType:true};expect((await receiver.inject({method:"POST",url:"/NotificationInfo/TollgateInfo",remoteAddress:syntheticSource,payload:different})).statusCode).toBe(422);
    const after=(await report()).messages.find((m:{id:string})=>m.id!==first.id);expect(after.shape).toBeNull();expect(after.capturedAt).toBeNull();
    const wrong=await receiver.inject({method:"POST",url:"/NotificationInfo/TollgateInfo",remoteAddress:"192.0.2.99",payload:syntheticPayload()});expect(wrong.statusCode).toBe(403);
    const unknown=syntheticPayload();unknown.Picture.SnapInfo.DeviceID="UNKNOWN_DEVICE";expect((await receiver.inject({method:"POST",url:"/NotificationInfo/TollgateInfo",remoteAddress:syntheticSource,payload:unknown})).statusCode).toBe(403);
    const valid=syntheticPayload();Object.assign(valid.Picture.Plate,{IsExist:true});expect((await receiver.inject({method:"POST",url:"/NotificationInfo/TollgateInfo",remoteAddress:syntheticSource,payload:valid})).statusCode).toBe(200);
    expect(await prisma.passage.count()).toBe(2);
  });
  it("laat verlopen retry-aggregaten een nieuwe capture niet verbergen",async()=>{
    await reject();await prisma.itsapiInbox.updateMany({where:{cameraId:fixture.cameraId},data:{expiresAt:new Date(Date.now()-1000)}});
    await api.inject({method:"POST",url:`${path()}/debug`,headers:admin,payload:{enabled:true}});await reject();
    const current=await report();expect(current.messages).toHaveLength(1);expect(current.messages[0].attempts).toBe(1);expect(current.messages[0].capturedAt).toBeTruthy();
  });
  it("houdt structuur en bediening buiten operatoraccounts en ververst de bestaande diagnosepagina veilig",async()=>{
    expect((await api.inject({url:`${path()}/diagnostic`,headers:operator})).statusCode).toBe(403);
    expect((await api.inject({method:"POST",url:`${path()}/debug`,headers:operator,payload:{enabled:true}})).statusCode).toBe(403);
    await reject();
    const health=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response(JSON.stringify({service:"itsapi-receiver",listening:true}),{status:200}));
    try{
      const adminReport=await api.inject({url:`/cameras/${fixture.cameraId}/diagnostics`,headers:admin});
      expect(adminReport.statusCode).toBe(200);expect(adminReport.json().canManageStructureDiagnostics).toBe(true);expect(adminReport.json().inbox[0].evidence.violations[0].received).toBe("null");
      const operatorReport=await api.inject({url:`/cameras/${fixture.cameraId}/diagnostics`,headers:operator});expect(operatorReport.json().canManageStructureDiagnostics).toBe(false);expect(operatorReport.json().inbox).toEqual([]);
    }finally{health.mockRestore()}
  });
});
