export type AttentionPatternSort = "scoreDesc" | "scoreAsc" | "recent";

export type AttentionPatternCandidate = {
  id: string;
  normalizedLicensePlate: string;
  score: number | null;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  passage: { timestamp: Date };
};

function newestFirst(a: AttentionPatternCandidate, b: AttentionPatternCandidate) {
  return b.passage.timestamp.getTime() - a.passage.timestamp.getTime() || b.id.localeCompare(a.id);
}

function hasReliableScore(candidate: AttentionPatternCandidate) {
  return candidate.confidence !== "LOW" && candidate.score !== null && Number.isFinite(candidate.score);
}

/** Selects the latest observation per plate before applying a stable list order. */
export function selectAndSortAttentionPatterns<T extends AttentionPatternCandidate>(candidates: T[], sort: AttentionPatternSort): T[] {
  const latestByPlate = new Map<string, T>();

  for (const candidate of candidates) {
    const current = latestByPlate.get(candidate.normalizedLicensePlate);
    if (!current || newestFirst(candidate, current) < 0) latestByPlate.set(candidate.normalizedLicensePlate, candidate);
  }

  return [...latestByPlate.values()].sort((a, b) => {
    const aReliable = hasReliableScore(a);
    const bReliable = hasReliableScore(b);
    if (aReliable !== bReliable) return aReliable ? -1 : 1;

    if (sort !== "recent") {
      if (a.score === null && b.score !== null) return 1;
      if (a.score !== null && b.score === null) return -1;
      if (a.score !== null && b.score !== null && a.score !== b.score) {
        return sort === "scoreDesc" ? b.score - a.score : a.score - b.score;
      }
    }

    return newestFirst(a, b);
  });
}
