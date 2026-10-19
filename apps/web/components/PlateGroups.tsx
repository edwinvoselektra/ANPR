"use client";

import { useEffect, useState } from "react";
import { PERMISSIONS } from "@anpr/shared";
import { api, formatDate } from "@/lib/api";
import { useCurrentUser } from "./app-shell";

type Group = { id: string; name: string; active: boolean; hitEnabled: boolean; reasonRequired: boolean };
type Membership = { group: Group; active: boolean; reason: string | null; validFrom: string | null; validUntil: string | null };
type GroupData = { groups: Group[]; memberships: Membership[] };

export function PlateGroups({ normalized, timeZone }: { normalized: string; timeZone?: string }) {
  const user = useCurrentUser();
  const canManage = user?.permissions.includes(PERMISSIONS.PLATES_MANAGE)
    || user?.roles.some(role => role === "ADMIN" || role === "Administrator");
  const [data, setData] = useState<GroupData>();
  const [editing, setEditing] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const path = `/plates/${encodeURIComponent(normalized)}/groups`;

  useEffect(() => {
    let active = true;
    setData(undefined); setEditing(false); setGroupId(""); setReason(""); setError(""); setMessage("");
    api<GroupData>(path, { cache: "no-store" }).then(value => { if (active) setData(value); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [path]);

  const change = async (id: string, remove: boolean) => {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`${path}/${id}`, { method: remove ? "DELETE" : "PUT", ...(remove ? {} : { body: JSON.stringify({ reason }) }) });
      setData(await api<GroupData>(path, { cache: "no-store" }));
      setGroupId(""); setReason(""); setEditing(false);
      setMessage(remove ? "Groepskoppeling verwijderd." : "Kenteken aan groep toegevoegd. Nieuwe passages worden aan de actuele groepsregels getoetst.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Groepskoppeling opslaan mislukt.");
    } finally { setBusy(false); }
  };

  const available = data?.groups.filter(group => group.active && !data.memberships.some(member => member.group.id === group.id)) ?? [];
  const selected = available.find(group => group.id === groupId);
  return <section className="card" style={{ marginTop: 18 }} aria-label="Groepen">
    <div className="card-header"><h2>Groepen</h2>{canManage && data && <button className="button secondary" disabled={busy} onClick={() => setEditing(value => !value)}>Aan groep toevoegen</button>}</div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {message && <div className="alert success" role="status">{message}</div>}
    {!data && !error && <p>Groepen laden…</p>}
    {data && <>
      {data.memberships.length === 0 && <p>Geen groepen gekoppeld.</p>}
      {data.memberships.map(member => <div className="status-row" key={member.group.id}>
        <div><strong>{member.group.name}</strong><small>{!member.group.active ? "Groep inactief" : !member.active ? "Koppeling inactief" : member.group.hitEnabled ? "Hitdetectie ingeschakeld" : "Hitdetectie uitgeschakeld"}</small>
          {member.reason && <p>{member.reason}</p>}
          {(member.validFrom || member.validUntil) && <small>Geldigheid: {member.validFrom ? formatDate(member.validFrom, timeZone) : "onbegrensd"} – {member.validUntil ? formatDate(member.validUntil, timeZone) : "onbegrensd"}</small>}
        </div>
        {canManage && <button className="button secondary" disabled={busy} aria-label={`Verwijder uit ${member.group.name}`} onClick={() => void change(member.group.id, true)}>Verwijderen</button>}
      </div>)}
      {canManage && editing && <form onSubmit={event => { event.preventDefault(); if (groupId) void change(groupId, false); }}>
        <div className="field"><label htmlFor="plate-group">Groep</label><select id="plate-group" required disabled={busy} value={groupId} onChange={event => setGroupId(event.target.value)}><option value="">Kies een actieve groep</option>{available.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}</select></div>
        {!available.length && <p>Geen andere actieve groepen beschikbaar. Maak groepen aan via Groepen.</p>}
        <div className="field"><label htmlFor="plate-group-reason">Reden{selected && (selected.hitEnabled || selected.reasonRequired) ? " *" : ""}</label><textarea id="plate-group-reason" maxLength={1000} required={Boolean(selected?.hitEnabled || selected?.reasonRequired)} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} /></div>
        <div className="actions"><button className="button" disabled={busy || !groupId}>Toevoegen</button></div>
      </form>}
    </>}
  </section>;
}
