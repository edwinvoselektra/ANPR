import { normalizeDirection, resolveTimeZone } from "@anpr/shared";
import { config } from "../config.js";
export function historicalCamera<T extends { camera?: { name: string; historicalName?: string | null; vpnLocation?: {timezone:string}|null } | null; timezone?:string|null; direction?:string }>(record: T) {
  const timeZone=resolveTimeZone(record.timezone??record.camera?.vpnLocation?.timezone,config.PLATFORM_TIMEZONE);
  return {...record,timeZone,...(record.direction!==undefined?{direction:normalizeDirection(record.direction)}:{}),
    ...(record.camera?{camera:{...record.camera,name:record.camera.historicalName??record.camera.name,timeZone}}:{})};
}
