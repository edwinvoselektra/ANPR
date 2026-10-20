import type { CameraSourceDirection } from "./index.js";

// Only explicit travel words already supported by the CGI integration. Numeric
// Direction/JunctionDirection/head orientation enums have no confirmed mapping.
export function dahuaTravelDirection(value: unknown): CameraSourceDirection | undefined {
  if (typeof value !== "string") return;
  const text = value.trim().toLowerCase();
  if (["incoming", "approach", "enter", "in", "toward", "towards"].includes(text)) return "TOWARD_CAMERA";
  if (["outgoing", "leave", "exit", "out", "away"].includes(text)) return "AWAY_FROM_CAMERA";
}

export function resolveDahuaDirection(candidates: Array<{ field: string; value: unknown }>) {
  const present = candidates.filter(item => item.value !== undefined && item.value !== null && item.value !== "");
  const recognized = present.flatMap(item => {
    const source = dahuaTravelDirection(item.value);
    return source ? [{ ...item, source }] : [];
  });
  const conflict = new Set(recognized.map(item => item.source)).size > 1;
  const selected = recognized[0] ?? present[0];
  return {
    field: selected?.field,
    value: selected?.value,
    sourceDirection: conflict ? undefined : recognized[0]?.source,
    status: conflict ? "CONFLICTING_VALUES" : recognized.length ? "MAPPED" : present.length ? "UNMAPPED_VALUE" : "NOT_RECEIVED"
  };
}

const directionKey = /^(?:Direction|DrivingDirection|CaptureDirection|SnapDirection|VehicleDirection|JunctionDirection|CustomRoadwayDirection|VehicleHeadDirection|HeadDirection)(?:\[[0-9]+\])?$/i;
const containers = new Set(["Picture", "Plate", "SnapInfo", "Vehicle", "TrafficCar", "Data", "Info", "Object", "Events", "TollgateInfo"]);
const safeWords = /^(?:approach(?:ing)?|away|leav(?:e|ing)|in(?:coming)?|out(?:going)?|enter|exit|towards?|forward|reverse|obverse|unknown|both|head|tail|north|south|east|west)$/i;
type DirectionEvidence = { field: string; type: string; value?: string | number; valueOmitted?: boolean };

// Direction-only, bounded diagnostics. Never return arbitrary scalar strings,
// road names in DrivingDirection[1..2], raw payloads, plates or credentials.
export function dahuaDirectionEvidence(payload: unknown): DirectionEvidence[] {
  const result: DirectionEvidence[] = [];
  let budget = 512;
  const add = (field: string, value: unknown, omitValue = false) => {
    if (result.length >= 20) return;
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const safe = !omitValue && ((typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255)
      || (typeof value === "string" && (safeWords.test(value) || /^[0-9]{1,3}$/.test(value))));
    result.push({ field, type, ...(safe ? { value: value as string | number } : { valueOmitted: true }) });
  };
  const walk = (node: unknown, path: string, depth: number) => {
    if (--budget < 0 || depth > 6 || result.length >= 20 || !node || typeof node !== "object") return;
    for (const [index, [key, value]] of Object.entries(node).slice(0, 256).entries()) {
      if (--budget < 0 || result.length >= 20) break;
      if (/password|credential|token|secret|auth|content|base64|image|license|platenumber|rtsp|url|deviceid/i.test(key)) continue;
      const pieces = key.split(".");
      const leaf = pieces.at(-1)!;
      if (directionKey.test(leaf) || /^[A-Za-z]{1,40}Direction$/i.test(leaf)) {
        const safePath = pieces.map(part => directionKey.test(part) || containers.has(part.replace(/\[[0-9]+\]$/, "")) ? part : "direction_field").join(".");
        const field = path ? `${path}.${safePath}` : safePath;
        if (Array.isArray(value)) {
          add(field, value);
          value.slice(0, 3).forEach((item, i) => add(`${field}[${i}]`, item, /DrivingDirection$/i.test(leaf) && i !== 0));
        } else add(field, value, /DrivingDirection\[[1-9][0-9]*\]$/i.test(leaf));
      } else if (value && typeof value === "object") {
        const safeKey = containers.has(key) || /^[0-9]{1,2}$/.test(key) ? key : `field_${index}`;
        walk(value, path ? `${path}.${safeKey}` : safeKey, depth + 1);
      }
    }
  };
  walk(payload, "", 0);
  return result;
}
