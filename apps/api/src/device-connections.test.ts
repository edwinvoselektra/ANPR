import { describe, expect, it, vi } from "vitest";
import { DahuaTcpProvider, isBlockedDeviceTarget, publicDeviceConnection } from "./lib/device-connections.js";

describe("Dahua TCP-provider", () => {
  it("meldt een open poort zonder adapter als bereikbaar maar niet gevalideerd", async () => {
    const probe=vi.fn().mockResolvedValue(undefined);
    const provider=new DahuaTcpProvider(undefined,async()=>["192.168.1.20"],probe);
    const result=await provider.test({host:"camera.lan"});
    expect(probe).toHaveBeenCalledWith("192.168.1.20",37777,3000);
    expect(result).toMatchObject({success:false,status:"UNKNOWN",tcpPortOpen:true,networkStatus:"REACHABLE",deviceApi:"NOT_CONFIRMED",authentication:"NOT_TESTED",dahuaDevice:"UNKNOWN",code:"SDK_NOT_CONFIGURED"});
    expect(result.message).toBe("TCP-poort bereikbaar; gebruikersnaam/wachtwoord nog niet gevalideerd.");
    expect(Object.values(result.capabilities).every(value=>value==="UNKNOWN")).toBe(true);
  });

  it("claimt bij een open poort en verkeerde credentials zonder adapter geen authenticatieresultaat", async () => {
    const provider=new DahuaTcpProvider(undefined,async()=>["192.168.1.20"],vi.fn().mockResolvedValue(undefined));
    const result=await provider.test({host:"camera.lan",username:"bewust-fout",password:"ook-fout"});
    expect(result).toMatchObject({success:false,tcpPortOpen:true,deviceApi:"NOT_CONFIRMED",authentication:"NOT_TESTED"});
    expect(JSON.stringify(result)).not.toContain("bewust-fout");
    expect(JSON.stringify(result)).not.toContain("ook-fout");
  });

  it("meldt een gesloten TCP-poort afzonderlijk van API en authenticatie", async () => {
    const error=Object.assign(new Error("refused"),{code:"ECONNREFUSED"});
    const provider=new DahuaTcpProvider(undefined,async()=>["192.168.1.20"],vi.fn().mockRejectedValue(error));
    await expect(provider.test({host:"camera.lan"})).resolves.toMatchObject({success:false,code:"PORT_CLOSED",tcpPortOpen:false,networkStatus:"UNREACHABLE",deviceApi:"UNKNOWN",authentication:"NOT_TESTED"});
  });

  it("classificeert een timeout zonder de caller te blokkeren", async () => {
    const error=Object.assign(new Error("timeout"),{code:"ETIMEDOUT"});
    const provider=new DahuaTcpProvider(undefined,async()=>["10.100.0.20"],vi.fn().mockRejectedValue(error));
    await expect(provider.test({host:"10.100.0.20",timeoutMs:50})).resolves.toMatchObject({success:false,code:"TIMEOUT",status:"OFFLINE",tcpPortOpen:false,networkStatus:"UNREACHABLE",deviceApi:"UNKNOWN",authentication:"NOT_TESTED"});
  });

  it("rapporteert een SDK-authenticatiefout zonder technische of geheime response", async () => {
    const sdk={inspect:vi.fn().mockResolvedValue({authenticated:false,category:"CAMERA" as const})};
    const provider=new DahuaTcpProvider(sdk,async()=>["192.168.1.20"],vi.fn().mockResolvedValue(undefined));
    const result=await provider.test({host:"192.168.1.20",username:"admin",password:"zeer-geheim"});
    expect(result).toMatchObject({success:false,status:"AUTH_FAILED",tcpPortOpen:true,networkStatus:"REACHABLE",deviceApi:"CONFIRMED",authentication:"FAILED",code:"AUTH_FAILED"});
    expect(JSON.stringify(result)).not.toContain("zeer-geheim");
  });

  it("neemt alleen door de officiële SDK bevestigde NVR-kanalen en capabilities over", async () => {
    const channels=[{number:1,name:"Poort",online:true,anpr:"SUPPORTED" as const},{number:2,name:"Oprit",online:false,anpr:"UNKNOWN" as const}];
    const sdk={inspect:vi.fn().mockResolvedValue({authenticated:true,category:"NVR" as const,model:"NVR-test",firmware:"1.2.3",channels,capabilities:{videoChannels:"SUPPORTED" as const,anprEvents:"UNKNOWN" as const}})};
    const provider=new DahuaTcpProvider(sdk,async()=>["192.168.1.20"],vi.fn().mockResolvedValue(undefined));
    const result=await provider.test({host:"192.168.1.20",category:"NVR"});
    expect(result).toMatchObject({success:true,status:"CONNECTED",networkStatus:"REACHABLE",deviceApi:"CONFIRMED",authentication:"SUCCESS",category:"NVR",model:"NVR-test",channels});
    expect(result.capabilities.videoChannels).toBe("SUPPORTED");
    expect(result.capabilities.alarmEvents).toBe("UNKNOWN");
  });

  it("rapporteert een door de officiële adapter afgewezen apparaattype als niet ondersteund", async () => {
    const sdk={inspect:vi.fn().mockResolvedValue({authenticated:false,supported:false})};
    const provider=new DahuaTcpProvider(sdk,async()=>["192.168.1.20"],vi.fn().mockResolvedValue(undefined));
    await expect(provider.test({host:"camera.lan"})).resolves.toMatchObject({success:false,tcpPortOpen:true,deviceApi:"NOT_SUPPORTED",authentication:"NOT_TESTED",code:"DEVICE_NOT_SUPPORTED"});
  });

  it("blokkeert loopback, link-local en multicast als SSRF-doel", () => {
    expect(isBlockedDeviceTarget("127.0.0.1")).toBe(true);
    expect(isBlockedDeviceTarget("169.254.169.254")).toBe(true);
    expect(isBlockedDeviceTarget("224.0.0.1")).toBe(true);
    expect(isBlockedDeviceTarget("192.168.178.210")).toBe(false);
  });

  it("levert nooit encrypted credentials via het publieke model", () => {
    const result=publicDeviceConnection({id:"x",host:"camera.lan",usernameEncrypted:"cipher-user",passwordEncrypted:"cipher-password"});
    expect(result).toMatchObject({id:"x",hasUsername:true,hasPassword:true});
    expect(JSON.stringify(result)).not.toContain("cipher");
  });
});
