import { createHash } from "node:crypto";
import { z } from "zod";
import type { CameraDirectionMapping, VehicleColor, VehicleType } from "@prisma/client";
import { mapCameraDirection, normalizeLicensePlate, parseCameraTime, resolveDahuaDirection } from "@anpr/shared";
import type { EventImage, NormalizedAnprEvent } from "@anpr/shared/anpr-event";

// Narrow Picture-profile adapter. Hardware compatibility is separate from validation.
// Protocol sources, field semantics and remaining hardware checks: docs/itsapi-receiver.md.
const deviceId = z.string().min(1).max(128).refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127));
const text = z.string().trim().max(128);
const optionalText = text.nullish().catch(undefined);
const optionalInt = z.number().int().min(0).max(2_147_483_647).nullish().catch(undefined);
const image = z.object({ Content: z.string().max(10_666_668) }).passthrough();
const heartbeat = z.object({ Active: z.literal("keepAlive"), DeviceID: deviceId });
const tollgate = z.object({
  Picture: z.object({
    Plate: z.object({
      PlateNumber: text.min(2).max(64), IsExist: z.boolean().optional(),
      Confidence: z.number().int().min(0).max(255).nullish().catch(undefined),
      Channel: optionalInt,
    }),
    SnapInfo: z.object({
      DeviceID: deviceId, AccurateTime: optionalText, SnapTime: optionalText,
      Direction: z.union([text, z.number().int().min(0).max(255)]).nullish().catch(undefined), SnapAddress: optionalText, LanNo: optionalInt,
    }),
    Vehicle: z.object({ VehicleType: optionalText, VehicleColor: optionalText, VehicleSign: optionalText }).nullish().catch(undefined),
    NormalPic: image.nullish(), CutoutPic: image.nullish(), VehiclePic: image.nullish(),
  }),
});
export class ItsapiPayloadError extends Error {
  constructor(readonly code: string, readonly missing: string[] = [], readonly violations: ValidationViolation[] = []) { super(code); }
}
export type ValidationViolation = {
  path: string; reason: string; received: string; expected?: string;
  minimum?: number; maximum?: number; inclusive?: boolean;
};
const receivedType=(value:unknown)=>value===null?"null":Array.isArray(value)?"array":typeof value;
function schemaError(code: string, error: z.ZodError, body: unknown): ItsapiPayloadError {
  // Never serialize Zod messages, literal received values or arbitrary issue objects.
  // The path is schema-owned; only runtime types and static schema bounds survive.
  const violations: ValidationViolation[] = error.issues.slice(0, 24).map(issue => {
    let value: unknown = body;
    for (const segment of issue.path) {
      value = value !== null && typeof value === "object" && Object.hasOwn(value, segment)
        ? (value as Record<string | number, unknown>)[segment] : undefined;
    }
    const received = receivedType(value);
    const bounds = issue.code === "too_small" && typeof issue.minimum === "number"
      ? { minimum: issue.minimum, inclusive: issue.inclusive }
      : issue.code === "too_big" && typeof issue.maximum === "number"
        ? { maximum: issue.maximum, inclusive: issue.inclusive } : {};
    const expected = issue.code === "invalid_type" ? issue.expected
      : issue.code === "too_small" || issue.code === "too_big" ? issue.type
        : issue.code === "invalid_literal" ? typeof issue.expected : issue.code === "custom" && issue.path.at(-1) === "DeviceID" ? "string" : undefined;
    return { path: issue.path.join("."),
      reason: issue.code === "invalid_type" && issue.received === "undefined" ? "MISSING" : issue.code,
      received, ...(expected ? { expected } : {}), ...bounds,
    };
  });
  return new ItsapiPayloadError(code, violations.filter(v => v.reason === "MISSING").map(v => v.path), violations);
}
const colors: Record<string, VehicleColor> = { black:"BLACK",white:"WHITE",gray:"GRAY",grey:"GRAY",silver:"SILVER",red:"RED",blue:"BLUE",green:"GREEN",yellow:"YELLOW",brown:"BROWN",orange:"ORANGE" };
const types: Record<string, VehicleType> = { car:"CAR",salooncar:"CAR",passengercar:"CAR",sedan:"CAR",suv:"CAR",mpv:"CAR",van:"VAN",pickup:"VAN",truck:"TRUCK",bus:"BUS",motorcycle:"MOTORCYCLE",motorbike:"MOTORCYCLE",trailer:"TRAILER" };

function decodeImage(value: { Content?: string } | null | undefined, path: string): EventImage | undefined {
  if (!value?.Content) return;
  const content = value.Content;
  const invalid=()=>new ItsapiPayloadError("INVALID_IMAGE",[],[{path,reason:"invalid_image",expected:"string",received:"string"}]);
  // No URLs, data URLs, camera filenames or permissive base64 decoding.
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw invalid();
  const data = Buffer.from(content, "base64");
  if (data.toString("base64") !== content || data.length < 4 || data.length > 8_000_000 || data[0] !== 255 || data[1] !== 216 || data.at(-2) !== 255 || data.at(-1) !== 217) throw invalid();
  return { contentType: "image/jpeg", data };
}

