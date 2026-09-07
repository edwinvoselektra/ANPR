import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { config } from "../config.js";
import { prisma } from "./prisma.js";

type Target = { id: string; tunnelAddress: string; remoteGatewayIp: string | null; active: boolean; recorders: Array<{ ipAddress: string; rtspPort: number }> };
export type LocationHealth = { connectionStatus: "UNKNOWN"|"CONNECTING"|"ONLINE"|"DEGRADED"|"OFFLINE"; tunnelOnline: boolean|null; routeReachable: boolean|null; recorderReachable: boolean|null; recorderPortOpen: boolean|null; lastHandshakeAt: Date|null; lastHealthErrorCode: string|null };
export type ReachabilityProbe=(host:string,port:number,timeoutMs?:number)=>Promise<{reachable:boolean;routed:boolean}>;

export function tcpReachable(host: string, port: number, timeoutMs = config.VPN_HEALTH_TIMEOUT_MS): Promise<{ reachable: boolean; routed: boolean }> {
  return new Promise((resolve) => {
    const socket = connect({ host, port }); let settled = false;
    const done = (result: { reachable: boolean; routed: boolean }) => { if (settled) return; settled = true; socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs, () => done({ reachable: false, routed: false }));
    socket.once("connect", () => done({ reachable: true, routed: true }));
    socket.once("error", (error: NodeJS.ErrnoException) => done({ reachable: false, routed: !["ENETUNREACH", "EHOSTUNREACH", "ETIMEDOUT"].includes(error.code ?? "") }));
  });
}

async function handshakeFor(tunnelAddress: string): Promise<Date|null> {
  if (!config.VPN_STATUS_FILE) return null;
  try {
    const parsed = JSON.parse(await readFile(config.VPN_STATUS_FILE, "utf8")) as Record<string, string|null>;
    const value = parsed[tunnelAddress]; const timestamp = value ? new Date(value) : null;
    return timestamp && Number.isFinite(timestamp.getTime()) ? timestamp : null;
  } catch { return null; }
}

export function deriveLocationStatus(tunnelOnline:boolean|null,hasRecorder:boolean,recorderPortOpen:boolean|null,networkReachable:boolean):LocationHealth["connectionStatus"]{
  if(tunnelOnline===false)return "OFFLINE";
  if(tunnelOnline===true&&hasRecorder&&!recorderPortOpen)return "DEGRADED";
  if(tunnelOnline===true&&(!hasRecorder||recorderPortOpen))return "ONLINE";
  return networkReachable?"DEGRADED":"UNKNOWN";
}

export async function checkLocation(target: Target, now = new Date(), probe:ReachabilityProbe=tcpReachable, handshakeProvider=handshakeFor,handshakeAvailable=Boolean(config.VPN_STATUS_FILE)): Promise<LocationHealth> {
  if (!target.active) return { connectionStatus:"OFFLINE",tunnelOnline:false,routeReachable:null,recorderReachable:null,recorderPortOpen:null,lastHandshakeAt:null,lastHealthErrorCode:"INACTIVE" };
  const lastHandshakeAt = await handshakeProvider(target.tunnelAddress);
  const tunnelOnline = handshakeAvailable ? Boolean(lastHandshakeAt && now.getTime()-lastHandshakeAt.getTime() < 180_000) : null;
  const recorder = target.recorders[0];
  const result = recorder ? await probe(recorder.ipAddress, recorder.rtspPort) : target.remoteGatewayIp ? await probe(target.remoteGatewayIp, 443) : null;
  const routeReachable = result?.routed ?? null; const recorderPortOpen = recorder ? result?.reachable ?? false : null;
  const recorderReachable = recorder ? (result?.routed ?? false) : null;
  const connectionStatus=deriveLocationStatus(tunnelOnline,Boolean(recorder),recorderPortOpen,Boolean(result?.reachable));
  return { connectionStatus,tunnelOnline,routeReachable,recorderReachable,recorderPortOpen,lastHandshakeAt,lastHealthErrorCode:null };
}

export async function runLocationHealthChecks() {
  const locations = await prisma.vpnLocation.findMany({ where:{ active:true }, include:{ recorders:{ orderBy:{ createdAt:"asc" }, take:1 } } });
  await Promise.allSettled(locations.map(async (location) => {
    try { const health=await checkLocation(location); await prisma.vpnLocation.update({where:{id:location.id},data:{...health,lastCheckedAt:new Date(),lastSeenAt:health.connectionStatus==="ONLINE"||health.connectionStatus==="DEGRADED"?new Date():undefined}}); }
    catch { await prisma.vpnLocation.update({where:{id:location.id},data:{connectionStatus:"UNKNOWN",lastCheckedAt:new Date(),lastHealthErrorCode:"CHECK_FAILED"}}).catch(()=>undefined); }
  }));
}

export function startLocationHealthChecks() {
  let running=false; const execute=async()=>{if(running)return;running=true;try{await runLocationHealthChecks();}finally{running=false;}};
  void execute(); const timer=setInterval(()=>void execute(),config.VPN_HEALTH_INTERVAL_SECONDS*1000); timer.unref(); return()=>clearInterval(timer);
}
