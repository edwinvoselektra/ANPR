import { describe, expect, it } from "vitest";
import { calculatePassageExpiry, displayLicensePlate, mapCameraDirection, normalizeLicensePlate } from "./index";

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

describe("retentie", () => {
  it("berekent standaard 14 dagen retentie", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    expect(calculatePassageExpiry(start).toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
});

describe("fysieke camerarichting", () => {
  it("ondersteunt beide montageoriëntaties", () => {
    expect(mapCameraDirection("TOWARD_CAMERA", "TOWARD_CAMERA_IS_INCOMING")).toBe("INCOMING");
    expect(mapCameraDirection("AWAY_FROM_CAMERA", "TOWARD_CAMERA_IS_INCOMING")).toBe("OUTGOING");
    expect(mapCameraDirection("TOWARD_CAMERA", "AWAY_FROM_CAMERA_IS_INCOMING")).toBe("OUTGOING");
    expect(mapCameraDirection("AWAY_FROM_CAMERA", "AWAY_FROM_CAMERA_IS_INCOMING")).toBe("INCOMING");
  });

  it("laat ontbrekende bronrichting onbekend", () => {
    expect(mapCameraDirection(undefined, "TOWARD_CAMERA_IS_INCOMING")).toBe("UNKNOWN");
  });
});
