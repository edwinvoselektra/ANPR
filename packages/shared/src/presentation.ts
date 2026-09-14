import { DateTime, IANAZone } from "luxon";
export const DEFAULT_TIME_ZONE = "Europe/Amsterdam";
export const TRAVEL_DIRECTIONS = ["INCOMING", "OUTGOING", "UNKNOWN"] as const;
export type TravelDirection = typeof TRAVEL_DIRECTIONS[number];
export function normalizeDirection(value: unknown): TravelDirection {
  return value === "INCOMING" || value === "OUTGOING" ? value : "UNKNOWN";
}
export const directionLabels: Record<TravelDirection,string> = { INCOMING:"Inkomend", OUTGOING:"Uitgaand", UNKNOWN:"Onbekend" };
export function directionLabel(value: unknown, arrow=false) {
  const direction=normalizeDirection(value);
  return `${arrow?(direction==="INCOMING"?"↓ ":direction==="OUTGOING"?"↑ ":""):""}${directionLabels[direction]}`;
}
export const validTimeZone = (zone: unknown): zone is string => typeof zone === "string" && IANAZone.isValidZone(zone);
export function resolveTimeZone(locationZone?: string|null, platformZone?: string|null) {
  return validTimeZone(locationZone)?locationZone:validTimeZone(platformZone)?platformZone:DEFAULT_TIME_ZONE;
}
export function formatLocalDate(value: string|Date|null|undefined, zone?: string|null) {
  if(!value)return "Nog niet";
  const date=value instanceof Date?DateTime.fromJSDate(value):DateTime.fromISO(value,{setZone:true});
  return date.isValid?date.setZone(resolveTimeZone(zone)).toFormat("dd-MM-yyyy HH:mm:ss"):"Onbekende tijd";
}
// Reject skipped wall times; include both occurrences of an autumn overlap in search.
export function localToUtc(date: string, time: string, zone=DEFAULT_TIME_ZONE, edge:"start"|"end"="start") {
  const input=`${date}T${time}`;
  const local=DateTime.fromISO(input,{zone:resolveTimeZone(zone)});
  if(!local.isValid || local.toFormat("yyyy-MM-dd'T'HH:mm")!==input) throw new Error("INVALID_LOCAL_TIME");
  const candidates=local.getPossibleOffsets().sort((a,b)=>a.toMillis()-b.toMillis());
  return (edge==="start"?candidates[0]!:candidates.at(-1)!).toUTC().toJSDate();
}
export function calendarDate(value: Date, zone=DEFAULT_TIME_ZONE) { return DateTime.fromJSDate(value).setZone(resolveTimeZone(zone)).toISODate()!; }
export function nextCalendarDate(date: string, days=1) { const result=DateTime.fromISO(date,{zone:"UTC"}).plus({days}); if(!result.isValid)throw new Error("INVALID_DATE");return result.toISODate()!; }
export function localDay(now=new Date(), zone=DEFAULT_TIME_ZONE) {
 const start=DateTime.fromJSDate(now).setZone(resolveTimeZone(zone)).startOf("day");
 return {start:start.toUTC().toJSDate(),end:start.plus({days:1}).toUTC().toJSDate(),timeZone:resolveTimeZone(zone)};
}
export function searchTimeWindows(fromDate:string,toDate:string,fromTime:string,toTime:string,zone=DEFAULT_TIME_ZONE){
 const days=DateTime.fromISO(toDate,{zone:"UTC"}).diff(DateTime.fromISO(fromDate,{zone:"UTC"}),"days").days+1;
 if(!Number.isInteger(days)||days<1||days>92)throw new Error("SEARCH_DATE_RANGE");
 return Array.from({length:days},(_,i)=>{const day=nextCalendarDate(fromDate,i);return {timestamp:{gte:localToUtc(day,fromTime,zone),lte:localToUtc(fromTime>toTime?nextCalendarDate(day):day,toTime,zone,"end")}}});
}

// Absolute epochs/offsets are never reinterpreted as wall time. Unzoned values use the camera region.
export function parseCameraTime(value:string|undefined, zone=DEFAULT_TIME_ZONE):Date|undefined {
 if(!value)return;
 if(/^\d{10}(?:\.\d+)?$/.test(value))return new Date(Number(value)*1000);
 if(/^\d{13}$/.test(value))return new Date(Number(value));
 const text=value.replace(" ","T");
 if(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)){const date=DateTime.fromISO(text,{setZone:true});return date.isValid?date.toUTC().toJSDate():undefined;}
 const date=DateTime.fromISO(text,{zone:resolveTimeZone(zone)});
 if(!date.isValid||date.toFormat("yyyy-MM-dd'T'HH:mm:ss")!==text||date.getPossibleOffsets().length!==1)return;
 return date.toUTC().toJSDate();
}
