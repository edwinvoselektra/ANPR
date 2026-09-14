"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatDate } from "@/lib/api";
import { useCurrentUser } from "@/components/app-shell";

type Group = { id: string; name: string; color: string };
type Device = {
  id: string; deviceName?: string | null; userAgent?: string | null; enabled: boolean;
  lastSuccessfulAt?: string | null; failureCount: number; createdAt: string; updatedAt: string;
};
type Preferences = { pushEnabled: boolean; allHitGroups: boolean; groupIds: string[] };
type PageData = { preference: Preferences; subscriptions: Device[]; groups: Group[] };
type PushConfig = { configured: boolean; publicKey?: string; message: string };
type AdminOverview = {
  storage: { programBytes: number | null; storageBytes: number | null; totalBytes: number | null };
  storageNote: string; timeZone: string;
  activity: Array<{ id: string; createdAt: string; user: string; action: string; object: string; description: string }>;
};

function fileSize(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Niet beschikbaar";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(unit < 2 ? 0 : 1)} ${units[unit]}`;
}

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = window.atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

function defaultDeviceName() {
  const agent = navigator.userAgent;
  if (/iPhone|iPad/i.test(agent)) return "iPhone / iPad";
  if (/Android/i.test(agent)) return "Android-apparaat";
  if (/Firefox/i.test(agent)) return "Firefox-browser";
  if (/Edg/i.test(agent)) return "Edge-browser";
  if (/Chrome/i.test(agent)) return "Chrome-browser";
  return "Dit apparaat";
}

