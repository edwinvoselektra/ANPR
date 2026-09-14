import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
const prismaMock=vi.hoisted(()=>({camera:{findUnique:vi.fn().mockResolvedValue(null)},passage:{findMany:vi.fn(),count:vi.fn()},hit:{findMany:vi.fn(),findUnique:vi.fn(),count:vi.fn()}}));
vi.mock("./lib/prisma.js",()=>({prisma:prismaMock}));
vi.mock("./lib/auth.js",async(importOriginal)=>{const actual=await importOriginal<typeof import("./lib/auth.js")>();return{...actual,requirePermission:()=>async()=>undefined}});
import { buildServer } from "./server.js";
const CAMERA_ID="11111111-1111-4111-8111-111111111111",GROUP_ID="22222222-2222-4222-8222-222222222222",PASSAGE_ID="33333333-3333-4333-8333-333333333333";
let app:FastifyInstance|undefined;
beforeEach(()=>{vi.clearAllMocks();prismaMock.passage.findMany.mockResolvedValue([]);prismaMock.passage.count.mockResolvedValue(0);prismaMock.hit.findMany.mockResolvedValue([]);prismaMock.hit.count.mockResolvedValue(0)});
afterEach(async()=>{await app?.close();app=undefined});

describe("databasezoekfunctie",()=>{
  it.each([["12-ABC-3","12ABC3"],["ABC","ABC"]])("normaliseert een volledig of gedeeltelijk kentekenfilter %s",async(plate,normalized)=>{app=buildServer();const response=await app.inject({method:"GET",url:`/search/passages?plate=${plate}`});expect(response.statusCode).toBe(200);expect(prismaMock.passage.findMany.mock.calls[0]![0].where.normalizedLicensePlate).toEqual({contains:normalized})});
  it("combineert kenteken, kleur, type, camera, groep, richting en pagination database-side",async()=>{app=buildServer();const response=await app.inject({method:"GET",url:`/search/passages?plate=12-ABC&color=BLACK&type=VAN&cameraId=${CAMERA_ID}&location=Uddel&groupId=${GROUP_ID}&onlyHits=true&direction=INCOMING&dateFrom=2026-09-01&dateTo=2026-09-03&page=2&limit=10`});expect(response.statusCode).toBe(200);expect(prismaMock.passage.findMany).toHaveBeenCalledWith(expect.objectContaining({skip:10,take:10,where:expect.objectContaining({normalizedLicensePlate:{contains:"12ABC"},vehicleColor:"BLACK",vehicleType:"VAN",cameraId:CAMERA_ID,location:{contains:"Uddel",mode:"insensitive"},direction:"INCOMING",hits:{some:{OR:[{groupId:GROUP_ID},{groups:{some:{groupId:GROUP_ID}}}]}}})}));expect(prismaMock.passage.count).toHaveBeenCalled()});
  it("bouwt een nachtelijk tijdvenster over middernacht in Nederlandse lokale tijd",async()=>{app=buildServer();const response=await app.inject({method:"GET",url:"/search/passages?dateFrom=2026-09-01&dateTo=2026-09-02&timeFrom=22:00&timeTo=03:00"});expect(response.statusCode).toBe(200);const call=prismaMock.passage.findMany.mock.calls[0]![0];expect(call.where.OR).toHaveLength(2);expect(call.where.OR[0].timestamp.gte).toEqual(new Date("2026-09-01T20:00:00Z"));expect(call.where.OR[0].timestamp.lte).toEqual(new Date("2026-09-02T01:00:00Z"))});
  it("ondersteunt zoeken zonder kenteken",async()=>{app=buildServer();const response=await app.inject({method:"GET",url:"/search/passages?color=BLUE"});expect(response.statusCode).toBe(200);expect(prismaMock.passage.findMany.mock.calls[0]![0].where.normalizedLicensePlate).toBeUndefined()});
});

describe("hits API",()=>{
  it("levert nieuwste hits met groepen en passage",async()=>{const hit={id:"44444444-4444-4444-8444-444444444444",reason:"Test",timestamp:new Date(),group:{id:GROUP_ID,name:"Aandacht",color:"#dc2626",icon:null},groups:[],camera:{id:CAMERA_ID,name:"Uddel Noord",location:"Uddel"},passage:{id:PASSAGE_ID,displayLicensePlate:"12-ABC-3",source:"DEMO"}};prismaMock.hit.findMany.mockResolvedValue([hit]);prismaMock.hit.count.mockResolvedValue(1);app=buildServer();const response=await app.inject({method:"GET",url:"/hits?page=1&limit=25"});expect(response.statusCode).toBe(200);expect(response.json().hits[0].groups[0].name).toBe("Aandacht");expect(prismaMock.hit.findMany).toHaveBeenCalledWith(expect.objectContaining({orderBy:[{timestamp:"desc"},{id:"desc"}],skip:0,take:25}))});
});
