"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ItsapiDiagnosticMessage, ItsapiSchemaViolation, ItsapiStructureReport } from "@anpr/shared";
import { api, formatDate } from "@/lib/api";

function reasonLabel(issue: ItsapiSchemaViolation) {
  const labels: Record<string, string> = {
    MISSING:"Verplicht veld ontbreekt", invalid_type:"Onjuist gegevenstype", invalid_literal:"Vaste protocolwaarde klopt niet",
    too_small:"Onder de toegestane grens", too_big:"Boven de toegestane grens", custom:"Niet-toegestane tekens of veldinhoud",
    invalid_union:"Geen van de ondersteunde typen", invalid_string:"Ongeldig tekstformaat", not_finite:"Geen eindig getal",
    invalid_image:"Geen geldige base64 JPEG", invalid_event_time:"Geen bruikbare, eenduidige opnametijd",
    invalid_plate:"Geen geldig genormaliseerd kenteken", plate_not_present:"Bericht geeft geen herkend kenteken aan",
  };
  return labels[issue.reason] ?? "Validatie mislukt";
}
function ErrorTable({ message }: { message: ItsapiDiagnosticMessage }) {
  return message.violations.length ? <div><p className="subtitle">Op een smal scherm kun je de tabel horizontaal verschuiven.</p><div className="table-wrap"><table>
    <caption>Afgekeurde velden — uitsluitend schema-informatie, geen ontvangen waarden</caption>
    <thead><tr><th>Veld</th><th>Verwacht type</th><th>Ontvangen type</th><th>Validatiefout</th><th>Schemagrens</th></tr></thead>
    <tbody>{message.violations.map((issue, index) => <tr key={`${issue.path}:${issue.reason}:${index}`}>
      <td><code>{issue.path || "(bericht)"}</code></td><td><code>{issue.expected ?? "Niet vastgelegd"}</code></td>
      <td><code>{issue.received ?? "Niet vastgelegd"}</code></td><td>{reasonLabel(issue)}<br/><code>{issue.reason}</code></td>
      <td>{[issue.minimum !== undefined ? `Minimum ${issue.minimum}` : "",issue.maximum !== undefined ? `Maximum ${issue.maximum}` : ""].filter(Boolean).join("; ")||"—"}{issue.inclusive === false ? " (exclusief)" : ""}</td>
    </tr>)}</tbody>
  </table></div></div> : <p>Dit oudere of niet-schema-gerelateerde bericht bevat geen exacte veldfouten. Start een nieuwe structuurdiagnose en wacht op het volgende afgewezen bericht. De vroegere algemene lijst met verwachte velden bewijst niet welke velden ontbreken.</p>;
}

