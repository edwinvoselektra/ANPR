"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Registration = { receiverOrigin?: string; expectedDeviceId?: string; protocolVersion?: string; heartbeatSeconds: number; username: string };
export function ItsapiSetup({cameraId,onChanged}:{cameraId:string;onChanged?:()=>void}) {
  const [form,setForm]=useState({receiverOrigin:"",expectedDeviceId:"",protocolVersion:"V1.19",heartbeatSeconds:300});
  const [publishedPort,setPublishedPort]=useState<number>();
  const [confirmed,setConfirmed]=useState(false);
  const [registration,setRegistration]=useState<Registration>();
  const [secret,setSecret]=useState<{username:string;password:string}>();
  const [busy,setBusy]=useState(false);const[message,setMessage]=useState("");
  const load=()=>api<{registration:Registration|null;publishedPort:number}>(`/cameras/${cameraId}/itsapi`).then(r=>{setPublishedPort(r.publishedPort);if(r.registration){setRegistration(r.registration);setForm({receiverOrigin:r.registration.receiverOrigin??"",expectedDeviceId:r.registration.expectedDeviceId??"",protocolVersion:r.registration.protocolVersion??"",heartbeatSeconds:r.registration.heartbeatSeconds});setConfirmed(Boolean(r.registration.receiverOrigin));}}).catch(e=>setMessage(e.message));
  useEffect(()=>{void load()},[cameraId]);
  const save=async()=>{setBusy(true);setMessage("");setSecret(undefined);try{const r=await api<{message:string}>(`/cameras/${cameraId}/itsapi`,{method:"PUT",body:JSON.stringify({...form,addressConfirmed:confirmed})});setMessage(r.message);onChanged?.();await load();}catch(e){setMessage(e instanceof Error?e.message:"Opslaan mislukt.")}finally{setBusy(false)}};
  const reveal=async(rotate=false)=>{if(rotate&&!confirm("Uploadwachtwoord vervangen? Neem daarna het nieuwe wachtwoord over in de fysieke camera."))return;setBusy(true);try{setSecret(await api(`/cameras/${cameraId}/itsapi/credentials`,{method:"POST",body:JSON.stringify({rotate})}));}catch(e){setMessage(e instanceof Error?e.message:"Opvragen mislukt.")}finally{setBusy(false)}};
  const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setMessage("Gekopieerd.")}catch{setMessage("Kopiëren is hier niet beschikbaar. Selecteer de getoonde tekst en kopieer handmatig.")}};
  return <section aria-label="ITSAPI-configuratiekaart">
    <p>De camera stuurt kentekens en bijbehorende beelden naar dit platform. Neem onderstaande instellingen over in de ITSAPI-instellingen van de camera.</p>
    <div className="alert info">De ontvanger is beschikbaar voor diagnose. De firmware-specifieke berichtstructuur en bevestiging zijn nog niet bewezen. Onbekende berichten worden niet als geslaagde heartbeat of passage bevestigd.</div>
    <div className="form-grid">
      <div className="field full"><label htmlFor="upload-origin">Ontvangstadres met poort</label><input id="upload-origin" value={form.receiverOrigin} onChange={e=>{setForm({...form,receiverOrigin:e.target.value});setConfirmed(false)}} placeholder={`http://LAN-of-VPN-adres:${publishedPort??"poort"}`}/><small>Gebruik het LAN-/VPN-adres van de platformhost. Geen localhost, Docker-servicenaam of camera-IP. Ingestelde Docker-uploadpoort: {publishedPort??"nog niet opgehaald"}. Bevestig dat deze poort daadwerkelijk bereikbaar is.</small></div>
      <label className="checkbox full"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Ik heb bevestigd dat dit het bedoelde LAN-/VPN-ontvangstadres en de gepubliceerde poort zijn.</label>
      <div className="field"><label htmlFor="device-id">Device ID uit de camera</label><input id="device-id" value={form.expectedDeviceId} onChange={e=>setForm({...form,expectedDeviceId:e.target.value})}/><small>Neem de bestaande ID over. Wijzigbaarheid is firmware-afhankelijk; het platform verzint geen apparaat-ID.</small></div>
      <div className="field"><label htmlFor="protocol-version">Protocolversie uit de camera</label><input id="protocol-version" value={form.protocolVersion} onChange={e=>setForm({...form,protocolVersion:e.target.value})}/></div>
      <div className="field"><label htmlFor="heartbeat-interval">Heartbeatinterval (seconden)</label><input id="heartbeat-interval" type="number" min="5" max="86400" value={form.heartbeatSeconds} onChange={e=>setForm({...form,heartbeatSeconds:Number(e.target.value)})}/></div>
    </div>
    <button type="button" className="button" disabled={busy||!confirmed||!form.expectedDeviceId||!form.protocolVersion} onClick={save}>Uploadinstellingen opslaan</button>
    {registration&&<div className="card" style={{marginTop:16}}><h3>Instellingen voor de camera</h3>
      <p>Platform Server: <strong>{registration.receiverOrigin}</strong> <button type="button" className="button secondary" onClick={()=>copy(registration.receiverOrigin??"")}>Adres kopiëren</button></p>
      <p>Device ID: {registration.expectedDeviceId} · protocol {registration.protocolVersion}</p><p>Heartbeat: {registration.heartbeatSeconds} seconden. Heartbeat Interface: /NotificationInfo/KeepAlive. ANPR Info Interface: /NotificationInfo/TollgateInfo. Deze paden zijn bevestigd voor V1.19.</p>
      <p>Gegevens: apparaatinfo en ANPR-info. Picture: Original Image, Plate Cutout en Vehicle Body Cutout aanvinken. Accuracy bij Uploading Info aanvinken; de schaal moet nog worden geverifieerd. Camera-herkenningsgebied wordt in de camera ingesteld.</p>
      <p>Upload-gebruikersnaam: <code>{registration.username}</code></p>
      <p>Dit is een aparte uploadinlog, onafhankelijk van de camera-inlog voor video. Schakel Authentication in en neem deze uploadinlog over. Laat ITSAPI Enable uit totdat het ontvangstadres en de uploadinlog zijn ingesteld.</p>
      <div className="actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>reveal()}>Uploadwachtwoord tonen</button><button type="button" className="button secondary" disabled={busy} onClick={()=>reveal(true)}>Nieuw uploadwachtwoord</button></div>
      {secret&&<div className="field"><label htmlFor="upload-secret">Uploadwachtwoord (alleen admin)</label><input id="upload-secret" readOnly type="text" value={secret.password} autoComplete="off"/><button type="button" className="button secondary" onClick={()=>copy(secret.password)}>Wachtwoord kopiëren</button><button type="button" className="button secondary" onClick={()=>setSecret(undefined)}>Verbergen</button></div>}
    </div>}
    {message&&<p role="status" className="alert">{message}</p>}
  </section>;
}
