import { describe, expect, it } from "vitest";
import { dahuaDirectionEvidence, resolveDahuaDirection } from "./dahua-direction.js";

describe("Dahua travel direction evidence", () => {
  it.each([["Approach","TOWARD_CAMERA"],["Leave","AWAY_FROM_CAMERA"],["In","TOWARD_CAMERA"],["Out","AWAY_FROM_CAMERA"]])("maps explicit %s", (value,expected) => {
    expect(resolveDahuaDirection([{field:"Direction",value}]).sourceDirection).toBe(expected);
  });
  it.each([0,1,2,"0","1","2","Approaching","Leaving","Reverse","Obverse","Head","FutureFirmware",undefined])("does not guess %s", value => {
    expect(resolveDahuaDirection([{field:"Direction",value}]).sourceDirection).toBeUndefined();
  });
  it.each([["Obverse","TOWARD_CAMERA"],["Reverse","AWAY_FROM_CAMERA"],[" oBvErSe ","TOWARD_CAMERA"],[" REVERSE ","AWAY_FROM_CAMERA"],["Unknown",undefined],[undefined,undefined],["FutureFirmware",undefined],[0,undefined]])("maps ITSAPI SnapInfo %s only in its profile", (value,expected) => {
    expect(resolveDahuaDirection([{field:"Picture.SnapInfo.Direction",value}],"ITSAPI_SNAP").sourceDirection).toBe(expected);
  });
  it("rejects conflicting explicit directions", () => {
    expect(resolveDahuaDirection([{field:"DrivingDirection[0]",value:"Approach"},{field:"Direction",value:"Leave"}])).toMatchObject({status:"CONFLICTING_VALUES",sourceDirection:undefined});
  });
  it("records nested direction type/value but never road names, plates, credentials or images", () => {
    const evidence=dahuaDirectionEvidence({Picture:{SnapInfo:{Direction:0,DrivingDirection:["Approach","PRIVATE_ROAD_A","PRIVATE_ROAD_B"],CaptureDirection:"Approaching",SnapDirection:"SECRET123",VehicleDirection:"Head"},Plate:{PlateNumber:"PRIVATE_PLATE"},NormalPic:{Content:"PRIVATE_IMAGE"},Password:{Direction:"Approach"},DeviceID:"PRIVATE_DEVICE"},secretDirection:"PRIVATE_CREDENTIAL"});
    expect(evidence).toContainEqual({field:"Picture.SnapInfo.Direction",type:"number",value:0});
    expect(evidence).toContainEqual({field:"Picture.SnapInfo.CaptureDirection",type:"string",value:"Approaching"});
    expect(JSON.stringify(evidence)).not.toMatch(/PRIVATE|SECRET123|Password|NormalPic|Content|PlateNumber|DeviceID|secretDirection/);
    expect(evidence.find(item=>item.field.endsWith("DrivingDirection[1]"))).toMatchObject({valueOmitted:true});
  });
  it("finds the real camera's late-positioned CGI direction fields", () => {
    const fields=Object.fromEntries(Array.from({length:100},(_,i)=>[`Field${i}`,"private"]));
    fields["Events[0].TrafficCar.DrivingDirection[0]"]="Approach";
    expect(dahuaDirectionEvidence(fields)).toContainEqual({field:"Events[0].TrafficCar.DrivingDirection[0]",type:"string",value:"Approach"});
  });
  it("records CGI flattened fields and bounds arbitrary input", () => {
    expect(dahuaDirectionEvidence({"Events[0].TrafficCar.Direction":"0"})).toEqual([{field:"Events[0].TrafficCar.Direction",type:"string",value:"0"}]);
    expect(dahuaDirectionEvidence(Array.from({length:1000},()=>({Direction:"Approach"}))).length).toBeLessThanOrEqual(20);
    expect(dahuaDirectionEvidence(null)).toEqual([]);
  });
});
