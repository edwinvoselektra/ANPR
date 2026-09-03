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
  anprProvider: string;
  anprConnectionStatus: string;
  lastAnprConnectionAt?: string | null;
  lastAnprEventAt?: string | null;
  lastAnprErrorCode?: string | null;
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
      <div className="cards">{Object.entries(data.services).map(([name, item]) => <div className="metric" key={name}><span>{name}</span><strong style={{ fontSize: 16 }}>{item.status === "healthy" ? "Online" : item.status === "not_configured" ? "Niet ingesteld" : item.status === "not_implemented" ? "TODO" : "Offline"}</strong><div><span className={`badge ${item.status === "healthy" ? "green" : item.status === "not_configured" || item.status === "not_implemented" ? "amber" : "red"}`}>{item.status}</span></div>{item.message && <small style={{ color: "var(--muted)", display: "block", marginTop: 7 }}>{item.message}</small>}</div>)}</div>
      <section className="card" style={{ marginTop: 20 }}><h2>Cameraverbindingen</h2><p className="subtitle">RTSP en ANPR-events zijn afzonderlijke verbindingen. Alle camera’s komen rechtstreeks uit PostgreSQL.</p><div className="table-wrap"><table><thead><tr><th>Camera</th><th>RTSP</th><th>ANPR-events</th><th>Laatste ANPR-event</th></tr></thead><tbody>{data.cameras.map((camera) => <tr key={camera.id}><td><strong>{camera.name}</strong><small style={{display:"block",color:"var(--muted)"}}>{camera.location}</small></td><td><span className={`badge ${camera.status === "ONLINE" ? "green" : camera.status === "DISABLED" ? "gray" : "red"}`}>{labels[camera.status] ?? camera.status}</span></td><td>{camera.anprProvider==="NONE"?<span className="badge gray">Uitgeschakeld</span>:<span className={`badge ${camera.anprConnectionStatus==="CONNECTED"?"green":camera.anprConnectionStatus==="CONNECTING"?"amber":"red"}`}>{camera.anprConnectionStatus}</span>}</td><td>{camera.lastAnprEventAt?new Intl.DateTimeFormat("nl-NL",{dateStyle:"short",timeStyle:"medium"}).format(new Date(camera.lastAnprEventAt)):"Nog niet"}</td></tr>)}{data.cameras.length === 0 && <tr><td colSpan={4}>Er zijn nog geen camera’s opgeslagen.</td></tr>}</tbody></table></div></section>
    </>}
    <div className="alert info">De video-worker controleert RTSP onafhankelijk. De ANPR-worker ontvangt alleen events van camera’s waarvoor een ANPR-provider expliciet is ingeschakeld.</div>
  </>;
}
