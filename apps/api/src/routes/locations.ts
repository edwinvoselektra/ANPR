import { validTimeZone } from "@anpr/shared";
import type { FastifyInstance } from "fastify";
import { isIP } from "node:net";
import { z } from "zod";
import { PERMISSIONS } from "@anpr/shared";
import { config } from "../config.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { decryptSecret } from "../lib/crypto.js";
import { checkLocation } from "../lib/location-health.js";
import { allocateTunnelAddress, cidrsOverlap, hostIsValid, ipInCidr, parseIpv4Cidr } from "../lib/network.js";
import { prisma } from "../lib/prisma.js";
import { encryptedWireGuardPrivateKey, generateWireGuardKeyPair, publicKeyFromPrivate } from "../lib/wireguard.js";
import { encryptedDahuaConnection, publicDeviceConnection } from "../lib/device-connections.js";

const recorderSchema=z.object({
  name:z.string().trim().min(2).max(100).default("Recorder"),ipAddress:z.string().trim(),
  rtspPort:z.coerce.number().int().min(1).max(65535).default(554),channelCount:z.coerce.number().int().min(1).max(256).optional(),
  dahuaTcp:z.object({host:z.string().trim().min(1).max(253),port:z.coerce.number().int().min(1).max(65535).default(37777),username:z.string().max(200).optional(),password:z.string().max(500).optional(),category:z.enum(["CAMERA","NVR","AUTO"]).default("NVR")}).nullable().optional()
});

const bodySchema = z.object({
  timezone:z.string().refine(validTimeZone,"Gebruik een geldige IANA-tijdzone.").optional(),
  name:z.string().trim().min(2).max(100), description:z.string().trim().max(1000).optional(),
  routerType:z.enum(["TP_LINK_OMADA_ER605","MANUAL_OTHER"]), vpnType:z.literal("WIREGUARD").default("WIREGUARD"),
  vpnMode:z.enum(["SERVER_TO_LOCATION","LOCATION_TO_SERVER"]).default("LOCATION_TO_SERVER"),
  remoteLanCidr:z.string().trim(), remoteGatewayIp:z.string().trim().optional(), endpointHost:z.string().trim().optional(),
  listenPort:z.coerce.number().int().min(1).max(65535).default(51820), mtu:z.coerce.number().int().min(576).max(1440).default(1420), active:z.boolean().default(true),
  recorder:recorderSchema.optional()
});

function publicLocation(location:any) {
  const { privateKeyEncrypted, ...safe }=location;
  return {...safe,recorders:Array.isArray(safe.recorders)?safe.recorders.map((recorder:any)=>({...recorder,deviceConnections:Array.isArray(recorder.deviceConnections)?recorder.deviceConnections.map(publicDeviceConnection):undefined})):safe.recorders,hasPrivateKey:Boolean(privateKeyEncrypted)};
}

function recorderData(recorder:z.infer<typeof recorderSchema>){const{dahuaTcp,...base}=recorder;return{...base,deviceConnections:dahuaTcp?{create:encryptedDahuaConnection(dahuaTcp)}:undefined};}

async function validateNetwork(body:z.infer<typeof bodySchema>, excludeId?:string) {
  parseIpv4Cidr(body.remoteLanCidr);
  if (body.remoteGatewayIp && isIP(body.remoteGatewayIp)!==4) throw Object.assign(new Error("Router LAN IP is geen geldig IPv4-adres."),{statusCode:400});
  if (body.remoteGatewayIp && !ipInCidr(body.remoteGatewayIp,body.remoteLanCidr)) throw Object.assign(new Error("Router LAN IP moet binnen het remote LAN subnet vallen."),{statusCode:400});
  if (body.recorder && isIP(body.recorder.ipAddress)!==4) throw Object.assign(new Error("Recorder IP is geen geldig IPv4-adres."),{statusCode:400});
  if (body.recorder && !ipInCidr(body.recorder.ipAddress,body.remoteLanCidr)) throw Object.assign(new Error("Recorder IP moet binnen het remote LAN subnet vallen."),{statusCode:400});
  if (body.endpointHost && !hostIsValid(body.endpointHost)) throw Object.assign(new Error("Gebruik een geldig centraal endpoint (IP-adres of hostnaam)."),{statusCode:400});
  const existing=await prisma.vpnLocation.findMany({where:excludeId?{id:{not:excludeId}}:undefined,select:{id:true,name:true,remoteLanCidr:true}});
  const overlap=existing.find((item)=>cidrsOverlap(item.remoteLanCidr,body.remoteLanCidr));
  if(overlap) throw Object.assign(new Error(`Remote LAN overlapt met locatie “${overlap.name}”. Overlappende subnets veroorzaken routingproblemen; kies een uniek subnet.`),{statusCode:409,code:"REMOTE_SUBNET_OVERLAP"});
}

