/** Picture profile is implemented; compatibility with the installed camera still
 * requires hardware verification. See docs/itsapi-receiver.md. */
export const ITSAPI_VERSION = "V1.19";
export const ITSAPI_HEARTBEAT_PATH = "/NotificationInfo/KeepAlive";
export const ITSAPI_ANPR_PATH = "/NotificationInfo/TollgateInfo";
export const ITSAPI_PROTOCOL_VERIFIED = false;
export const ITSAPI_PROTOCOL_GAP = "ITSAPI-bericht niet verwerkt. Controleer foutcode en ontbrekende velden; alleen het gedocumenteerde Picture-profiel wordt ondersteund.";

// Unrecognized keys can themselves contain identifiers or credentials. Preserve only
// known schema labels; everything else receives a positional, anonymous label.
const safeShapeKeys = new Set(["Picture", "Plate", "PlateNumber", "SnapInfo", "NormalPic", "CutoutPic", "VehiclePic", "Content", "AccurateTime", "SnapTime", "SnapAddress", "VehicleType", "VehicleColor", "VehicleSign", "LanNo", "Active", "IsExist", "DeviceID", "DeviceId", "TollgateInfo", "KeepAlive", "Time", "UTC", "EventID", "EventId", "Info", "Data", "Object", "Vehicle", "Direction", "Lane", "LaneNo", "Channel", "ChannelID", "Count", "Type", "Code", "Name", "Color", "Speed", "Confidence", "Location", "Events", "Result"]);

export function payloadShape(value: unknown): unknown {
  let budget = 80;
  function walk(item: unknown, depth: number): unknown {
    if (--budget < 0 || depth > 4) return "begrensd";
    if (item === null) return "null";
    if (Array.isArray(item)) return { type: "array", count: item.length, item: item.length ? walk(item[0],depth+1) : null };
    if (typeof item === "object") return Object.fromEntries(Object.entries(item).slice(0,30)
      .filter(([key]) => /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(key) && (safeShapeKeys.has(key) || !/password|secret|token|auth|image|picture|base64|plate|license/i.test(key)))
      .map(([key,v], index) => [safeShapeKeys.has(key) ? key : `field_${index}`,walk(v,depth+1)]));
    return typeof item; // Never retain scalar values, plates, image data, URLs or credentials.
  }
  return walk(value,0);
}
