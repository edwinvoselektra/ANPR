import { createHash } from "node:crypto";
import { z } from "zod";
import type { CameraDirectionMapping, VehicleColor, VehicleType } from "@prisma/client";
import { mapCameraDirection, normalizeLicensePlate, parseCameraTime } from "@anpr/shared";
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
      Direction: optionalText, SnapAddress: optionalText, LanNo: optionalInt,
    }),
    Vehicle: z.object({ VehicleType: optionalText, VehicleColor: optionalText, VehicleSign: optionalText }).nullish().catch(undefined),
    NormalPic: image.nullish(), CutoutPic: image.nullish(), VehiclePic: image.nullish(),
  }),
});
export class ItsapiPayloadError extends Error {
  constructor(readonly code: string, readonly missing: string[] = []) { super(code); }
}
const colors: Record<string, VehicleColor> = { black:"BLACK",white:"WHITE",gray:"GRAY",grey:"GRAY",silver:"SILVER",red:"RED",blue:"BLUE",green:"GREEN",yellow:"YELLOW",brown:"BROWN",orange:"ORANGE" };
const types: Record<string, VehicleType> = { car:"CAR",salooncar:"CAR",passengercar:"CAR",sedan:"CAR",suv:"CAR",mpv:"CAR",van:"VAN",pickup:"VAN",truck:"TRUCK",bus:"BUS",motorcycle:"MOTORCYCLE",motorbike:"MOTORCYCLE",trailer:"TRAILER" };

function decodeImage(value: { Content?: string } | null | undefined): EventImage | undefined {
  if (!value?.Content) return;
  const content = value.Content;
  // No URLs, data URLs, camera filenames or permissive base64 decoding.
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new ItsapiPayloadError("INVALID_IMAGE");
  const data = Buffer.from(content, "base64");
  if (data.toString("base64") !== content || data.length < 4 || data.length > 8_000_000 || data[0] !== 255 || data[1] !== 216 || data.at(-2) !== 255 || data.at(-1) !== 217) throw new ItsapiPayloadError("INVALID_IMAGE");
  return { contentType: "image/jpeg", data };
}

export function parseItsapiHeartbeat(body: unknown): { deviceId: string } {
  const result = heartbeat.safeParse(body);
  if (!result.success) throw new ItsapiPayloadError("UNSUPPORTED_HEARTBEAT_PAYLOAD", ["Active=keepAlive", "DeviceID"]);
  return { deviceId: result.data.DeviceID };
}

export function parseItsapiTollgate(body: unknown, camera: { id: string; timezone: string; directionMapping: CameraDirectionMapping }): { deviceId: string; event: NormalizedAnprEvent } {
  const result = tollgate.safeParse(body);
  if (!result.success) throw new ItsapiPayloadError("UNSUPPORTED_TOLLGATE_PAYLOAD", ["Picture.Plate.PlateNumber", "Picture.SnapInfo.DeviceID", "Picture.SnapInfo.AccurateTime or SnapTime", "optional images: base64 JPEG Content"]);
  const p = result.data.Picture, snap = p.SnapInfo;
  const normalizedPlate = normalizeLicensePlate(p.Plate.PlateNumber);
  if (p.Plate.IsExist === false || normalizedPlate.length < 2 || normalizedPlate.length > 20) throw new ItsapiPayloadError("INVALID_PLATE");
  // Milliseconds are significant for idempotence. Never substitute the receive time.
  const rawTime = snap.AccurateTime || snap.SnapTime;
  const fraction = rawTime?.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\.(\d{1,3})$/);
  const baseTime = parseCameraTime(fraction?.[1] ?? rawTime ?? undefined, camera.timezone);
  if (!baseTime || !Number.isFinite(baseTime.getTime())) throw new ItsapiPayloadError("INVALID_EVENT_TIME", ["Picture.SnapInfo.AccurateTime or SnapTime (unambiguous camera-local time)"]);
  const occurredAt = new Date(baseTime.getTime() + (fraction ? Number(fraction[2]!.padEnd(3, "0")) : 0));
  const direction = snap.Direction?.trim().toLowerCase();
  // Forward/reverse are retained as metadata: their relation to the configured road
  // direction is not established. Only explicit approach/away values are mapped.
  const sourceDirection = direction === "approach" || direction === "incoming" ? "TOWARD_CAMERA" : direction === "away" || direction === "outgoing" ? "AWAY_FROM_CAMERA" : undefined;
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
    overviewImage: decodeImage(p.NormalPic), plateImage: decodeImage(p.CutoutPic), extraImage: decodeImage(p.VehiclePic),
    rawMetadata: { provider:"DAHUA_ITSAPI", profile:"picture-v1", timeZone:camera.timezone,
      timeSource:snap.AccurateTime ? "AccurateTime" : "SnapTime", confidenceScale:255,
      ...(snap.Direction ? { rawDirection:snap.Direction } : {}),
    },
  } };
}
