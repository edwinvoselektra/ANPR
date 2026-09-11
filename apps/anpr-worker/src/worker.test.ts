import { describe, expect, it, vi } from "vitest";
import { AnprSupervisor, reconnectDelay, runCameraLoop } from "./worker.js";
const logger={info:vi.fn(),warn:vi.fn(),error:vi.fn()};
const camera=(id:string)=>({id,name:`TEST ${id}`,location:"TEST",direction:"INCOMING" as const,rtspHost:"192.0.2.1",rtspUsernameEncrypted:null,rtspPasswordEncrypted:null,anprProvider:"DAHUA_CGI" as const,anprHttpProtocol:"http",anprHttpPort:80,anprChannel:1,updatedAt:new Date()});
describe("ANPR reconnect en isolatie",()=>{
  it("begrens exponential backoff met jitter",()=>{expect(reconnectDelay(0,2000,60000,()=>.5)).toBe(2000);expect(reconnectDelay(20,2000,60000,()=>.5)).toBe(60000)});
  it("probeert na een streamfout opnieuw",async()=>{const controller=new AbortController();const provider:any={kind:"DAHUA_CGI",connect:vi.fn().mockRejectedValue(new Error("NETWORK"))};const repository:any={markConnecting:vi.fn().mockResolvedValue(undefined),markConnected:vi.fn().mockResolvedValue(undefined),markDisconnected:vi.fn().mockResolvedValue(undefined)};const sleep=vi.fn(async()=>controller.abort());await runCameraLoop({camera:camera("1"),provider,repository,onEvent:vi.fn(),minRetryMs:1000,maxRetryMs:10000,signal:controller.signal,logger,wait:sleep,random:()=>.5});expect(repository.markDisconnected).toHaveBeenCalled();expect(sleep).toHaveBeenCalledWith(1000,controller.signal)});
  it("start voor meerdere camera's afzonderlijke loops",async()=>{const cameras=[camera("1"),camera("2")];const repository:any={listEnabled:vi.fn().mockResolvedValue(cameras),markDisabled:vi.fn()};const started:string[]=[];const runLoop:any=vi.fn(async({camera:current}:any)=>{started.push(current.id)});const supervisor=new AnprSupervisor({repository,providers:new Map([["DAHUA_CGI",{kind:"DAHUA_CGI"} as any]]),onEvent:vi.fn(),minRetryMs:1,maxRetryMs:2,logger,runLoop});await supervisor.reconcile();expect(started.sort()).toEqual(["1","2"]);expect(supervisor.snapshot().managedCameras).toBe(2);await supervisor.stop()});
});

it("backs off when an accepted stream immediately closes", async () => {
  const controller = new AbortController();
  const delays: number[] = [];
  const provider: any = { connect: async (_camera: unknown, handlers: any) => handlers.onConnected() };
  const repository: any = { markConnecting: vi.fn(), markConnected: vi.fn(), markDisconnected: vi.fn() };
  await runCameraLoop({ camera: camera("1"), provider, repository, onEvent: vi.fn(), minRetryMs: 1000, maxRetryMs: 10000, signal: controller.signal, logger, random: () => .5, wait: async delay => { delays.push(delay); if (delays.length === 3) controller.abort(); } });
  expect(delays).toEqual([1000, 2000, 4000]);
});
