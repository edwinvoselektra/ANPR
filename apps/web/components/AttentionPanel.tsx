"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, formatDate } from "@/lib/api";
import { useCurrentUser } from "./app-shell";

export type AttentionResult = {
  id: string;
  normalizedLicensePlate: string;
  score: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  status: "SCORED" | "INSUFFICIENT_DATA";
  reasons: string[];
  factors?: Record<string, { score: number; contribution: number; available: boolean; explanation: string }>;
  calculatedAt: string;
  windowEnd?: string;
  review?: { reviewLabel: ReviewLabel; reviewedAt: string; reviewNote?: string | null; reviewedBy?: { displayName: string } | null } | null;
};

export type ReviewLabel = "NORMAL" | "ATTENTION" | "SUSPICIOUS_PATTERN" | "INSUFFICIENT_INFO";

const confidenceLabels: Record<AttentionResult["confidence"], string> = { LOW: "Laag", MEDIUM: "Gemiddeld", HIGH: "Hoog" };
const reviewLabels: Array<[ReviewLabel, string]> = [["NORMAL", "Normaal patroon"], ["ATTENTION", "Aandacht"], ["SUSPICIOUS_PATTERN", "Opvallend patroon"], ["INSUFFICIENT_INFO", "Onvoldoende informatie"]];

export function AttentionBadge({ attention }: { attention?: { score: number; confidence: AttentionResult["confidence"] } | null }) {
  if (!attention) return null;
  if (attention.confidence === "LOW") return <span className="badge gray">Onvoldoende gegevens</span>;
  return <span className={`badge ${attention.score >= 70 ? "amber" : "gray"}`}>Aandacht {attention.score}%</span>;
}

function scoreClass(score: number) { return score >= 70 ? "attention-score high" : score >= 40 ? "attention-score medium" : "attention-score low"; }

export function AttentionPanel({ normalized, compact = false }: { normalized: string; compact?: boolean }) {
  const user = useCurrentUser();
  const canReview = user?.roles.some((role) => role === "ADMIN" || role === "Administrator") ?? false;
  const [attention, setAttention] = useState<AttentionResult | null>();
  const [history, setHistory] = useState<AttentionResult[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [current, previous] = await Promise.all([
        api<{ attention: AttentionResult | null }>(`/attention/${encodeURIComponent(normalized)}`, { cache: "no-store" }),
        api<{ history: AttentionResult[] }>(`/attention/${encodeURIComponent(normalized)}/history?limit=10`, { cache: "no-store" })
      ]);
      setAttention(current.attention); setHistory(previous.history);
      if (current.attention?.review?.reviewNote) setNote(current.attention.review.reviewNote);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Patroonanalyse ophalen mislukt."); }
  };
  useEffect(() => { void load(); }, [normalized]);

  const review = async (reviewLabel: ReviewLabel) => {
    if (!attention) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/attention/${attention.id}/review`, { method: "PUT", body: JSON.stringify({ reviewLabel, reviewNote: note || null }) });
      setMessage("Beoordeling opgeslagen."); await load();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Beoordeling opslaan mislukt."); }
    finally { setBusy(false); }
  };

  if (error) return <section className="card attention-panel"><h2>Patroonanalyse</h2><div className="alert error">{error}</div></section>;
  if (attention === undefined) return <section className="card attention-panel"><h2>Patroonanalyse</h2><div className="loading">Patroonanalyse laden…</div></section>;
  if (!attention) return <section className="card attention-panel"><h2>Patroonanalyse</h2><div className="empty">Nog niet berekend voor dit kenteken.</div></section>;

  const reasons = attention.reasons.slice(0, 4);
  return <section className={`card attention-panel${compact ? " compact" : ""}`}>
    <div className="card-header"><div><h2>Patroonanalyse</h2><p className="subtitle">Afwijking ten opzichte van eerdere waarnemingen van hetzelfde kenteken.</p></div><AttentionBadge attention={attention}/></div>
    <div className="attention-summary">
      <div><span>Aandachtsscore</span>{attention.status === "INSUFFICIENT_DATA" ? <strong className="attention-insufficient">Onvoldoende gegevens</strong> : <strong className={scoreClass(attention.score)}>{attention.score}%</strong>}</div>
      <div><span>Betrouwbaarheid</span><strong>{confidenceLabels[attention.confidence]}</strong></div>
    </div>
    <p className="attention-explanation">De aandachtsscore geeft aan hoeveel het recente passagepatroon afwijkt van eerdere waarnemingen van hetzelfde kenteken. De score is geen oordeel over een persoon.</p>
    <div className="attention-reasons"><h3>Waarom deze score?</h3>{reasons.length ? <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="empty">Geen duidelijke afwijkende factor beschikbaar.</p>}</div>
    {!compact && history.length > 0 && <div className="attention-history"><h3>Scorehistorie</h3>{history.map((item) => <div className="attention-history-row" key={item.id}><time dateTime={item.calculatedAt}>{formatDate(item.calculatedAt)}</time><span>{item.status === "INSUFFICIENT_DATA" ? "Onvoldoende gegevens" : `${item.score}%`}</span><small>{confidenceLabels[item.confidence]}</small></div>)}</div>}
    {!compact && <div className="attention-review"><h3>Menselijke beoordeling</h3>{attention.review && <p className="subtitle">{reviewLabels.find(([value]) => value === attention.review?.reviewLabel)?.[1]} · {attention.review.reviewedBy?.displayName ?? "beheerder"} · {formatDate(attention.review.reviewedAt)}</p>}{canReview ? <><textarea aria-label="Notitie bij beoordeling" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} placeholder="Optionele notitie"/><div className="inline-actions">{reviewLabels.map(([value, label]) => <button className="button secondary" key={value} disabled={busy} onClick={() => void review(value)}>{label}</button>)}</div>{message && <div className="alert success" role="status">{message}</div>}</> : <p className="subtitle">Alleen een administrator kan een patroon beoordelen.</p>}</div>}
    {!compact && <Link className="text-link" href={`/plates/${normalized}`}>Naar het kentekendossier</Link>}
  </section>;
}
