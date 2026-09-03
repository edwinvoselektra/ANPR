import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { PERMISSIONS } from "@anpr/shared";

const prismaMock = vi.hoisted(() => ({
  plateGroup: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  plateGroupMember: { findMany: vi.fn(), findFirst: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  hit: { count: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn()
}));
const authState = vi.hoisted(() => ({ permissions: ["passages.view", "plates.manage"] as string[] }));
vi.mock("./lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("./lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/auth.js")>();
  return { ...actual, requirePermission: (permission:string) => async (request:any, reply:any) => {
    if (!authState.permissions.includes(permission)) return reply.code(403).send({ error:"FORBIDDEN", message:"Je hebt geen toestemming voor deze actie." });
    request.authUser={id:"99999999-9999-4999-8999-999999999999",permissions:authState.permissions};
  }};
});
import { buildServer } from "./server.js";

const GROUP_1="11111111-1111-4111-8111-111111111111";const GROUP_2="22222222-2222-4222-8222-222222222222";
const group=(id=GROUP_1,name="Aandacht")=>({id,name,color:"#dc2626",icon:null,active:true,hitEnabled:true,reasonRequired:true,_count:{members:0},createdAt:new Date(),updatedAt:new Date()});
const member=(groupValue=group())=>({id:"33333333-3333-4333-8333-333333333333",groupId:groupValue.id,normalizedLicensePlate:"12ABC3",displayLicensePlate:"12-ABC-3",description:"Test",note:null,reason:"Testreden",active:true,validFrom:null,validUntil:null,createdAt:new Date(),updatedAt:new Date(),addedBy:{id:"99999999-9999-4999-8999-999999999999",displayName:"Tester"},group:groupValue});
let app:FastifyInstance|undefined;

beforeEach(()=>{vi.clearAllMocks();authState.permissions=[PERMISSIONS.PASSAGES_VIEW,PERMISSIONS.PLATES_MANAGE];prismaMock.$transaction.mockImplementation(async(value:any)=>typeof value==="function"?value({plateGroupMember:prismaMock.plateGroupMember}):Promise.all(value));prismaMock.auditLog.create.mockResolvedValue({});prismaMock.plateGroup.findMany.mockResolvedValue([group()]);prismaMock.plateGroup.findFirst.mockResolvedValue(null);prismaMock.plateGroupMember.findFirst.mockResolvedValue(null);prismaMock.plateGroupMember.findMany.mockResolvedValue([member()]);});
afterEach(async()=>{await app?.close();app=undefined});

describe("kentekenbeheer",()=>{
  it("voegt een genormaliseerd kenteken aan meerdere groepen toe",async()=>{const second=group(GROUP_2,"Prio");prismaMock.plateGroup.findMany.mockResolvedValue([group(),second]);prismaMock.plateGroupMember.findMany.mockResolvedValue([member(),member(second)]);app=buildServer();const response=await app.inject({method:"POST",url:"/plates",payload:{licensePlate:"12 abC 3",reason:"Testreden",groupIds:[GROUP_1,GROUP_2]}});expect(response.statusCode).toBe(201);expect(prismaMock.plateGroupMember.createMany).toHaveBeenCalledWith({data:expect.arrayContaining([expect.objectContaining({normalizedLicensePlate:"12ABC3",groupId:GROUP_1}),expect.objectContaining({normalizedLicensePlate:"12ABC3",groupId:GROUP_2})])});expect(response.json().plate.groups).toHaveLength(2)});
  it("normaliseert een kenteken zonder streepjes en bewaart lege geldigheidsvelden als null",async()=>{app=buildServer();const response=await app.inject({method:"POST",url:"/plates",payload:{licensePlate:"v84kvj",reason:"Testreden",groupIds:[GROUP_1],validFrom:null,validUntil:null}});expect(response.statusCode).toBe(201);expect(prismaMock.plateGroupMember.createMany).toHaveBeenCalledWith({data:[expect.objectContaining({normalizedLicensePlate:"V84KVJ",validFrom:null,validUntil:null})]})});
  it("weigert een signaleringskenteken zonder reden",async()=>{app=buildServer();const response=await app.inject({method:"POST",url:"/plates",payload:{licensePlate:"12-ABC-3",groupIds:[GROUP_1]}});expect(response.statusCode).toBe(400);expect(response.json().error).toBe("REASON_REQUIRED");expect(prismaMock.plateGroupMember.createMany).not.toHaveBeenCalled()});
  it("bewerkt metadata en voegt een tweede groep toe",async()=>{const second=group(GROUP_2,"Prio");prismaMock.plateGroup.findMany.mockResolvedValue([group(),second]);prismaMock.plateGroupMember.findMany.mockResolvedValueOnce([member()]).mockResolvedValueOnce([member(),member(second)]);app=buildServer();const response=await app.inject({method:"PATCH",url:"/plates/12-ABC-3",payload:{description:"Gewijzigd",reason:"Nieuwe reden",groupIds:[GROUP_1,GROUP_2]}});expect(response.statusCode).toBe(200);expect(prismaMock.plateGroupMember.updateMany).toHaveBeenCalled();expect(prismaMock.plateGroupMember.createMany).toHaveBeenCalledWith({data:[expect.objectContaining({groupId:GROUP_2,normalizedLicensePlate:"12ABC3"})]})});
  it("verwijdert alle groepslidmaatschappen van het kenteken",async()=>{app=buildServer();const response=await app.inject({method:"DELETE",url:"/plates/12ABC3"});expect(response.statusCode).toBe(204);expect(prismaMock.plateGroupMember.deleteMany).toHaveBeenCalledWith({where:{normalizedLicensePlate:"12ABC3"}})});
  it("weigert een Viewer een directe beheeractie",async()=>{authState.permissions=[PERMISSIONS.PASSAGES_VIEW];app=buildServer();const response=await app.inject({method:"DELETE",url:"/plates/12ABC3"});expect(response.statusCode).toBe(403);expect(prismaMock.plateGroupMember.deleteMany).not.toHaveBeenCalled()});
});

describe("groepenbeheer",()=>{
  it("maakt een unieke groep aan",async()=>{prismaMock.plateGroup.create.mockResolvedValue(group());app=buildServer();const response=await app.inject({method:"POST",url:"/plate-groups",payload:{name:"Aandacht",color:"#dc2626",hitEnabled:true,reasonRequired:true}});expect(response.statusCode).toBe(201);expect(prismaMock.plateGroup.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({hitEnabled:true,pushNotifications:false})}))});
  it("wijzigt een bestaande groep",async()=>{prismaMock.plateGroup.findUnique.mockResolvedValue(group());prismaMock.plateGroup.update.mockResolvedValue({...group(),name:"Prio"});app=buildServer();const response=await app.inject({method:"PATCH",url:`/plate-groups/${GROUP_1}`,payload:{name:"Prio"}});expect(response.statusCode).toBe(200);expect(response.json().group.name).toBe("Prio")});
  it("laat een ADMIN een bestaande seed/demo-groep volledig wijzigen en haalt de opgeslagen waarden opnieuw op",async()=>{const changed={...group(),name:"Aandacht gewijzigd",description:"Nieuwe omschrijving",color:"#123456",icon:null,active:false,hitEnabled:false,reasonRequired:false};prismaMock.plateGroup.findUnique.mockResolvedValue(group());prismaMock.plateGroup.update.mockResolvedValue(changed);app=buildServer();const update=await app.inject({method:"PATCH",url:`/plate-groups/${GROUP_1}`,payload:{name:changed.name,description:changed.description,color:changed.color,icon:"",active:false,hitEnabled:false,reasonRequired:false}});expect(update.statusCode).toBe(200);expect(prismaMock.plateGroup.update).toHaveBeenCalledWith(expect.objectContaining({where:{id:GROUP_1},data:expect.objectContaining({name:changed.name,description:changed.description,color:changed.color,icon:null,active:false,hitEnabled:false,reasonRequired:false})}));prismaMock.plateGroup.findMany.mockResolvedValue([changed]);const fetched=await app.inject({method:"GET",url:"/plate-groups"});expect(fetched.statusCode).toBe(200);expect(fetched.json().groups[0]).toMatchObject({name:changed.name,active:false,hitEnabled:false,reasonRequired:false})});
  it("weigert een Viewer een bestaande groep via de directe API te wijzigen",async()=>{authState.permissions=[PERMISSIONS.PASSAGES_VIEW];app=buildServer();const response=await app.inject({method:"PATCH",url:`/plate-groups/${GROUP_1}`,payload:{name:"Verboden wijziging"}});expect(response.statusCode).toBe(403);expect(prismaMock.plateGroup.update).not.toHaveBeenCalled()});
  it("deactiveert een groep met hithistorie zonder historie te verwijderen",async()=>{prismaMock.plateGroup.findUnique.mockResolvedValue(group());prismaMock.hit.count.mockResolvedValue(1);prismaMock.plateGroup.update.mockResolvedValue(group());prismaMock.plateGroupMember.updateMany.mockResolvedValue({count:1});app=buildServer();const response=await app.inject({method:"DELETE",url:`/plate-groups/${GROUP_1}`});expect(response.statusCode).toBe(200);expect(response.json().deactivated).toBe(true);expect(prismaMock.plateGroup.delete).not.toHaveBeenCalled()});
});