async function serverKeys() {
  const key="vpn.wireguard.server-key.v1";
  const existing=await prisma.systemSetting.findUnique({where:{key}});
  if(existing) { const encrypted=(existing.value as {privateKeyEncrypted:string}).privateKeyEncrypted; const privateKey=decryptSecret(encrypted); if(!privateKey)throw new Error("Centrale WireGuard-sleutel ontbreekt.");return {privateKey,publicKey:publicKeyFromPrivate(privateKey)}; }
  const pair=generateWireGuardKeyPair();
  await prisma.systemSetting.create({data:{key,value:{privateKeyEncrypted:encryptedWireGuardPrivateKey(pair.privateKey)},description:"Versleutelde centrale WireGuard private key; nooit via API uitleveren."}});
  return pair;
}

export async function locationRoutes(app:FastifyInstance) {
  app.get("/locations",{preHandler:requirePermission(PERMISSIONS.LOCATIONS_VIEW)},async()=>({locations:(await prisma.vpnLocation.findMany({include:{recorders:{include:{deviceConnections:true}},_count:{select:{cameras:true}}},orderBy:{name:"asc"}})).map(publicLocation),addressPlan:{tunnelCidr:config.VPN_TUNNEL_CIDR,serverAddress:config.VPN_SERVER_ADDRESS}}));
  app.get("/locations/:id",{preHandler:requirePermission(PERMISSIONS.LOCATIONS_VIEW)},async(request)=>{const{id}=z.object({id:z.string().uuid()}).parse(request.params);return{location:publicLocation(await prisma.vpnLocation.findUniqueOrThrow({where:{id},include:{recorders:{include:{deviceConnections:true}},cameras:{select:{id:true,name:true,status:true,anprChannel:true}}}}))};});
  app.post("/locations",{preHandler:requirePermission(PERMISSIONS.LOCATIONS_MANAGE)},async(request,reply)=>{
    const body=bodySchema.parse(request.body); await validateNetwork(body);
    parseIpv4Cidr(config.VPN_TUNNEL_CIDR);
    if(!ipInCidr(config.VPN_SERVER_ADDRESS,config.VPN_TUNNEL_CIDR)) throw new Error("VPN_SERVER_ADDRESS valt niet binnen VPN_TUNNEL_CIDR.");
    const used=(await prisma.vpnLocation.findMany({select:{tunnelAddress:true}})).map((item)=>item.tunnelAddress);
    const tunnelAddress=allocateTunnelAddress(config.VPN_TUNNEL_CIDR,config.VPN_SERVER_ADDRESS,used);
    const location=await prisma.vpnLocation.create({data:{name:body.name,timezone:body.timezone,description:body.description,routerType:body.routerType,vpnType:body.vpnType,vpnMode:body.vpnMode,tunnelAddress,remoteLanCidr:body.remoteLanCidr,remoteGatewayIp:body.remoteGatewayIp,endpointHost:body.endpointHost,listenPort:body.listenPort,mtu:body.mtu,active:body.active,connectionStatus:body.active?"CONNECTING":"OFFLINE",recorders:body.recorder?{create:recorderData(body.recorder)}:undefined},include:{recorders:{include:{deviceConnections:true}},_count:{select:{cameras:true}}}});
    await audit(request,"VPN_LOCATION_CREATED",{objectType:"VpnLocation",objectId:location.id,newValue:publicLocation(location)});
    return reply.code(201).send({location:publicLocation(location)});
  });
  app.patch("/locations/:id",{preHandler:requirePermission(PERMISSIONS.LOCATIONS_MANAGE)},async(request)=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);const body=bodySchema.parse(request.body);await validateNetwork(body,id);const current=await prisma.vpnLocation.findUniqueOrThrow({where:{id},include:{recorders:{include:{deviceConnections:true}}}});
    const location=await prisma.$transaction(async(tx)=>{if(body.recorder){const{dahuaTcp,...base}=body.recorder;const first=current.recorders[0];const recorder=first?await tx.recorder.update({where:{id:first.id},data:base}):await tx.recorder.create({data:{locationId:id,...base}});if(dahuaTcp===null)await tx.deviceConnection.deleteMany({where:{recorderId:recorder.id,type:"DAHUA_TCP_SDK"}});else if(dahuaTcp){const existing=first?.deviceConnections?.find((item:any)=>item.type==="DAHUA_TCP_SDK");const data=encryptedDahuaConnection(dahuaTcp,existing);await tx.deviceConnection.upsert({where:{recorderId_type:{recorderId:recorder.id,type:"DAHUA_TCP_SDK"}},create:{recorderId:recorder.id,...data},update:data});}}return tx.vpnLocation.update({where:{id},data:{name:body.name,timezone:body.timezone,description:body.description,routerType:body.routerType,vpnType:body.vpnType,vpnMode:body.vpnMode,remoteLanCidr:body.remoteLanCidr,remoteGatewayIp:body.remoteGatewayIp,endpointHost:body.endpointHost,listenPort:body.listenPort,mtu:body.mtu,active:body.active,connectionStatus:body.active?undefined:"OFFLINE"},include:{recorders:{include:{deviceConnections:true}},_count:{select:{cameras:true}}}})});
    await audit(request,"VPN_LOCATION_UPDATED",{objectType:"VpnLocation",objectId:id,oldValue:publicLocation(current),newValue:publicLocation(location)});return{location:publicLocation(location)};
  });
  app.post("/locations/:id/wireguard-config",{preHandler:requirePermission(PERMISSIONS.LOCATIONS_MANAGE)},async(request)=>{
    const{id}=z.object({id:z.string().uuid()}).parse(request.params);const current=await prisma.vpnLocation.findUniqueOrThrow({where:{id},include:{recorders:true}});const server=await serverKeys();
    const generated=current.privateKeyEncrypted?null:generateWireGuardKeyPair();const privateKey=generated?.privateKey??decryptSecret(current.privateKeyEncrypted);if(!privateKey)throw new Error("Locatie WireGuard-sleutel ontbreekt.");const locationPublicKey=generated?.publicKey??current.publicKey??publicKeyFromPrivate(privateKey);
    if(generated)await prisma.vpnLocation.update({where:{id},data:{privateKeyEncrypted:encryptedWireGuardPrivateKey(privateKey),publicKey:locationPublicKey}});
    await audit(request,"VPN_CONFIGURATION_GENERATED",{objectType:"VpnLocation",objectId:id,metadata:{mode:current.vpnMode}});
    return {configuration:{location:{interfaceName:`ANPR-${current.name}`.replace(/[^a-zA-Z0-9_-]/g,"-").slice(0,32),privateKey:generated?.privateKey,publicKey:locationPublicKey,localIpAddress:`${current.tunnelAddress}/${parseIpv4Cidr(config.VPN_TUNNEL_CIDR).prefix}`,mtu:current.mtu,listenPort:current.listenPort},peer:{publicKey:server.publicKey,allowedAddress:`${config.VPN_SERVER_ADDRESS}/32`,endpoint:config.VPN_SERVER_ENDPOINT??current.endpointHost??null,endpointPort:config.VPN_LISTEN_PORT,persistentKeepalive:current.vpnMode==="LOCATION_TO_SERVER"?25:0},central:{publicKey:server.publicKey,address:config.VPN_SERVER_ADDRESS,allowedIps:[`${current.tunnelAddress}/32`,current.remoteLanCidr]},privateKeyNotice:generated?"De locatie-private key wordt uitsluitend nu getoond. Kopieer hem direct naar de ER605; later geeft de API hem niet opnieuw terug.":"De private key is al opgeslagen en wordt niet opnieuw getoond."}};
  });
  app.post("/locations/:id/test",{preHandler:requirePermission(PERMISSIONS.LOCATIONS_MANAGE)},async(request)=>{const{id}=z.object({id:z.string().uuid()}).parse(request.params);const location=await prisma.vpnLocation.findUniqueOrThrow({where:{id},include:{recorders:{orderBy:{createdAt:"asc"},take:1}}});const health=await checkLocation(location);const updated=await prisma.vpnLocation.update({where:{id},data:{...health,lastCheckedAt:new Date(),lastSeenAt:health.connectionStatus==="ONLINE"||health.connectionStatus==="DEGRADED"?new Date():undefined},include:{recorders:true,_count:{select:{cameras:true}}}});await audit(request,"VPN_CONNECTION_TESTED",{objectType:"VpnLocation",objectId:id,metadata:{status:health.connectionStatus}});return{location:publicLocation(updated)};});
  app.delete("/locations/:id",{preHandler:requirePermission(PERMISSIONS.LOCATIONS_MANAGE)},async(request,reply)=>{const{id}=z.object({id:z.string().uuid()}).parse(request.params);const location=await prisma.vpnLocation.findUnique({where:{id},include:{_count:{select:{cameras:true}},recorders:{select:{id:true}}}});if(!location)return reply.code(204).send();if(location._count.cameras>0)return reply.code(409).send({error:"LOCATION_HAS_CAMERAS",message:"Deze locatie heeft gekoppelde camera’s. Ontkoppel of verplaats die camera’s voordat u de locatie verwijdert."});await prisma.$transaction([prisma.recorder.deleteMany({where:{locationId:id}}),prisma.vpnLocation.delete({where:{id}})]);await audit(request,"VPN_LOCATION_DELETED",{objectType:"VpnLocation",objectId:id,oldValue:publicLocation(location)});return reply.code(204).send();});
}
