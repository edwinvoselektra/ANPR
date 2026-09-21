import { describe, expect, it } from "vitest";
import { selectAndSortAttentionPatterns, type AttentionPatternCandidate } from "./attention-patterns.js";

function candidate(plate: string, score: number | null, observedAt: string, confidence: AttentionPatternCandidate["confidence"] = "HIGH"): AttentionPatternCandidate {
  return { id: `${plate}-${observedAt}`, normalizedLicensePlate: plate, score, confidence, passage: { timestamp: new Date(observedAt) } };
}

describe("sortering van opvallende patronen", () => {
  it("sorteert echte scores standaard van 100 via 80 en 10 naar 0", () => {
    const result = selectAndSortAttentionPatterns([
      candidate("SCORE10", 10, "2026-09-18T10:00:00Z"),
      candidate("SCORE0", 0, "2026-09-18T13:00:00Z"),
      candidate("SCORE100", 100, "2026-09-18T08:00:00Z"),
      candidate("SCORE80", 80, "2026-09-18T12:00:00Z")
    ], "scoreDesc");

    expect(result.map((item) => item.score)).toEqual([100, 80, 10, 0]);
  });

  it("plaatst een ontbrekende score en onvoldoende gegevens onder echte scores", () => {
    const result = selectAndSortAttentionPatterns([
      candidate("NULL", null, "2026-09-20T10:00:00Z"),
      candidate("LOW", 35, "2026-09-20T11:00:00Z", "LOW"),
      candidate("ZERO", 0, "2026-09-18T10:00:00Z", "MEDIUM")
    ], "scoreDesc");

    expect(result.map((item) => item.normalizedLicensePlate)).toEqual(["ZERO", "LOW", "NULL"]);
  });

  it("zet bij een gelijke score de nieuwste waarneming eerst", () => {
    const result = selectAndSortAttentionPatterns([
      candidate("OLDER", 80, "2026-09-18T10:00:00Z"),
      candidate("NEWER", 80, "2026-09-19T10:00:00Z")
    ], "scoreDesc");

    expect(result.map((item) => item.normalizedLicensePlate)).toEqual(["NEWER", "OLDER"]);
  });

  it("ondersteunt score oplopend en meest recent zonder onvoldoende gegevens naar voren te halen", () => {
    const candidates = [
      candidate("HIGH", 80, "2026-09-18T10:00:00Z"),
      candidate("LOWER", 10, "2026-09-19T10:00:00Z"),
      candidate("INSUFFICIENT", 35, "2026-09-20T10:00:00Z", "LOW")
    ];

    expect(selectAndSortAttentionPatterns(candidates, "scoreAsc").map((item) => item.normalizedLicensePlate)).toEqual(["LOWER", "HIGH", "INSUFFICIENT"]);
    expect(selectAndSortAttentionPatterns(candidates, "recent").map((item) => item.normalizedLicensePlate)).toEqual(["LOWER", "HIGH", "INSUFFICIENT"]);
  });

  it("gebruikt alleen de nieuwste snapshot van ieder kenteken", () => {
    const result = selectAndSortAttentionPatterns([
      candidate("SAME", 99, "2026-09-17T10:00:00Z"),
      candidate("SAME", 20, "2026-09-19T10:00:00Z"),
      candidate("OTHER", 50, "2026-09-18T10:00:00Z")
    ], "scoreDesc");

    expect(result.map((item) => [item.normalizedLicensePlate, item.score])).toEqual([["OTHER", 50], ["SAME", 20]]);
  });
});
