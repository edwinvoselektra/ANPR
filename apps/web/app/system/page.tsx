"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type CameraStatus = {
  id: string;
  name: string;
  location: string;
  active: boolean;
  status: string;
  lastConnectionAt?: string | null;
  lastConnectionSuccessAt?: string | null;
  lastConnectionErrorCode?: string | null;
};
type Status = {
  services: Record<string, { status: string; message?: string }>;
  cameras: CameraStatus[];
  demoMode: boolean;
  version: string;
};
const labels: Record<string, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  CONNECTION_PROBLEM: "Verbindingsprobleem",
  ANPR_UNAVAILABLE: "ANPR niet beschikbaar",
  DISABLED: "Uitgeschakeld"
};

export default function System() {
  const [data, setData] = useState<Status>();
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const result = await api<Status>("/system/status", { cache: "no-store" });
        if (mounted) { setData(result); setError(""); }
      } catch (requestError) {
        if (mounted) setError(requestError instanceof Error ? requestError.message : "Systeemstatus ophalen mislukt.");
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  return <>
    <div className="page-header"><div><h1>Systeemstatus</h1><p>Werkelijke status van de platformservices en databasecamera’s.</p></div>{data && <span className="badge gray">Versie {data.version}</span>}</div>
    {error && <div className="alert error">{error}</div>}
    {!data && !error ? <div className="loading"><span className="spinner"/>Status controleren…</div> : data && <>
      <div className="cards">{Object.entries(data.services).map(([name, item]) => <div className="metric" key={name}><span>{name}</span><strong style={{ fontSize: 16 }}>{item.status === "healthy" ? "Online" : item.status === "not_implemented" ? "TODO" : "Offline"}</strong><div><span className={`badge ${item.status === "healthy" ? "green" : item.status === "not_implemented" ? "amber" : "red"}`}>{item.status}</span></div>{item.message && <small style={{ color: "var(--muted)", display: "block", marginTop: 7 }}>{item.message}</small>}</div>)}</div>
      <section className="card" style={{ marginTop: 20 }}><h2>Camerastatus via video-worker</h2><p className="subtitle">Alle camera’s komen rechtstreeks uit PostgreSQL; namen zijn niet hardcoded.</p><div className="status-list">{data.cameras.map((camera) => <div className="status-row" key={camera.id}><div><strong>{camera.name}</strong><small>{camera.location}</small></div><span className={`badge ${camera.status === "ONLINE" ? "green" : camera.status === "DISABLED" ? "gray" : "red"}`}>{labels[camera.status] ?? camera.status}</span></div>)}{data.cameras.length === 0 && <p>Er zijn nog geen camera’s opgeslagen.</p>}</div></section>
    </>}
    <div className="alert info">De video-worker verwerkt in Fase 2.1 alleen begrensde testframes. ANPR/OCR blijft bewust <strong>TODO voor Fase 2.2</strong>.</div>
  </>;
}
