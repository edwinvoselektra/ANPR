import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import type { FastifyInstance } from "fastify";

const prismaMock=vi.hoisted(()=>({
  vpnLocation:{findMany:vi.fn(),findUnique:vi.fn(),findUniqueOrThrow:vi.fn(),create:vi.fn(),update:vi.fn(),delete:vi.fn()},
  recorder:{findFirst:vi.fn(),deleteMany:vi.fn()},systemSetting:{findUnique:vi.fn(),create:vi.fn()},auditLog:{create:vi.fn()},$transaction:vi.fn()
}));
vi.mock("./lib/prisma.js",()=>({prisma:prismaMock}));
vi.mock("./lib/auth.js",async(importOriginal)=>{const actual=await importOriginal<typeof import("./lib/auth.js")>();return{...actual,requirePermission:()=>async()=>undefined}});
import { buildServer } from "./server.js";

const id="11111111-1111-4111-8111-111111111111";
const location={id,name:"Uddel Noord",description:null,routerType:"TP_LINK_OMADA_ER605",vpnType:"WIREGUARD",vpnMode:"LOCATION_TO_SERVER",tunnelAddress:"10.100.0.2",remoteLanCidr:"192.168.178.0/24",remoteGatewayIp:"192.168.178.1",endpointHost:null,listenPort:51820,mtu:1420,active:true,publicKey:null,privateKeyEncrypted:"encrypted-private",connectionStatus:"CONNECTING",recorders:[{id:"22222222-2222-4222-8222-222222222222",name:"Recorder",ipAddress:"192.168.178.210",rtspPort:554,channelCount:2}],_count:{cameras:0}};
let app:FastifyInstance|undefined;
beforeEach(()=>{vi.clearAllMocks();prismaMock.auditLog.create.mockResolvedValue({});prismaMock.vpnLocation.findMany.mockResolvedValue([])});afterEach(async()=>{await app?.close();app=undefined});

describe("locatie-API",()=>{
  it("maakt een locatie met automatisch uniek tunneladres en zonder routerwachtwoord",async()=>{prismaMock.vpnLocation.create.mockResolvedValue(location);app=buildServer();const response=await app.inject({method:"POST",url:"/locations",payload:{name:"Uddel Noord",routerType:"TP_LINK_OMADA_ER605",remoteLanCidr:"192.168.178.0/24",remoteGatewayIp:"192.168.178.1",routerPassword:"mag-niet-worden-opgeslagen",recorder:{name:"Recorder",ipAddress:"192.168.178.210",rtspPort:554}}});expect(response.statusCode).toBe(201);expect(prismaMock.vpnLocation.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({tunnelAddress:"10.100.0.2"})}));expect(JSON.stringify(prismaMock.vpnLocation.create.mock.calls)).not.toContain("mag-niet-worden-opgeslagen")});
  it("levert encrypted/private keys nooit via de locatie-GET uit",async()=>{prismaMock.vpnLocation.findUniqueOrThrow.mockResolvedValue({...location,cameras:[]});app=buildServer();const response=await app.inject({method:"GET",url:`/locations/${id}`});expect(response.statusCode).toBe(200);expect(response.json().location.hasPrivateKey).toBe(true);expect(response.body).not.toContain("encrypted-private");expect(response.body).not.toContain("privateKeyEncrypted")});
  it("blokkeert verwijderen zolang camera's gekoppeld zijn",async()=>{prismaMock.vpnLocation.findUnique.mockResolvedValue({...location,_count:{cameras:1}});app=buildServer();const response=await app.inject({method:"DELETE",url:`/locations/${id}`});expect(response.statusCode).toBe(409);expect(response.json().error).toBe("LOCATION_HAS_CAMERAS");expect(prismaMock.vpnLocation.delete).not.toHaveBeenCalled()});
  it("weigert een recorder buiten het remote subnet",async()=>{app=buildServer();const response=await app.inject({method:"POST",url:"/locations",payload:{name:"Uddel Noord",routerType:"TP_LINK_OMADA_ER605",remoteLanCidr:"192.168.178.0/24",recorder:{name:"Recorder",ipAddress:"192.168.179.210",rtspPort:554}}});expect(response.statusCode).toBe(400);expect(response.json().message).toContain("binnen het remote LAN subnet")});
  it("meldt subnetoverlap duidelijk",async()=>{prismaMock.vpnLocation.findMany.mockResolvedValueOnce([{id,name:"Uddel Oost",remoteLanCidr:"192.168.178.128/25"}]);app=buildServer();const response=await app.inject({method:"POST",url:"/locations",payload:{name:"Uddel Noord",routerType:"TP_LINK_OMADA_ER605",remoteLanCidr:"192.168.178.0/24"}});expect(response.statusCode).toBe(409);expect(response.json().message).toContain("Overlappende subnets")},10_000);
});
