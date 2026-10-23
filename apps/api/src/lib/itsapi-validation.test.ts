import { describe, expect, it } from "vitest";
import { ItsapiPayloadError, parseItsapiHeartbeat, parseItsapiTollgate } from "./itsapi-parser.js";
const camera={id:"synthetic-camera",timezone:"Europe/Amsterdam",directionMapping:"TOWARD_CAMERA_IS_INCOMING" as const};
// Synthetic values inside the field structure reported by the user, not a production capture.
const profile=():any=>({Picture:{
  NormalPic:{Content:Buffer.from([255,216,255,217]).toString("base64")},
  CutoutPic:{Content:Buffer.from([255,216,255,217]).toString("base64")},
  Plate:{PlateNumber:"TEST123",IsExist:true,Confidence:204,Channel:0},
  SnapInfo:{DeviceID:"synthetic-device",Direction:"Approach",AccurateTime:"2026-10-23 12:00:00.123",SnapTime:"2026-10-23 12:00:00",SnapAddress:"Synthetic",LanNo:1},
  Vehicle:{VehicleColor:"Blue",VehicleSign:"Synthetic",VehicleType:"Car"},
}});
function errorFor(body:unknown) {
  try{parseItsapiTollgate(body,camera)}catch(error){if(error instanceof ItsapiPayloadError)return error;throw error}
  throw new Error("Expected payload rejection");
}
function set(body:any,path:string,value:unknown) {
  const segments=path.split("."),last=segments.pop()!;
  segments.reduce((parent,key)=>parent[key],body)[last]=value;
}
describe("gerapporteerde Staverhul-veldstructuur en concrete Zod-diagnose",()=>{
  it("accepteert de gemelde veldtypen met geldige synthetische inhoud",()=>{
    expect(parseItsapiTollgate(profile(),camera).event.normalizedPlate).toBe("TEST123");
  });
  it.each([
    ["Picture",null,"object","null"],
    ["Picture.Plate",[],"object","array"],
    ["Picture.SnapInfo",null,"object","null"],
    ["Picture.Plate.IsExist",null,"boolean","null"],
    ["Picture.Plate.IsExist",1,"boolean","number"],
    ["Picture.NormalPic.Content",null,"string","null"],
    ["Picture.CutoutPic.Content",[],"string","array"],
    ["Picture.VehiclePic",[],"object","array"],
    ["Picture.VehiclePic",{},"string","undefined"],
  ])("wijst %s gericht af zonder berichtwaarden",(path,value,expected,received)=>{
    const body=profile();set(body,path,value);const error=errorFor(body);
    expect(error.code).toBe("UNSUPPORTED_TOLLGATE_PAYLOAD");
    expect(error.violations).toEqual([{path:path==="Picture.VehiclePic" && received==="undefined"?`${path}.Content`:path,reason:received==="undefined"?"MISSING":"invalid_type",expected,received}]);
    expect(JSON.stringify(error)).not.toMatch(/TEST123|synthetic-device|Synthetic|\/9j\/2Q/);
  });
  it.each([
    ["Picture.Plate.PlateNumber","X".repeat(65),"too_big",{maximum:64}],
    ["Picture.Plate.PlateNumber"," ","too_small",{minimum:2}],
    ["Picture.SnapInfo.DeviceID","D".repeat(129),"too_big",{maximum:128}],
  ])("toont de schemagrens voor %s zonder lengte of inhoud te bewaren",(path,value,reason,bound)=>{
    const body=profile();set(body,path,value);const error=errorFor(body);
    expect(error.violations).toEqual([{path,reason,expected:"string",received:"string",inclusive:true,...bound}]);
    expect(error.missing).toEqual([]);
  });
  it("meldt verboden controletekens als custom-fout zonder Device ID",()=>{
    const body=profile();body.Picture.SnapInfo.DeviceID="PRIVATE_DEVICE\n";
    expect(errorFor(body).violations).toEqual([{path:"Picture.SnapInfo.DeviceID",reason:"custom",expected:"string",received:"string"}]);
    expect(JSON.stringify(errorFor(body))).not.toContain("PRIVATE_DEVICE");
  });
  it.each(["NormalPic","CutoutPic","VehiclePic"])("accepteert ontbrekend of null optioneel %s maar geen ontbrekende Content in een object",field=>{
    const body=profile();body.Picture[field]=null;expect(()=>parseItsapiTollgate(body,camera)).not.toThrow();
    delete body.Picture[field];expect(()=>parseItsapiTollgate(body,camera)).not.toThrow();
    body.Picture[field]={};expect(errorFor(body).missing).toEqual([`Picture.${field}.Content`]);
  });
  it("laat bestaande tolerante optionele metadata geen schemaverwerping veroorzaken",()=>{
    const body=profile();Object.assign(body.Picture.Plate,{Confidence:999,Channel:[]});
    Object.assign(body.Picture.SnapInfo,{Direction:[],LanNo:"wrong-type",SnapAddress:{}});body.Picture.Vehicle=[];
    expect(()=>parseItsapiTollgate(body,camera)).not.toThrow();
  });
  it("maakt schemavalidatie en latere JPEG-, tijd- en kentekenvalidatie onderscheidbaar",()=>{
    const image=profile();image.Picture.NormalPic.Content="PRIVATE_INVALID_IMAGE";
    expect(errorFor(image).code).toBe("INVALID_IMAGE");
    const time=profile();time.Picture.SnapInfo.AccurateTime="PRIVATE_TIME";time.Picture.SnapInfo.SnapTime="PRIVATE_TIME";
    expect(errorFor(time).code).toBe("INVALID_EVENT_TIME");
    const plate=profile();plate.Picture.Plate.IsExist=false;expect(errorFor(plate).code).toBe("INVALID_PLATE");
  });
  it("neemt bij een literal-fout nooit Zods ontvangen string over",()=>{
    try{parseItsapiHeartbeat({Active:"PRIVATE_TOKEN",DeviceID:"PRIVATE_DEVICE"});throw new Error("Expected rejection")}catch(error){
      expect(error).toBeInstanceOf(ItsapiPayloadError);
      expect((error as ItsapiPayloadError).violations).toEqual([{path:"Active",reason:"invalid_literal",expected:"string",received:"string"}]);
      expect(JSON.stringify(error)).not.toMatch(/PRIVATE_TOKEN|PRIVATE_DEVICE/);
    }
  });
});
