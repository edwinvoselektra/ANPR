import type { EventImage } from "../types.js";

type Fields = Record<string, string>;
const value = (fields: Fields, suffix: string) => Object.entries(fields).find(([key]) => key.endsWith(`.${suffix}`))?.[1];
const integer = (text: string | undefined) => text !== undefined && /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : undefined;
export function splitDahuaImages(fields: Fields, body: Buffer) {
  const diagnostics: Record<string,string> = {};
  let declared = false;
  // These exact fields/offsets were observed and JPEG boundaries verified on the ITC413 CGI stream.
  // This does not claim an ITSAPI TollgateInfo image mapping.
  function slice(prefix: string, kind: string): EventImage | undefined {
    const rawLength = value(fields,`${prefix}.Length`), rawOffset = value(fields,`${prefix}.Offset`);
    if (rawLength === undefined && rawOffset === undefined) { diagnostics[kind]="NOT_RECEIVED"; return; }
    declared = true;
    const length=integer(rawLength), offset=integer(rawOffset);
    if (length===0) { diagnostics[kind]="NOT_RECEIVED"; return; }
    if (length===undefined || offset===undefined || length<4 || offset>body.length || length>body.length-offset) { diagnostics[kind]="INVALID_IMAGE_RANGE"; return; }
    const data=body.subarray(offset,offset+length);
    if (data[0]!==0xff || data[1]!==0xd8 || data.at(-2)!==0xff || data.at(-1)!==0xd9) { diagnostics[kind]="INVALID_JPEG"; return; }
    diagnostics[kind]="RECEIVED";
    return {contentType:"image/jpeg",data};
  }
  const overviewImage=slice("SceneImage","ORIGINAL");
  // Object.Image can describe other objects on other cameras; require the observed Plate type.
  let plateImage: EventImage | undefined;
  if(value(fields,"Object.ObjectType")?.toLowerCase()==="plate") plateImage=slice("Object.Image","PLATE_CUTOUT");
  else diagnostics.PLATE_CUTOUT="NOT_IDENTIFIED_AS_PLATE";
  let extraImage=slice("Vehicle.Image","VEHICLE_BODY_CUTOUT");
  if(!extraImage && value(fields,"Vehicle.Image.Length")===undefined) extraImage=slice("CommInfo.VehicleBody","VEHICLE_BODY_CUTOUT");
  return {declared,overviewImage,plateImage,extraImage,diagnostics};
}
