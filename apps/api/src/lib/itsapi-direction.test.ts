import { describe, expect, it } from "vitest";
import { parseItsapiTollgate } from "./itsapi-parser.js";

// Observed production subset: Picture.SnapInfo.Direction=Obverse/Reverse.
// No complete captured payload is available; all other required values are synthetic.
const payload=(Direction:unknown)=>({Picture:{Plate:{PlateNumber:"TEST12"},SnapInfo:{DeviceID:"fixture",SnapTime:"2026-10-20 12:00:00",Direction}}});
const normal={id:"camera-a",timezone:"Europe/Amsterdam",directionMapping:"TOWARD_CAMERA_IS_INCOMING" as const};
const reversed={...normal,id:"camera-b",directionMapping:"AWAY_FROM_CAMERA_IS_INCOMING" as const};
describe("independent ITSAPI camera direction settings",()=>{
  it.each([["Obverse","INCOMING","OUTGOING"],["Reverse","OUTGOING","INCOMING"],["Unknown","UNKNOWN","UNKNOWN"],[undefined,"UNKNOWN","UNKNOWN"]])("keeps %s independent across cameras and configuration changes",(value,a,b)=>{
    const first=parseItsapiTollgate(payload(value),normal).event;
    expect(first.direction).toBe(a);
    expect(parseItsapiTollgate(payload(value),reversed).event.direction).toBe(b);
    expect(parseItsapiTollgate(payload(value),normal).event.direction).toBe(a);
    expect(parseItsapiTollgate(payload(value),{...normal,directionMapping:reversed.directionMapping}).event.direction).toBe(b);
    expect(first.direction).toBe(a); // Already created events are immutable to later settings.
  });
});
