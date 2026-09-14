import {it,expect} from "vitest";
import {payloadFor} from "./lib/notification-dispatcher.js";
const base={id:"fixture",cameraId:"fixture-camera",normalizedLicensePlate:"TEST12",reason:"Testgroep",timestamp:new Date("2026-07-14T12:42:16Z"),camera:{name:"Testcamera",vpnLocation:{timezone:"Europe/Amsterdam"}}};
it.each([["INCOMING","Inkomend"],["OUTGOING","Uitgaand"],["UNKNOWN",""]])("uses same direction and camera time in push: %s",(direction,label)=>{const payload=JSON.parse(payloadFor({...base,passage:{direction}}));expect(payload.body).toContain("14-07-2026 14:42:16");if(label)expect(payload.body).toContain(label);else expect(payload.body).not.toMatch(/Inkomend|Uitgaand/)});
