import {describe,expect,it} from "vitest";
import {splitDahuaImages} from "./dahua-images.js";
// Field structure observed on real ITC413 CGI event 2026-09-12; bytes and lengths below are synthetic.
const original=Buffer.from([255,216,1,255,217]),plate=Buffer.from([255,216,2,255,217]),vehicle=Buffer.from([255,216,3,255,217]);
const fields={"Events[0].SceneImage.Offset":"0","Events[0].SceneImage.Length":"5","Events[0].Object.ObjectType":"Plate","Events[0].Object.Image.Offset":"5","Events[0].Object.Image.Length":"5","Events[0].Vehicle.Image.Offset":"10","Events[0].Vehicle.Image.Length":"5"};
describe("Dahua samengestelde CGI-JPEG",()=>{
 it("splitst de drie bewezen offsetgebieden zonder beeldsoorten op volgorde te gokken",()=>{const r=splitDahuaImages(fields,Buffer.concat([original,plate,vehicle]));expect(r.overviewImage?.data).toEqual(original);expect(r.plateImage?.data).toEqual(plate);expect(r.extraImage?.data).toEqual(vehicle);expect(r.diagnostics).toEqual({ORIGINAL:"RECEIVED",PLATE_CUTOUT:"RECEIVED",VEHICLE_BODY_CUTOUT:"RECEIVED"})});
 it("laat ontbrekende uitsneden de overzichtsfoto niet blokkeren",()=>{const r=splitDahuaImages({...fields,"Events[0].Object.Image.Length":"0","Events[0].Vehicle.Image.Length":"0"},original);expect(r.overviewImage).toBeTruthy();expect(r.plateImage).toBeUndefined();expect(r.diagnostics.PLATE_CUTOUT).toBe("NOT_RECEIVED")});
 it.each(["-1","9007199254740992","1000","NaN"])("weigert onveilige offset %s",offset=>{const r=splitDahuaImages({...fields,"Events[0].Object.Image.Offset":offset},Buffer.concat([original,plate,vehicle]));expect(r.plateImage).toBeUndefined();expect(r.diagnostics.PLATE_CUTOUT).toBe("INVALID_IMAGE_RANGE")});
 it("weigert niet-JPEG-uitsnede en een Object dat geen kenteken is",()=>{const r=splitDahuaImages(fields,Buffer.concat([original,Buffer.alloc(5),vehicle]));expect(r.diagnostics.PLATE_CUTOUT).toBe("INVALID_JPEG");expect(splitDahuaImages({...fields,"Events[0].Object.ObjectType":"Person"},Buffer.concat([original,plate,vehicle])).plateImage).toBeUndefined()});
});