export function ItsapiStructureDiagnosis({ cameraId }: { cameraId: string }) {
  const [report, setReport] = useState<ItsapiStructureReport>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const clockOffset = useRef(0);
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    controller.current?.abort();
    const active = new AbortController();controller.current = active;
    const timeout=setTimeout(()=>{if(version===requestVersion.current){setError("De diagnoseaanvraag duurt te lang. Probeer opnieuw te verversen.");active.abort();}},8_000);
    try {
      const result = await api<ItsapiStructureReport>(`/cameras/${cameraId}/itsapi/diagnostic`, { cache:"no-store", signal:active.signal });
      if (active.signal.aborted || version !== requestVersion.current) return;
      clockOffset.current = Date.parse(result.capture.serverTime) - Date.now();
      setReport(result);setNow(Date.now() + clockOffset.current);setError("");
    } catch (failure) {
      if (!active.signal.aborted && version === requestVersion.current) setError(failure instanceof Error ? failure.message : "Structuurdiagnose niet beschikbaar.");
    } finally {clearTimeout(timeout);}
  }, [cameraId]);
  useEffect(() => {
    void load();
    const poll = setInterval(() => { if (!document.hidden) void load(); }, 10_000);
    const tick = setInterval(() => setNow(Date.now() + clockOffset.current), 1_000);
    return () => { clearInterval(poll);clearInterval(tick);requestVersion.current++;controller.current?.abort(); };
  }, [load]);
  const until = report?.capture.until ? Date.parse(report.capture.until) : 0;
  const active = Boolean(report?.capture.active && until > now);
  const seconds = Math.max(0, Math.ceil((until - now) / 1_000));
  const started = report?.capture.startedAt ? Date.parse(report.capture.startedAt) : 0;
  const captured = report?.messages.find(item => item.capturedAt && Date.parse(item.capturedAt) >= started);
  const latest = report?.messages[0];
  const changeCapture = async (enabled: boolean) => {
    setBusy(true);setMessage("");setError("");
    try {
      const result = await api<{message:string}>(`/cameras/${cameraId}/itsapi/debug`, { method:"POST", body:JSON.stringify({enabled}) });
      setMessage(result.message);await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Diagnose wijzigen mislukt."); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!report) return;
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2));setMessage("Veilig diagnoserapport gekopieerd."); }
    catch { setError("Kopiëren is niet beschikbaar. Open de veilige structuurdetails en kopieer het rapport handmatig."); }
  };
  return <section className="card itsapi-structure" aria-labelledby="itsapi-structure-title">
    <div className="diagnostic-heading"><h2 id="itsapi-structure-title">ITSAPI-structuurdiagnose{report ? ` — ${report.camera.name}` : ""}</h2>
      {report && <span className={`badge ${active ? "amber" : "gray"}`}>{active ? "Tijdelijk actief" : "Uitgeschakeld"}</span>}
    </div>
    <p>Alleen administrators. Onderzoek welk veld wordt afgekeurd, zonder kentekens, Device ID-waarden, afbeeldingen of inloggegevens te tonen.</p>
    {error && <p className="alert error" role="alert">{error}</p>}{message && <p className="alert info" role="status">{message}</p>}
    {!report ? <p>Structuurdiagnose laden…</p> : <>
      <p>{active ? `Schakelt automatisch uit om ${formatDate(report.capture.until)}. Resterend: ${Math.floor(seconds/60)} min ${seconds%60} s.` : "De tijdelijke opname van de berichtstructuur staat uit. Veilige eerdere resultaten blijven maximaal 24 uur beschikbaar."}</p>
      {active && <p role="status">{captured ? "Een veilige structuur is vastgelegd. Bekijk de veldfouten hieronder." : "Wachten op een volgend afgewezen camerabericht sinds het starten van deze diagnose."}</p>}
      <ol><li>Start de tijdelijke diagnose.</li><li>De camera uploadt of herhaalt zelf zijn berichten; deze knop stuurt geen camera-opdracht.</li><li>Het resultaat verschijnt automatisch. Gebruik Verversen om direct opnieuw te kijken.</li></ol>
      <div className="actions"><button type="button" className="button" disabled={busy || active} onClick={() => void changeCapture(true)}>Start structuurdiagnose (15 minuten)</button>
        {active && <button type="button" className="button secondary" disabled={busy} onClick={() => void changeCapture(false)}>Diagnose stoppen</button>}
        <button type="button" className="button secondary" disabled={busy} onClick={() => void load()}>Diagnose verversen</button>
        <button type="button" className="button secondary" disabled={busy || !latest} onClick={() => void copy()}>Veilig rapport kopiëren</button></div>
      <p>Laatste ITSAPI-contact: {formatDate(report.lastRequestAt)} · geldige heartbeat: {formatDate(report.lastHeartbeatAt)} · succesvolle passageverwerking: {formatDate(report.lastSuccessfulEventAt)}. Een heartbeat bewijst geen passageverwerking.</p>
      {latest ? <article aria-label="Laatste afgewezen bericht">
        <h3>Laatste afwijzing{latest.httpStatus ? ` — HTTP ${latest.httpStatus}` : ""}</h3><p><strong>{latest.errorCode}</strong></p>
        <p>Voor het eerst ontvangen: {formatDate(latest.firstReceivedAt)} · meest recent: {formatDate(latest.lastReceivedAt)} · {latest.attempts} ontvangstpogingen van dezelfde berichtvingerafdruk; dit zijn geen unieke passages.</p>
        <p>Dit is een opgeslagen afwijzing. Controleer het ontvangsttijdstip; een oude afwijzing bewijst geen actuele storing.</p>
        <ErrorTable message={latest}/>
        <details><summary>Veilige structuurdetails en volledig rapport</summary><p>{latest.shape ? `Structuur vastgelegd op ${formatDate(latest.capturedAt)}.` : "Geen structuur van dit bericht bewaard. De exacte veldfouten hierboven zijn wel afzonderlijk beschikbaar."}</p>
          <pre tabIndex={0}>{JSON.stringify(report, null, 2)}</pre></details>
      </article> : <p>Nog geen afgewezen bericht beschikbaar voor deze cameraconfiguratie. Een andere configuratie of verlopen diagnose wordt niet als actueel resultaat weergegeven.</p>}
    </>}
  </section>;
}
