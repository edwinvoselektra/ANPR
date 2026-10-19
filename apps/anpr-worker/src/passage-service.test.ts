import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassageService } from "./passage-service.js";
import { calculatePassageExpiry, formatLocalDate } from "@anpr/shared";
import type { NormalizedAnprEvent } from "./types.js";

const prisma:any={passage:{findFirst:vi.fn(),create:vi.fn(),update:vi.fn()},camera:{findFirst:vi.fn(),update:vi.fn(),updateMany:vi.fn()},plateGroupMember:{findMany:vi.fn()},hit:{create:vi.fn()},attentionAnalysisJob:{create:vi.fn()},$transaction:vi.fn()};
const storage={storePassageImage:vi.fn(),delete:vi.fn()};const logger={info:vi.fn(),warn:vi.fn(),error:vi.fn()};
const event:NormalizedAnprEvent={cameraId:"11111111-1111-4111-8111-111111111111",occurredAt:new Date("2026-09-02T12:00:00Z"),originalPlate:"12-ABC-3",normalizedPlate:"12ABC3",source:"DAHUA_CAMERA",sourceEventId:"TEST-1"};
beforeEach(()=>{vi.clearAllMocks();prisma.camera.updateMany.mockResolvedValue({count:1});prisma.passage.findFirst.mockResolvedValue(null);prisma.camera.findFirst.mockResolvedValue({id:event.cameraId,location:"TEST",direction:"INCOMING"});prisma.passage.create.mockResolvedValue({id:"22222222-2222-4222-8222-222222222222"});prisma.plateGroupMember.findMany.mockResolvedValue([]);prisma.$transaction.mockImplementation((fn:any)=>fn({passage:prisma.passage,camera:prisma.camera,plateGroupMember:prisma.plateGroupMember,hit:prisma.hit,attentionAnalysisJob:prisma.attentionAnalysisJob}));});
describe("PassageService",()=>{
  it("maakt een echte passage en werkt de camera bij",async()=>{const result=await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store(event);expect(result.status).toBe("stored");expect(prisma.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({source:"DAHUA_CAMERA",sourceEventId:"TEST-1",normalizedLicensePlate:"12ABC3",cameraId:event.cameraId})});expect(prisma.camera.update).toHaveBeenCalled();});
  it("maakt de analysetaak atomair in dezelfde transactie",async()=>{await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store(event);expect(prisma.attentionAnalysisJob.create).toHaveBeenCalledWith({data:{passageId:"22222222-2222-4222-8222-222222222222"}})});
  it("weigert een herhaald sourceEventId vóór foto-opslag en maakt geen dubbele hit",async()=>{prisma.passage.findFirst.mockResolvedValue({id:"existing"});const result=await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store(event);expect(result).toEqual({status:"duplicate"});expect(storage.storePassageImage).not.toHaveBeenCalled();expect(prisma.passage.create).not.toHaveBeenCalled();expect(prisma.hit.create).not.toHaveBeenCalled();});
  it("gebruikt exacte tijd en gebeurtenisidentiteit als fallback",async()=>{await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store({...event,sourceEventId:undefined});expect(prisma.passage.findFirst).toHaveBeenCalledWith({where:expect.objectContaining({cameraId:event.cameraId,sourceEventId:expect.stringMatching(/^fallback:/)}),select:{id:true}});});
  it("maakt precies één hit met alle actieve gematchte groepen en zet de centrale pushjob klaar",async()=>{prisma.plateGroupMember.findMany.mockResolvedValue([{groupId:"33333333-3333-4333-8333-333333333333",reason:"TEST reden",group:{id:"33333333-3333-4333-8333-333333333333",name:"Aandacht"}},{groupId:"44444444-4444-4444-8444-444444444444",reason:"Tweede reden",group:{id:"44444444-4444-4444-8444-444444444444",name:"Prio"}}]);prisma.hit.create.mockResolvedValue({id:"55555555-5555-4555-8555-555555555555"});await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store(event);expect(prisma.hit.create).toHaveBeenCalledTimes(1);expect(prisma.hit.create).toHaveBeenCalledWith({data:expect.objectContaining({passageId:"22222222-2222-4222-8222-222222222222",notificationStatus:"PENDING",groups:{create:[{groupId:"33333333-3333-4333-8333-333333333333",reason:"TEST reden"},{groupId:"44444444-4444-4444-8444-444444444444",reason:"Tweede reden"}]}})});});
});

it("stores UNKNOWN when a real camera event has no direction instead of using camera configuration",async()=>{
  await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store(event);
  expect(prisma.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({direction:"UNKNOWN"})});
});

