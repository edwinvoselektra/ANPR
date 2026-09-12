import { describe, expect, it } from "vitest";
import { applicationDay } from "./application-time.js";
describe("Amsterdamse dashboarddag",()=>{
 it.each([
  ["2026-09-11T22:30:00Z","2026-09-11T22:00:00.000Z","2026-09-12T22:00:00.000Z"],
  ["2026-01-12T00:30:00Z","2026-01-11T23:00:00.000Z","2026-01-12T23:00:00.000Z"],
  ["2026-03-29T12:00:00Z","2026-03-28T23:00:00.000Z","2026-03-29T22:00:00.000Z"],
  ["2026-10-25T12:00:00Z","2026-10-24T22:00:00.000Z","2026-10-25T23:00:00.000Z"]
 ])("berekent daggrenzen voor %s",(now,start,end)=>{const day=applicationDay(new Date(now));expect(day.start.toISOString()).toBe(start);expect(day.end.toISOString()).toBe(end)});
});
