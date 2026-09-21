"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AttentionBadge } from "@/components/AttentionPanel";
import { api, formatDate } from "@/lib/api";

type Sort = "scoreDesc" | "scoreAsc" | "recent";
type Pattern = { id: string; normalizedLicensePlate: string; displayLicensePlate: string; score: number | null; confidence: "LOW" | "MEDIUM" | "HIGH"; reasons: string[]; lastPassageAt: string; timeZone?: string; location: string; camera: { id: string; name: string } | null };
type PatternResponse = { patterns: Pattern[]; total: number; page: number; limit: number; totalPages: number; sort: Sort };
type Filters = { minScore: string; confidence: string; dateFrom: string; dateTo: string; cameraId: string; location: string; sort: Sort };

const labels = { LOW: "Laag", MEDIUM: "Gemiddeld", HIGH: "Hoog" };
const initialFilters: Filters = { minScore: "", confidence: "", dateFrom: "", dateTo: "", cameraId: "", location: "", sort: "scoreDesc" };
const pageSize = 50;

export default function PatternsPage() {
  const [data, setData] = useState<PatternResponse>({ patterns: [], total: 0, page: 1, limit: pageSize, totalPages: 1, sort: "scoreDesc" });
  const [form, setForm] = useState<Filters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters);
  const [cameras, setCameras] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (nextPage: number, filters: Filters) => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams({ sort: filters.sort, page: String(nextPage), limit: String(pageSize) });
      for (const [key, value] of Object.entries(filters)) if (key !== "sort" && value) params.set(key, value);
      setData(await api<PatternResponse>(`/attention/patterns?${params}`, { cache: "no-store" }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Patronen ophalen mislukt.");
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    api<{ cameras: Array<{ id: string; name: string }> }>("/cameras").then((result) => setCameras(result.cameras)).catch(() => undefined);
    void load(1, initialFilters);
  }, [load]);

  return <>
    <div className="page-header"><div><h1>Opvallende patronen</h1><p>Beschikbare aandachtsscores, standaard hoogste score eerst. Dit is geen oordeel over personen.</p></div></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    <form className="card search-form" onSubmit={(event) => { event.preventDefault(); setActiveFilters(form); void load(1, form); }}>
      <div className="form-grid">
        <div className="field"><label htmlFor="pattern-sort">Sorteren</label><select id="pattern-sort" value={form.sort} onChange={(event) => setForm({ ...form, sort: event.target.value as Sort })}><option value="scoreDesc">Hoogste score eerst</option><option value="scoreAsc">Laagste score eerst</option><option value="recent">Meest recent</option></select></div>
        <div className="field"><label htmlFor="pattern-min-score">Minimumscore</label><input id="pattern-min-score" type="number" min="0" max="100" value={form.minScore} onChange={(event) => setForm({ ...form, minScore: event.target.value })} placeholder="Bijv. 70"/></div>
        <div className="field"><label htmlFor="pattern-confidence">Betrouwbaarheid</label><select id="pattern-confidence" value={form.confidence} onChange={(event) => setForm({ ...form, confidence: event.target.value })}><option value="">Alle</option><option value="HIGH">Hoog</option><option value="MEDIUM">Gemiddeld</option><option value="LOW">Laag</option></select></div>
        <div className="field"><label htmlFor="pattern-date-from">Datum vanaf</label><input id="pattern-date-from" type="date" value={form.dateFrom} onChange={(event) => setForm({ ...form, dateFrom: event.target.value })}/></div>
        <div className="field"><label htmlFor="pattern-date-to">Datum tot</label><input id="pattern-date-to" type="date" value={form.dateTo} onChange={(event) => setForm({ ...form, dateTo: event.target.value })}/></div>
        <div className="field"><label htmlFor="pattern-camera">Camera</label><select id="pattern-camera" value={form.cameraId} onChange={(event) => setForm({ ...form, cameraId: event.target.value })}><option value="">Alle camera’s</option>{cameras.map((camera) => <option value={camera.id} key={camera.id}>{camera.name}</option>)}</select></div>
        <div className="field"><label htmlFor="pattern-location">Locatie</label><input id="pattern-location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })}/></div>
      </div>
      <div className="actions"><button className="button" disabled={busy}>{busy ? "Laden…" : "Filteren"}</button></div>
    </form>
    <section className="card">
      <div className="card-header"><h2>Resultaten</h2><span>{data.total} kentekens</span></div>
      <div className="pattern-list">
        {data.patterns.map((pattern) => <Link className="pattern-row" href={`/plates/${pattern.normalizedLicensePlate}`} key={pattern.normalizedLicensePlate}><div><strong>{pattern.displayLicensePlate}</strong><span>{pattern.camera?.name ?? "Onbekende camera"} · {pattern.location}</span><small>Laatste passage: {formatDate(pattern.lastPassageAt, pattern.timeZone)}</small></div><div className="pattern-score">{pattern.score === null ? <span className="badge gray">Geen score</span> : <AttentionBadge attention={{ score: pattern.score, confidence: pattern.confidence }}/>}<small>{labels[pattern.confidence]}</small></div><p>{pattern.reasons[0] ?? "Geen hoofdreden beschikbaar."}</p></Link>)}
        {!data.patterns.length && !busy && <div className="empty">Geen beschikbare patronen voor deze filters.</div>}
      </div>
      {data.total > data.limit && <div className="pagination"><button type="button" className="button secondary" disabled={data.page === 1 || busy} onClick={() => void load(data.page - 1, activeFilters)}>Vorige</button><span>Pagina {data.page} van {data.totalPages}</span><button type="button" className="button secondary" disabled={data.page >= data.totalPages || busy} onClick={() => void load(data.page + 1, activeFilters)}>Volgende</button></div>}
    </section>
  </>;
}
