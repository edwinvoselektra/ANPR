import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const prismaMock=vi.hoisted(()=>({passage:{findMany:vi.fn(),findFirst:vi.fn()}}));
vi.mock("./lib/prisma.js",()=>({prisma:prismaMock}));
vi.mock("./lib/auth.js",async(importOriginal)=>{const actual=await importOriginal<typeof import("./lib/auth.js")>();return{...actual,requirePermission:()=>async()=>undefined}});
import { buildServer } from "./server.js";

const passage={id:"11111111-1111-4111-8111-111111111111",displayLicensePlate:"12-ABC-3",source:"DAHUA_CAMERA",timestamp:new Date("2026-09-02T12:00:00Z"),camera:{id:"22222222-2222-4222-8222-222222222222",name:"TEST camera",location:"TEST"}};
let app:FastifyInstance|undefined;
beforeEach(()=>{vi.clearAllMocks();prismaMock.passage.findMany.mockResolvedValue([passage]);prismaMock.passage.findFirst.mockResolvedValue(passage)});
afterEach(async()=>{await app?.close();app=undefined});
describe("passage API",()=>{
  it("levert nieuwste passages via een no-store response",async()=>{app=buildServer();const response=await app.inject({method:"GET",url:"/passages?limit=20"});expect(response.statusCode).toBe(200);expect(response.headers["cache-control"]).toBe("private, no-store");expect(response.json().passages[0].source).toBe("DAHUA_CAMERA");expect(prismaMock.passage.findMany).toHaveBeenCalledWith(expect.objectContaining({take:20,orderBy:[{timestamp:"desc"},{id:"desc"}]}))});
  it("geeft een nette 404 voor een ontbrekende passage",async()=>{prismaMock.passage.findFirst.mockResolvedValue(null);app=buildServer();const response=await app.inject({method:"GET",url:`/passages/${passage.id}`});expect(response.statusCode).toBe(404);expect(response.json().message).toBe("Deze passage bestaat niet (meer).")});
  it("weigert een ongeldige UUID",async()=>{app=buildServer();const response=await app.inject({method:"GET",url:"/passages/not-an-id"});expect(response.statusCode).toBe(400)});
});