it("preserves plate data when an event image cannot be stored", async () => {
  storage.storePassageImage.mockRejectedValue(new Error("DISK_FULL"));
  const result = await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store({...event,overviewImage:{contentType:"image/jpeg",data:Buffer.from([255,216,255,217])}});
  expect(result.status).toBe("stored");
  expect(logger.warn).toHaveBeenCalled();
});
it("stores identical image bytes only once per event", async () => {
  storage.storePassageImage.mockResolvedValue("passages/test.jpg");
  const image = {contentType:"image/jpeg" as const,data:Buffer.from([255,216,255,217])};
  await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store({...event,overviewImage:image,plateImage:image,extraImage:image});
  expect(storage.storePassageImage).toHaveBeenCalledTimes(1);
});
it("does not store an event after camera archival wins the transaction lock", async () => {
  prisma.camera.updateMany.mockResolvedValue({count:0});
  await expect(new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store(event)).rejects.toThrow("CAMERA_NOT_ACTIVE");
  expect(prisma.passage.create).not.toHaveBeenCalled();
});

afterEach(()=>vi.useRealTimers());

describe("server receipt time",()=>{
  it("uses service ingress time rather than a wrong camera clock when no ingress was supplied",async()=>{
    const receipt=new Date("2026-10-16T08:00:00Z");
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(receipt);
    await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store(event);
    expect(prisma.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({timestamp:receipt,expiresAt:calculatePassageExpiry(receipt)})});
  });
  it("uses the same receipt time for images, retention, hits and camera status despite processing delay",async()=>{
    const receipt=new Date("2026-10-16T08:00:00Z");
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-16T08:03:00Z"));
    storage.storePassageImage.mockResolvedValue("passages/receipt.jpg");
    prisma.plateGroupMember.findMany.mockResolvedValue([{groupId:"group",group:{id:"group",name:"Test"}}]);
    prisma.hit.create.mockResolvedValue({id:"hit"});
    await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store({...event,receivedAt:receipt,overviewImage:{contentType:"image/jpeg",data:Buffer.from([255,216,255,217])}});
    expect(prisma.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({timestamp:receipt,expiresAt:calculatePassageExpiry(receipt),rawEventMetadata:expect.objectContaining({receivedAt:receipt.toISOString(),cameraReportedAt:event.occurredAt.toISOString(),timeSource:"SERVER_RECEIPT"})})});
    expect(storage.storePassageImage).toHaveBeenCalledWith(expect.anything(),receipt);
    expect(prisma.hit.create).toHaveBeenCalledWith({data:expect.objectContaining({timestamp:receipt})});
    expect(prisma.plateGroupMember.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({AND:[{OR:[{validFrom:null},{validFrom:{lte:receipt}}]},{OR:[{validUntil:null},{validUntil:{gte:receipt}}]}]})}));
    expect(prisma.camera.update).toHaveBeenCalledWith({where:{id:event.cameraId},data:expect.objectContaining({lastVehicleRegistrationAt:receipt,lastAnprEventAt:receipt})});
  });
  it("orders three cameras by receipt despite different camera clocks",async()=>{
    const service=new PassageService({prisma,storage,dedupeWindowMs:3000,logger});
    const clocks=["2099-01-01T00:00:00Z","2000-01-01T00:00:00Z","2026-10-16T20:00:00Z"];
    const zones=["Europe/Amsterdam","America/New_York","Asia/Tokyo"];
    for(let i=0;i<clocks.length;i++) {
      const cameraId=`camera-${i}`;
      prisma.camera.findFirst.mockResolvedValue({id:cameraId,location:"Test",vpnLocation:{timezone:zones[i]}});
      await service.store({...event,rawMetadata:{provider:"DAHUA_ITSAPI",timeSource:"AccurateTime"},cameraId,occurredAt:new Date(clocks[i]!),receivedAt:new Date(`2026-10-16T08:00:0${i}Z`)});
    }
    expect(prisma.passage.create.mock.calls.map(([args]: [{data:{timestamp:Date}}])=>args.data.timestamp.toISOString())).toEqual(["2026-10-16T08:00:00.000Z","2026-10-16T08:00:01.000Z","2026-10-16T08:00:02.000Z"]);
    const saved: Array<{timestamp:Date;timezone:string}> = prisma.passage.create.mock.calls.map(([args]: [{data:{timestamp:Date;timezone:string}}])=>args.data);
    expect(saved.map(item=>item.timezone)).toEqual(zones);
    expect(saved.map(item=>formatLocalDate(item.timestamp,item.timezone))).toEqual(["16-10-2026 10:00:00","16-10-2026 04:00:01","16-10-2026 17:00:02"]);
  });
});