export default function SettingsPage() {
  const currentUser = useCurrentUser();
  const admin = currentUser?.roles.some((role) => role === "ADMIN" || role === "Administrator") ?? false;
  const [data, setData] = useState<PageData>();
  const [config, setConfig] = useState<PushConfig>();
  const [adminOverview, setAdminOverview] = useState<AdminOverview>();
  const [adminError, setAdminError] = useState("");
  const [preference, setPreference] = useState<Preferences>({ pushEnabled: false, allHitGroups: true, groupIds: [] });
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const overviewRequest = admin
        ? api<AdminOverview>("/admin/overview", { cache: "no-store" }).catch(() => { setAdminError("Beheerinformatie is tijdelijk niet beschikbaar."); return undefined; })
        : Promise.resolve(undefined);
      const [preferences, configuration, overview] = await Promise.all([
        api<PageData>("/notifications/preferences", { cache: "no-store" }),
        api<PushConfig>("/notifications/config", { cache: "no-store" }),
        overviewRequest
      ]);
      setData(preferences); setPreference(preferences.preference); setConfig(configuration);
      setAdminOverview(overview); if (overview) setAdminError("");
      setPermission("Notification" in window && "serviceWorker" in navigator && "PushManager" in window ? Notification.permission : "unsupported");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Meldingsinstellingen ophalen mislukt.");
    }
  }, [admin]);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => new Set(preference.groupIds), [preference.groupIds]);
  const savePreferences = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await api<{ message: string }>("/notifications/preferences", { method: "PUT", body: JSON.stringify(preference) });
      setMessage(result.message); await load();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Opslaan mislukt."); }
    finally { setBusy(false); }
  };

  const enableOnDevice = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      if (!config?.configured || !config.publicKey) throw new Error(config?.message ?? "Web Push is niet geconfigureerd.");
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Deze browser ondersteunt geen Web Push.");
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") throw new Error("Meldingstoestemming is niet gegeven. Pas dit desgewenst aan in de browserinstellingen.");
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("De browser gaf geen complete pushgegevens terug.");
      const response = await api<{ message: string }>("/notifications/subscriptions", { method: "POST", body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceName: defaultDeviceName() }) });
      setMessage(response.message); await load();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Inschakelen mislukt."); }
    finally { setBusy(false); }
  };

  const removeDevice = async (device: Device) => {
    if (!window.confirm(`Meldingen verwijderen voor ${device.deviceName ?? "dit apparaat"}?`)) return;
    setBusy(true); setMessage(""); setError("");
    try {
      await api(`/notifications/subscriptions/${device.id}`, { method: "DELETE" });
      setMessage("Apparaat is verwijderd."); await load();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Apparaat verwijderen mislukt."); }
    finally { setBusy(false); }
  };

  const testDevice = async (device: Device) => {
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await api<{ message: string }>(`/notifications/subscriptions/${device.id}/test`, { method: "POST" });
      setMessage(result.message); await load();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Testmelding verzenden mislukt."); }
    finally { setBusy(false); }
  };

  return <>
    <div className="page-header"><div><h1>Instellingen</h1><p>Beheer jouw pushmeldingen en gekoppelde apparaten.</p></div></div>
    {message && <div className="alert success" role="status">{message}</div>}
    {error && <div className="alert error" role="alert">{error}</div>}
    {!data || !config ? <div className="loading"><span className="spinner"/>Instellingen laden…</div> : <div className="settings-grid">
      <section className="card">
        <h2>Pushmeldingen</h2>
        <p className="subtitle">Toestemming wordt alleen gevraagd wanneer je zelf op de knop hieronder klikt.</p>
        <div className="status-row"><div><strong>Serverconfiguratie</strong><small>{config.message}</small></div><span className={`badge ${config.configured ? "green" : "amber"}`}>{config.configured ? "Beschikbaar" : "Niet ingesteld"}</span></div>
        <div className="status-row"><div><strong>Browsertoestemming</strong><small>{permission === "granted" ? "Toegestaan" : permission === "denied" ? "Geblokkeerd in browserinstellingen" : permission === "unsupported" ? "Niet ondersteund" : "Nog niet gevraagd"}</small></div><span className={`badge ${permission === "granted" ? "green" : permission === "denied" ? "red" : "gray"}`}>{permission}</span></div>
        <button className="button" disabled={busy || !config.configured || permission === "unsupported"} onClick={enableOnDevice}>Meldingen op dit apparaat inschakelen</button>
        {permission === "denied" && <div className="alert info">Open de site-instellingen van je browser, zet Meldingen op Toestaan en laad deze pagina opnieuw.</div>}
        {/iPhone|iPad/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent) && <div className="alert info">Op iPhone/iPad werkt Web Push vanuit een geïnstalleerde PWA. Kies in Safari ‘Zet op beginscherm’, open daarna de app vanaf het beginscherm en schakel meldingen hier in.</div>}
        <div className="alert info">Let op: de inhoud van een pushmelding kan zichtbaar zijn op het vergrendelscherm. Pas zo nodig de privacy-instellingen van je telefoon aan.</div>
      </section>

      <section className="card">
        <h2>Welke hits wil je ontvangen?</h2>
        <div className="checkbox-stack notification-options">
          <label className="checkbox"><input type="checkbox" checked={preference.pushEnabled} onChange={(event) => setPreference({ ...preference, pushEnabled: event.target.checked })}/>Pushmeldingen aan</label>
          <label className="checkbox"><input type="radio" name="groupMode" checked={preference.allHitGroups} onChange={() => setPreference({ ...preference, allHitGroups: true })}/>Alle hits</label>
          <label className="checkbox"><input type="radio" name="groupMode" checked={!preference.allHitGroups} onChange={() => setPreference({ ...preference, allHitGroups: false })}/>Alleen geselecteerde groepen</label>
        </div>
        {!preference.allHitGroups && <div className="check-grid notification-groups">{data.groups.map((group) => <label className="checkbox" key={group.id}><input type="checkbox" checked={selected.has(group.id)} onChange={(event) => setPreference({ ...preference, groupIds: event.target.checked ? [...preference.groupIds, group.id] : preference.groupIds.filter((id) => id !== group.id) })}/><span className="color-dot" style={{ background: group.color }}/>{group.name}</label>)}{!data.groups.length && <p>Er zijn geen actieve hitgroepen.</p>}</div>}
        <div className="actions"><button className="button" disabled={busy} onClick={savePreferences}>Voorkeuren opslaan</button></div>
      </section>

      <section className="card settings-wide">
        <h2>Gekoppelde apparaten</h2>
        <p className="subtitle">Elk actief apparaat ontvangt maximaal één melding per hit.</p>
        <div className="status-list">{data.subscriptions.map((device) => <div className="status-row" key={device.id}><div><strong>{device.deviceName ?? "Onbekend apparaat"}</strong><small>{device.enabled ? "Actief" : "Uitgeschakeld"} · toegevoegd {new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(new Date(device.createdAt))}{device.lastSuccessfulAt ? ` · laatst gelukt ${new Intl.DateTimeFormat("nl-NL", { dateStyle: "short", timeStyle: "short" }).format(new Date(device.lastSuccessfulAt))}` : ""}</small></div><div className="inline-actions"><button className="button secondary" disabled={busy || !device.enabled || !config.configured} onClick={() => testDevice(device)}>Testmelding</button><button className="button danger" disabled={busy} onClick={() => removeDevice(device)}>Verwijderen</button></div></div>)}{!data.subscriptions.length && <div className="empty">Nog geen apparaten gekoppeld.</div>}</div>
      </section>

      {admin && <section className="card">
        <h2>Systeemopslag</h2>
        {adminOverview ? <><dl className="storage-summary">
          <div><dt>Programma</dt><dd>{fileSize(adminOverview.storage.programBytes)}</dd></div>
          <div><dt>Opslag</dt><dd>{fileSize(adminOverview.storage.storageBytes)}</dd></div>
          <div className="total"><dt>Totaal</dt><dd>{fileSize(adminOverview.storage.totalBytes)}</dd></div>
        </dl><p className="subtitle">{adminOverview.storageNote}</p></> : <div className="empty">{adminError || "Systeemopslag laden…"}</div>}
      </section>}

      {admin && <section className="card">
        <h2>Recente activiteit</h2>
        {adminOverview ? <div className="activity-list">{adminOverview.activity.map((item) => <article key={item.id}>
          <time dateTime={item.createdAt}>{formatDate(item.createdAt, adminOverview.timeZone)}</time>
          <strong>{item.action}</strong><span>{item.object}</span>
          <small>{item.user} · {item.description}</small>
        </article>)}{!adminOverview.activity.length && <div className="empty">Nog geen auditactiviteit vastgelegd.</div>}</div> : <div className="empty">{adminError || "Recente activiteit laden…"}</div>}
      </section>}
    </div>}
  </>;
}
