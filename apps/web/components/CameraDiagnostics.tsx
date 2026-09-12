"use client";
import { useEffect, useState } from "react";
import { api, formatDate } from "@/lib/api";
export const diagnosticLabels:Record<string,string>={NOT_CONFIGURED:"Niet ingesteld",NOT_TESTED:"Niet getest",RUNNING:"Bezig",WAITING_CAMERA:"Wachten op camera",WAITING_PASSAGE:"Wachten op passage",SUCCESS:"Geslaagd",WARNING:"Waarschuwing",FAILED:"Mislukt",UNSUPPORTED:"Niet ondersteund",DISABLED:"Uitgeschakeld",STALE:"Resultaat verouderd"};
type Check={checkId:string;title:string;direction:string;status:string;checkedAt:string|null;lastSuccessAt:string|null;configVersion:number;evidence:string[];errorCode:string|null;message:string;possibleCauses:string[];suggestedActions:string[]};
type Report={summary:string;nextAction:string;camera:{isDraft:boolean;configVersion:number};checks:Check[];inbox:Array<{id:string;state:string;receivedAt:string;attempts:number;evidence:unknown}>};
export function CameraDiagnostics({cameraId}:{cameraId:string}) {
  const [data,setData]=useState<Report>();const[error,setError]=useState("");const[busy,setBusy]=useState(false);const[details,setDetails]=useState(false);
  const load=async()=>{try{setData(await api(`/cameras/${cameraId}/diagnostics`,{cache:"no-store"}));}catch(e){setError(e instanceof Error?e.message:"Diagnose niet beschikbaar.")}};
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer)},[cameraId]);
  const test=async()=>{setBusy(true);setError("");try{await api(`/cameras/${cameraId}/test-video`,{method:"POST"});await load()}catch(e){setError(e instanceof Error?e.message:"Test mislukt.")}finally{setBusy(false)}};
  const copy=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(data,null,2));setError("Diagnoserapport gekopieerd.")}catch{setDetails(true);setError("Kopiëren niet beschikbaar; selecteer het rapport bij Technische details.")}};
  return <section aria-label="Cameradiagnose">
    {data?.camera.isDraft&&<div className="alert info">Conceptcamera – geen normale passages, hits of productiepush uit conceptuploads.</div>}
    <h2>{data?.summary??"Diagnose laden…"}</h2><p>{data?.nextAction}</p>
    <div className="actions"><button type="button" className="button" onClick={test} disabled={busy}>{busy?"Beeld opnieuw testen…":"Opnieuw testen"}</button><button type="button" className="button secondary" onClick={()=>setDetails(!details)} aria-expanded={details}>Technische details</button><button type="button" className="button secondary" onClick={copy} disabled={!data}>Diagnoserapport kopiëren</button></div>
    <p>Opnieuw testen haalt nieuw beeld op en ververst de ontvangerdiagnose. Het laat de camera geen ITSAPI-bericht versturen.</p>
    {error&&<p className="alert" role="status">{error}</p>}
    <div className="diagnostic-grid">{data?.checks.map(c=><article className="card diagnostic-check" key={c.checkId}><div className="diagnostic-heading"><h3>{c.title}</h3><span className={`badge ${c.status==="SUCCESS"?"green":c.status==="FAILED"?"red":"gray"}`}>{diagnosticLabels[c.status]}</span></div><small>{c.direction} · {formatDate(c.checkedAt)}</small><p>{c.message}</p>{c.evidence.map(e=><p key={e}><strong>Waarneming:</strong> {e}</p>)}{c.errorCode&&<p>Foutcode: {c.errorCode}</p>}{c.possibleCauses.length>0&&<p><strong>Mogelijke oorzaken:</strong> {c.possibleCauses.join("; ")}</p>}<p><strong>Volgende handeling:</strong> {c.suggestedActions.join(" ")}</p>{details&&<p>Laatste succes: {formatDate(c.lastSuccessAt)} · configuratie {c.configVersion}</p>}</article>)}</div>
    {details&&<><h3>Ontvangen verzoeken (geen bewijs van een geldige passage)</h3>{data?.inbox.length?data.inbox.map(i=><article className="card" key={i.id}><p>{formatDate(i.receivedAt)} · {i.state} · {i.attempts} ontvangstpogingen</p><pre>{JSON.stringify(i.evidence,null,2)}</pre></article>):<p>Nog geen diagnostische cameraverzoeken ontvangen.</p>}<button type="button" className="button secondary" onClick={async()=>{try{const r=await api<{message:string}>(`/cameras/${cameraId}/itsapi/debug`,{method:"POST"});setError(r.message)}catch(e){setError(e instanceof Error?e.message:"Alleen admin kan dit inschakelen.")}}}>Structuurdiagnose 15 minuten inschakelen (admin)</button><pre tabIndex={0}>{JSON.stringify(data,null,2)}</pre></>}
  </section>;
}
