import type { CameraDirection, VehicleColor, VehicleType } from "@prisma/client";
import { normalizeLicensePlate, parseCameraTime, resolveTimeZone } from "@anpr/shared";
import type { EventImage, ManagedAnprCamera, NormalizedAnprEvent } from "../types.js";

export type DahuaRawEvent = { fields: Record<string, string>; overviewImage?: EventImage; plateImage?: EventImage; extraImage?: EventImage; imageDiagnostics?: Record<string,string> };

export function parseDahuaFields(body: Buffer): Record<string, string> {
  if (body.length > 256_000) throw new Error("EVENT_METADATA_TOO_LARGE");
  const fields: Record<string, string> = {};
  for (const line of body.toString("utf8").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (/^Events\[\d+\]\.[A-Za-z0-9_.[\]-]{1,160}$/.test(key) && value.length <= 1_000) fields[key] = value;
  }
  return fields;
}

function suffix(fields: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const match = Object.entries(fields).find(([key]) => key === name || key.endsWith(`.${name}`));
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function confidence(value?: string): number | undefined {
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  const normalized = number > 1 ? number / 100 : number;
  return normalized <= 1 ? normalized : undefined;
}

const colors: Record<string, VehicleColor> = {
  black: "BLACK", white: "WHITE", gray: "GRAY", grey: "GRAY", silver: "SILVER", red: "RED",
  blue: "BLUE", green: "GREEN", yellow: "YELLOW", brown: "BROWN", orange: "ORANGE"
};
const types: Record<string, VehicleType> = {
  car: "CAR", sedan: "CAR", suv: "CAR", mpv: "CAR", van: "VAN", pickup: "VAN", truck: "TRUCK",
  motorcycle: "MOTORCYCLE", motorbike: "MOTORCYCLE", bus: "BUS", trailer: "TRAILER"
};

function direction(value?: string): CameraDirection | undefined {
  const normalized = value?.toLowerCase();
  if (["incoming", "approach", "enter", "in"].includes(normalized ?? "")) return "INCOMING";
  if (["outgoing", "leave", "exit", "out"].includes(normalized ?? "")) return "OUTGOING";
  return undefined;
}

function safeMetadata(fields: Record<string, string>) {
  const allowed = ["Code", "Action", "Index", "Channel", "GroupID", "CountInGroup", "IndexInGroup", "Lane", "PTS", "VehicleModel", "Speed", "UTC", "RealUTC", "SnapTime", "Time"];
  const result: Record<string, string | number | boolean> = {};
  for (const name of allowed) {
    const value = suffix(fields, [name]);
    if (value !== undefined) result[name] = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value;
  }
  return result;
}

export function normalizeDahuaEvent(camera: ManagedAnprCamera, raw: DahuaRawEvent, receivedAt = new Date()): NormalizedAnprEvent | null {
  if (suffix(raw.fields, ["Code"]) !== "TrafficJunction") return null;
  const action = suffix(raw.fields, ["Action"]);
  if (action && action !== "Pulse" && action !== "Start") return null;
  const originalPlate = suffix(raw.fields, ["TrafficCar.PlateNumber", "PlateInfo.PlateNumber", "Object.Text", "PlateNumber"]);
  if (!originalPlate) return null;
  const normalizedPlate = normalizeLicensePlate(originalPlate);
  if (normalizedPlate.length < 2 || normalizedPlate.length > 20) return null;
  const laneValue = suffix(raw.fields, ["Lane"]);
  const lane = laneValue !== undefined && Number.isInteger(Number(laneValue)) && Number(laneValue) >= 0 ? Number(laneValue) : undefined;
  const color = suffix(raw.fields, ["Vehicle.Color", "TrafficCar.VehicleColor", "VehicleColor"]);
  const type = suffix(raw.fields, ["Vehicle.Type", "TrafficCar.VehicleType", "VehicleType"]);
  const eventId = suffix(raw.fields, ["EventID"]);
  const groupId = suffix(raw.fields, ["GroupID"]);
  const eventPosition = suffix(raw.fields, ["PTS", "UTC", "RealUTC", "SnapTime", "Time"]);
  // GroupID can restart after a camera reboot, so it is only stable together
  // with an event position. A real EventID remains the preferred source key.
  const sourceEventId = eventId ?? (groupId && eventPosition ? `${groupId}:${eventPosition}` : undefined);
  const timeZone=resolveTimeZone(camera.vpnLocation?.timezone,process.env.PLATFORM_TIMEZONE);
  const timeField=["RealUTC","UTC","SnapTime","Time"].find(field=>parseCameraTime(suffix(raw.fields,[field]),timeZone));
  return {
    cameraId: camera.id,
    occurredAt: (timeField?parseCameraTime(suffix(raw.fields,[timeField]),timeZone):undefined)??receivedAt,
    originalPlate,
    normalizedPlate,
    plateCountry: suffix(raw.fields, ["PlateCountry", "Country"]),
    confidence: confidence(suffix(raw.fields, ["PlateInfo.Confidence", "Object.Confidence", "Confidence"])),
    vehicleColor: color ? colors[color.toLowerCase()] ?? "OTHER" : undefined,
    vehicleType: type ? types[type.toLowerCase()] ?? "UNKNOWN" : undefined,
    vehicleBrand: suffix(raw.fields, ["Vehicle.Brand", "TrafficCar.VehicleSign", "VehicleSign", "Brand"]),
    direction: direction(suffix(raw.fields, ["Direction"])), lane,
    overviewImage: raw.overviewImage, plateImage: raw.plateImage, extraImage: raw.extraImage,
    source: "DAHUA_CAMERA", sourceEventId,
    rawMetadata: {
      ...safeMetadata(raw.fields), provider: "DAHUA_CGI",
      vehicleTypeStatus: !type ? "NOT_RECEIVED" : types[type.toLowerCase()] ? "MAPPED" : "UNMAPPED_VALUE",
      ...(type ? { rawVehicleType: type.slice(0,100) } : {}),
      ...(color ? { rawVehicleColor: color.slice(0,100) } : {}),
      ...(suffix(raw.fields,["Direction"]) ? { rawDirection: suffix(raw.fields,["Direction"])!.slice(0,100) } : {}),
      timeSource: timeField??"RECEIPT_FALLBACK", timeZone,
      ...(suffix(raw.fields,["UTC"]) && suffix(raw.fields,["RealUTC"]) && Number.isFinite(Number(suffix(raw.fields,["UTC"]))) && Number.isFinite(Number(suffix(raw.fields,["RealUTC"]))) ? { utcDisagreementSeconds: Number(suffix(raw.fields,["UTC"]))-Number(suffix(raw.fields,["RealUTC"])) } : {}),
      imageOriginalStatus: raw.imageDiagnostics?.ORIGINAL ?? (raw.overviewImage ? "RECEIVED_LEGACY" : "NOT_RECEIVED"),
      imagePlateStatus: raw.imageDiagnostics?.PLATE_CUTOUT ?? (raw.plateImage ? "RECEIVED_LEGACY" : "NOT_RECEIVED"),
      imageVehicleStatus: raw.imageDiagnostics?.VEHICLE_BODY_CUTOUT ?? (raw.extraImage ? "RECEIVED_LEGACY" : "NOT_RECEIVED")
    }
  };
}

export function imageKind(headers: Record<string, string>): "overview" | "plate" | undefined {
  if (headers["content-type"]?.toLowerCase() !== "image/jpeg") return undefined;
  const description = `${headers["content-disposition"] ?? ""} ${headers["x-file-name"] ?? ""}`.toLowerCase();
  return /plate|small|crop/.test(description) ? "plate" : "overview";
}
