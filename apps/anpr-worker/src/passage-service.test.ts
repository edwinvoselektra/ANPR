import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassageService } from "./passage-service.js";
import type { NormalizedAnprEvent } from "./types.js";

const prisma:any={passage:{findFirst:vi.fn(),create:vi.fn()},camera:{findFirst:vi.fn(),update:vi.fn()},$transaction:vi.fn()};
const storage={storePassageImage:vi.fn(),delete:vi.fn()};const logger={info:vi.fn(),warn:vi.fn(),error:vi.fn()};
const event:NormalizedAnprEvent={cameraId:"11111111-1111-4111-8111-111111111111",occurredAt:new Date("2026-09-02T12:00:00Z"),originalPlate:"12-ABC-3",normalizedPlate:"12ABC3",source:"DAHUA_CAMERA",sourceEventId:"TEST-1"};
beforeEach(()=>{vi.clearAllMocks();prisma.passage.findFirst.mockResolvedValue(null);prisma.camera.findFirst.mockResolvedValue({id:event.cameraId,location:"TEST",direction:"INCOMING"});prisma.passage.create.mockResolvedValue({id:"22222222-2222-4222-8222-222222222222"});prisma.$transaction.mockImplementation((fn:any)=>fn({passage:prisma.passage,camera:prisma.camera}));});
describe("PassageService",()=>{
  it("maakt een echte passage en werkt de camera bij",async()=>{const result=await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store(event);expect(result.status).toBe("stored");expect(prisma.passage.create).toHaveBeenCalledWith({data:expect.objectContaining({source:"DAHUA_CAMERA",sourceEventId:"TEST-1",normalizedLicensePlate:"12ABC3",cameraId:event.cameraId})});expect(prisma.camera.update).toHaveBeenCalled();});
  it("weigert een herhaald sourceEventId vóór foto-opslag",async()=>{prisma.passage.findFirst.mockResolvedValue({id:"existing"});const result=await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store(event);expect(result).toEqual({status:"duplicate"});expect(storage.storePassageImage).not.toHaveBeenCalled();expect(prisma.passage.create).not.toHaveBeenCalled();});
  it("gebruikt camera, kenteken en kort tijdvenster als fallback",async()=>{await new PassageService({prisma,storage,dedupeWindowMs:3000,logger}).store({...event,sourceEventId:undefined});expect(prisma.passage.findFirst).toHaveBeenCalledWith({where:expect.objectContaining({cameraId:event.cameraId,normalizedLicensePlate:"12ABC3",timestamp:expect.any(Object)}),select:{id:true}});});
});
