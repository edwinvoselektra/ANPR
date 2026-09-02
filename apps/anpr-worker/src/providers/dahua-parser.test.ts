import { describe, expect, it } from "vitest";
import { imageKind, normalizeDahuaEvent, parseDahuaFields } from "./dahua-parser.js";
import type { ManagedAnprCamera } from "../types.js";

const camera: ManagedAnprCamera = {
  id:"11111111-1111-4111-8111-111111111111",name:"TEST camera",location:"TEST locatie",direction:"INCOMING",
  rtspHost:"192.0.2.10",rtspUsernameEncrypted:null,rtspPasswordEncrypted:null,anprProvider:"DAHUA_CGI",
  anprHttpProtocol:"http",anprHttpPort:80,anprChannel:1,updatedAt:new Date("2026-09-02T12:00:00Z")
};

describe("Dahua TrafficJunction parser",()=>{
  it("normaliseert een gedocumenteerd key/value-event naar het interne model",()=>{
    const fields=parseDahuaFields(Buffer.from([
      "Events[0].Code=TrafficJunction","Events[0].Action=Pulse","Events[0].GroupID=9001",
      "Events[0].UTC=2026-09-02T12:30:00.000Z","Events[0].TrafficCar.PlateNumber=12-ab cd",
      "Events[0].PlateInfo.Confidence=97","Events[0].TrafficCar.VehicleColor=Blue",
      "Events[0].TrafficCar.VehicleType=Sedan","Events[0].TrafficCar.VehicleSign=Volvo","Events[0].Lane=1"
    ].join("\r\n")));
    const event=normalizeDahuaEvent(camera,{fields});
    expect(event).toMatchObject({cameraId:camera.id,originalPlate:"12-ab cd",normalizedPlate:"12ABCD",confidence:.97,vehicleColor:"BLUE",vehicleType:"CAR",vehicleBrand:"Volvo",lane:1,source:"DAHUA_CAMERA",sourceEventId:"9001:2026-09-02T12:30:00.000Z"});
  });
  it("accepteert ontbrekende optionele metadata",()=>{
    const event=normalizeDahuaEvent(camera,{fields:{"Events[0].Code":"TrafficJunction","Events[0].Object.Text":"TE-ST-1"}},new Date("2026-09-02T12:00:00Z"));
    expect(event).toMatchObject({normalizedPlate:"TEST1",occurredAt:new Date("2026-09-02T12:00:00Z")});
    expect(event?.vehicleBrand).toBeUndefined();
  });
  it("weigert andere events en events zonder bruikbaar kenteken",()=>{
    expect(normalizeDahuaEvent(camera,{fields:{"Events[0].Code":"VideoMotion","Events[0].Object.Text":"TEST1"}})).toBeNull();
    expect(normalizeDahuaEvent(camera,{fields:{"Events[0].Code":"TrafficJunction"}})).toBeNull();
  });
  it("neemt alleen veilige Dahua eventkeys over",()=>{
    const fields=parseDahuaFields(Buffer.from("Authorization=secret\r\nEvents[0].Code=TrafficJunction\r\nEvents[0].Password=secret"));
    expect(fields.Authorization).toBeUndefined();
    const event=normalizeDahuaEvent(camera,{fields:{...fields,"Events[0].Object.Text":"TEST1"}});
    expect(JSON.stringify(event?.rawMetadata)).not.toContain("secret");
  });
  it("herkent een expliciete plate-crop header",()=>expect(imageKind({"content-type":"image/jpeg","content-disposition":"attachment; filename=plate.jpg"})).toBe("plate"));
});
