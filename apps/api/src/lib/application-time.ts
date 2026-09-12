export const APPLICATION_TIME_ZONE = "Europe/Amsterdam";
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APPLICATION_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});
function parts(date: Date) {
  return Object.fromEntries(formatter.formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
}
function midnight(year: number, month: number, day: number) {
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  // Resolve the offset at local midnight, including the two DST transition days.
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(instant));
    const represented = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour! % 24, p.minute!, p.second!);
    instant += target - represented;
  }
  return new Date(instant);
}
export function applicationDay(now = new Date()) {
  const p = parts(now);
  const next = new Date(Date.UTC(p.year!, p.month! - 1, p.day! + 1));
  return { start: midnight(p.year!, p.month!, p.day!), end: midnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()), timeZone: APPLICATION_TIME_ZONE };
}
