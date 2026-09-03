import { describe, expect, it } from "vitest";
import { calculatePassageExpiry, displayLicensePlate, normalizeLicensePlate, shouldCreateHit } from "./index";

describe("kentekennormalisatie", () => {
  it.each(["12-ABC-3", "12 ABC 3", "12ABC3"])("normaliseert %s", (input) => {
    expect(normalizeLicensePlate(input)).toBe("12ABC3");
  });

  it("maakt een leesbare Nederlandse weergave", () => {
    expect(displayLicensePlate("12abc3")).toBe("12-ABC-3");
  });

  it("corrigeert O en 0 niet blind", () => {
    expect(normalizeLicensePlate("O0-I1-B8")).toBe("O0I1B8");
  });

  it("normaliseert een V84KVJ-achtig kenteken zonder streepjes identiek", () => {
    expect(normalizeLicensePlate("v84kvj")).toBe("V84KVJ");
  });
});

describe("retentie en hitbeslissing", () => {
  it("berekent standaard 14 dagen retentie", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(calculatePassageExpiry(start).toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
  it("maakt alleen een hit voor een actief en geldig groepslid", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    expect(shouldCreateHit({ active: true, groupActive: true, validUntil: new Date("2026-01-11") }, now)).toBe(true);
    expect(shouldCreateHit({ active: false, groupActive: true }, now)).toBe(false);
    expect(shouldCreateHit({ active: true, groupActive: false }, now)).toBe(false);
    expect(shouldCreateHit({ active: true, groupActive: true, validFrom: new Date("2026-01-11") }, now)).toBe(false);
    expect(shouldCreateHit({ active: true, groupActive: true, validUntil: new Date("2026-01-09") }, now)).toBe(false);
  });
});
