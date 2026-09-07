import { describe,expect,it } from "vitest";
import { allocateTunnelAddress,cidrsOverlap,ipInCidr,parseIpv4Cidr } from "./lib/network.js";
import { checkLocation,deriveLocationStatus,tcpReachable } from "./lib/location-health.js";
import { generateWireGuardKeyPair,publicKeyFromPrivate } from "./lib/wireguard.js";

describe("VPN-netwerkvalidatie",()=>{
  it("valideert CIDR en detecteert overlap",()=>{expect(parseIpv4Cidr("192.168.178.0/24").prefix).toBe(24);expect(()=>parseIpv4Cidr("192.168.178.5/24")).toThrow("netwerkadres");expect(cidrsOverlap("192.168.178.0/24","192.168.178.128/25")).toBe(true);expect(cidrsOverlap("192.168.178.0/24","192.168.179.0/24")).toBe(false)});
  it("controleert recorderadressen en kent unieke tunnel-IP's toe",()=>{expect(ipInCidr("192.168.178.210","192.168.178.0/24")).toBe(true);expect(ipInCidr("192.168.179.210","192.168.178.0/24")).toBe(false);expect(allocateTunnelAddress("10.100.0.0/24","10.100.0.1",["10.100.0.2"])).toBe("10.100.0.3")});
  it("maakt een WireGuard-compatibel X25519-keypair",()=>{const pair=generateWireGuardKeyPair();expect(Buffer.from(pair.privateKey,"base64")).toHaveLength(32);expect(publicKeyFromPrivate(pair.privateKey)).toBe(pair.publicKey)});
});

describe("locatie-health",()=>{
  it("leidt ONLINE, DEGRADED en OFFLINE af",()=>{expect(deriveLocationStatus(true,true,true,true)).toBe("ONLINE");expect(deriveLocationStatus(true,true,false,false)).toBe("DEGRADED");expect(deriveLocationStatus(false,true,false,false)).toBe("OFFLINE")});
  it("gebruikt een vervangbare recorder TCP-probe",async()=>{const now=new Date();const result=await checkLocation({id:"x",active:true,tunnelAddress:"10.100.0.2",remoteGatewayIp:null,recorders:[{ipAddress:"192.168.1.10",rtspPort:554}]},now,async()=>({reachable:true,routed:true}),async()=>now,true);expect(result).toMatchObject({connectionStatus:"ONLINE",recorderReachable:true,recorderPortOpen:true})});
  it("breekt een TCP-healthcheck binnen de veilige timeout af",async()=>{const started=Date.now();const result=await tcpReachable("203.0.113.1",554,25);expect(result.reachable).toBe(false);expect(Date.now()-started).toBeLessThan(500)});
});
