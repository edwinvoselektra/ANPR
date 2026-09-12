import { describe, expect, it, vi } from "vitest";
import { DahuaAnprProvider } from "./dahua.js";
import type { ManagedAnprCamera } from "../types.js";

const camera:ManagedAnprCamera={id:"11111111-1111-4111-8111-111111111111",name:"TEST Dahua",location:"TEST",direction:"INCOMING",rtspHost:"192.0.2.20",rtspUsernameEncrypted:null,rtspPasswordEncrypted:null,anprProvider:"DAHUA_CGI",anprHttpProtocol:"http",anprHttpPort:80,anprChannel:1,updatedAt:new Date()};
describe("Dahua provider adapter",()=>{
  it("bouwt alleen de vaste gedocumenteerde stream en koppelt het event aan de databasecamera",async()=>{const openStream=vi.fn().mockResolvedValue({headers:{"content-type":"multipart/x-mixed-replace; boundary=test"}});const consume=vi.fn(async(_response:any,options:any)=>{await options.onPart({headers:{"content-type":"text/plain"},body:Buffer.from("Events[0].Code=TrafficJunction\r\nEvents[0].Action=Pulse\r\nEvents[0].GroupID=TEST-22\r\nEvents[0].PTS=12345\r\nEvents[0].Object.Text=12-ABC-3")})});const onConnected=vi.fn();const onEvent=vi.fn();const provider=new DahuaAnprProvider({keyHex:"0".repeat(64),timeoutMs:1000,maxPartBytes:1000,settleMs:0,logger:{info:vi.fn(),warn:vi.fn(),error:vi.fn()},openStream,consume});await provider.connect(camera,{onConnected,onEvent},new AbortController().signal);expect(openStream).toHaveBeenCalledWith(expect.objectContaining({host:"192.0.2.20",port:80,path:"/cgi-bin/snapManager.cgi?action=attachFileProc&channel=1&heartbeat=5&Flags[0]=Event&Events=[TrafficJunction]"}));expect(onConnected).toHaveBeenCalledOnce();expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({cameraId:camera.id,normalizedPlate:"12ABC3",sourceEventId:"TEST-22:12345"}))});
  it("koppelt drie samengestelde JPEG-uitsneden aan één gebeurtenis",async()=>{
    const jpeg=(n:number)=>Buffer.from([255,216,n,255,217]);
    const fields=["Events[0].Code=TrafficJunction","Events[0].Object.Text=TEST123","Events[0].Object.ObjectType=Plate","Events[0].SceneImage.Offset=0","Events[0].SceneImage.Length=5","Events[0].Object.Image.Offset=5","Events[0].Object.Image.Length=5","Events[0].Vehicle.Image.Offset=10","Events[0].Vehicle.Image.Length=5"].join("\r\n");
    const consume=vi.fn(async(_response:any,options:any)=>{await options.onPart({headers:{"content-type":"text/plain"},body:Buffer.from(fields)});await options.onPart({headers:{"content-type":"image/jpeg"},body:Buffer.concat([jpeg(1),jpeg(2),jpeg(3)])})});
    const onEvent=vi.fn();const provider=new DahuaAnprProvider({keyHex:"0".repeat(64),timeoutMs:1000,maxPartBytes:1000,logger:{info:vi.fn(),warn:vi.fn(),error:vi.fn()},openStream:vi.fn().mockResolvedValue({headers:{"content-type":"multipart/x-mixed-replace; boundary=test"}}),consume});
    await provider.connect(camera,{onConnected:vi.fn(),onEvent},new AbortController().signal);
    expect(onEvent).toHaveBeenCalledOnce();expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({overviewImage:{contentType:"image/jpeg",data:jpeg(1)},plateImage:{contentType:"image/jpeg",data:jpeg(2)},extraImage:{contentType:"image/jpeg",data:jpeg(3)},rawMetadata:expect.objectContaining({imagePlateStatus:"RECEIVED",imageVehicleStatus:"RECEIVED"})}));
  });
});