export function parseItsapiHeartbeat(body: unknown): { deviceId: string } {
  const result = heartbeat.safeParse(body);
  if (!result.success) throw schemaError("UNSUPPORTED_HEARTBEAT_PAYLOAD", result.error, body);
  return { deviceId: result.data.DeviceID };
}

export function parseItsapiTollgate(body: unknown, camera: { id: string; timezone: string; directionMapping: CameraDirectionMapping }): { deviceId: string; event: NormalizedAnprEvent } {
  const result = tollgate.safeParse(body);
  if (!result.success) throw schemaError("UNSUPPORTED_TOLLGATE_PAYLOAD", result.error, body);
  const p = result.data.Picture, snap = p.SnapInfo;
  const normalizedPlate = normalizeLicensePlate(p.Plate.PlateNumber);
  if (p.Plate.IsExist === false) throw new ItsapiPayloadError("INVALID_PLATE",[],[{path:"Picture.Plate.IsExist",reason:"plate_not_present",expected:"boolean",received:"boolean"}]);
  if (normalizedPlate.length < 2 || normalizedPlate.length > 20) throw new ItsapiPayloadError("INVALID_PLATE",[],[{path:"Picture.Plate.PlateNumber",reason:"invalid_plate",expected:"string",received:"string",minimum:2,maximum:20,inclusive:true}]);
  // AccurateTime is the existing Picture profile's subsecond capture time;
  // SnapTime is its second-precision fallback. Keep the event-key input stable.
  const parseTime = (value: string | null | undefined) => {
    const fraction = value?.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\.(\d{1,3})$/);
    const base = parseCameraTime(fraction?.[1] ?? value ?? undefined, camera.timezone);
    return base && Number.isFinite(base.getTime())
      ? new Date(base.getTime() + (fraction ? Number(fraction[2]!.padEnd(3, "0")) : 0)) : undefined;
  };
  const accurateTime = parseTime(snap.AccurateTime);
  const occurredAt = accurateTime ?? parseTime(snap.SnapTime);
  if (!occurredAt) {
    const rawSnap=(body as {Picture:{SnapInfo:Record<string,unknown>}}).Picture.SnapInfo;
    throw new ItsapiPayloadError("INVALID_EVENT_TIME", [], ["AccurateTime","SnapTime"].map(key=>({path:`Picture.SnapInfo.${key}`,reason:"invalid_event_time",expected:"string",received:receivedType(rawSnap[key])})));
  }
  // Other ITSAPI field layouts require an actual profile capture before mapping.
  const resolvedDirection = resolveDahuaDirection([{ field: "Picture.SnapInfo.Direction", value: snap.Direction }], "ITSAPI_SNAP");
  const sourceDirection = resolvedDirection.sourceDirection;
  const sourceEventId = `itsapi:picture:v1:${createHash("sha256").update(JSON.stringify([
    camera.id, snap.DeviceID, occurredAt.toISOString(), normalizedPlate, p.Plate.Channel ?? 0,
  ])).digest("hex")}`;
  return { deviceId: snap.DeviceID, event: {
    cameraId: camera.id, originalPlate: p.Plate.PlateNumber, normalizedPlate, occurredAt,
    source: "DAHUA_CAMERA", sourceEventId,
    confidence: p.Plate.Confidence == null ? undefined : p.Plate.Confidence / 255,
    vehicleType: p.Vehicle?.VehicleType ? types[p.Vehicle.VehicleType.toLowerCase()] ?? "UNKNOWN" : undefined,
    vehicleColor: p.Vehicle?.VehicleColor ? colors[p.Vehicle.VehicleColor.toLowerCase()] ?? "OTHER" : undefined,
    vehicleBrand: p.Vehicle?.VehicleSign || undefined,
    sourceDirection, direction: mapCameraDirection(sourceDirection, camera.directionMapping),
    lane: snap.LanNo ?? undefined, location: snap.SnapAddress || undefined,
    overviewImage: decodeImage(p.NormalPic,"Picture.NormalPic.Content"), plateImage: decodeImage(p.CutoutPic,"Picture.CutoutPic.Content"), extraImage: decodeImage(p.VehiclePic,"Picture.VehiclePic.Content"),
    rawMetadata: { provider:"DAHUA_ITSAPI", profile:"picture-v1", timeZone:camera.timezone, directionMapping:camera.directionMapping,
      timeSource:accurateTime ? "AccurateTime" : "SnapTime", confidenceScale:255,
      ...(snap.Direction != null ? { rawDirection:snap.Direction } : {}),
      rawDirectionField: resolvedDirection.field ?? "NOT_RECEIVED", directionStatus: resolvedDirection.status,
    },
  } };
}
