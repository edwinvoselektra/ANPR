import { z } from "zod";
import type { ItsapiSchemaViolation } from "@anpr/shared";

export const ITSAPI_CAPTURE_MS = 15 * 60_000;
const paths = new Set([
  "", "Active", "DeviceID", "Picture", "Picture.Plate", "Picture.SnapInfo", "Picture.Vehicle",
  ...["PlateNumber", "IsExist", "Confidence", "Channel"].map(key => `Picture.Plate.${key}`),
  ...["DeviceID", "AccurateTime", "SnapTime", "Direction", "SnapAddress", "LanNo"].map(key => `Picture.SnapInfo.${key}`),
  ...["VehicleType", "VehicleColor", "VehicleSign"].map(key => `Picture.Vehicle.${key}`),
  ...["NormalPic", "CutoutPic", "VehiclePic"].flatMap(key => [`Picture.${key}`, `Picture.${key}.Content`]),
]);
const types = z.enum(["undefined", "null", "boolean", "string", "number", "integer", "float", "nan", "object", "array", "unknown", "never"]);
const violationSchema = z.object({
  path: z.string().refine(value => paths.has(value)),
  reason: z.enum(["MISSING", "invalid_type", "invalid_literal", "invalid_union", "too_small", "too_big", "custom", "invalid_string", "not_finite", "invalid_image", "invalid_event_time", "invalid_plate", "plate_not_present"]),
  expected: types.optional(), received: types.optional(),
  minimum: z.number().finite().min(0).max(10_666_668).optional(),
  maximum: z.number().finite().min(0).max(10_666_668).optional(), inclusive: z.boolean().optional(),
});
const errorCodes = new Set(["UNSUPPORTED_TOLLGATE_PAYLOAD", "UNSUPPORTED_HEARTBEAT_PAYLOAD", "INVALID_EVENT_TIME", "INVALID_IMAGE", "INVALID_PLATE", "DEVICE_ID_MISMATCH", "SOURCE_IP_MISMATCH", "REGISTRATION_REVOKED", "UNSUPPORTED_PROTOCOL_VERSION", "DEVICE_ID_NOT_CONFIGURED", "CAMERA_NOT_ACTIVE", "UNSUPPORTED_ENDPOINT"]);
const shapeKeys = new Set(["Picture", "Plate", "PlateNumber", "IsExist", "Confidence", "Channel", "SnapInfo", "DeviceID", "DeviceId", "AccurateTime", "SnapTime", "Direction", "SnapAddress", "LanNo", "Vehicle", "VehicleType", "VehicleColor", "VehicleSign", "NormalPic", "CutoutPic", "VehiclePic", "Content", "Active", "TollgateInfo", "KeepAlive", "Time", "UTC", "EventID", "EventId", "Info", "Data", "Object", "DrivingDirection", "CaptureDirection", "SnapDirection", "VehicleDirection", "JunctionDirection", "CustomRoadwayDirection", "Lane", "LaneNo", "ChannelID", "Count", "Type", "Code", "Name", "Color", "Speed", "Location", "Events", "Result", "type", "count", "item"]);
const shapeTypes = new Set(["undefined", "null", "boolean", "string", "number", "object", "begrensd", "array"]);
/** Read-side allowlist also protects reports against old or manually polluted inbox evidence. */
export function safeStoredShape(value: unknown): unknown | null {
  let budget = 100;
  const visit = (item: unknown, depth: number): unknown | null => {
    if (--budget < 0 || depth > 6) return "begrensd";
    if (typeof item === "string") return shapeTypes.has(item) ? item : null;
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    return Object.fromEntries(Object.entries(item).slice(0, 32).flatMap(([key, child]) => {
      if (!shapeKeys.has(key) && !/^field_\d{1,2}$/.test(key)) return [];
      if (key === "count") return typeof child === "number" && Number.isSafeInteger(child) && child >= 0 && child <= 16_000_000 ? [[key, child]] : [];
      const safe = visit(child, depth + 1);
      return safe === null ? [] : [[key, safe]];
    }));
  };
  return visit(value, 0);
}
export function safeItsapiEvidence(evidence: unknown) {
  const data = evidence !== null && typeof evidence === "object" && !Array.isArray(evidence) ? evidence as Record<string, unknown> : {};
  const errorCode = typeof data.errorCode === "string" && errorCodes.has(data.errorCode) ? data.errorCode : "UNKNOWN_DIAGNOSTIC_ERROR";
  const violations: ItsapiSchemaViolation[] = [];
  if (Array.isArray(data.violations)) for (const item of data.violations.slice(0, 24)) {
    const parsed = violationSchema.safeParse(item);
    if (parsed.success) violations.push(parsed.data);
  }
  const httpStatus = data.httpStatus === 403 || data.httpStatus === 422 || data.httpStatus === 501 ? data.httpStatus
    : ["DEVICE_ID_MISMATCH", "SOURCE_IP_MISMATCH", "REGISTRATION_REVOKED"].includes(errorCode) ? 403
      : errorCode === "UNSUPPORTED_ENDPOINT" ? 501 : errorCodes.has(errorCode) ? 422 : null;
  const captureTime = z.string().datetime().safeParse(data.structureCapturedAt);
  return { errorCode, httpStatus, violations,
    deviceIdentityVerified: data.deviceIdentityVerified === true,
    capturedAt: captureTime.success ? captureTime.data : null,
    shape: safeStoredShape(data.shape),
  };
}
