"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Registration = { expectedSourceIp?: string | null; receiverOrigin?: string; expectedDeviceId?: string; protocolVersion?: string; heartbeatSeconds: number; authenticationEnabled: boolean; username: string };
export function ItsapiSetup({cameraId,cameraHost,onChanged}:{cameraId:string;cameraHost?:string|null;onChanged?:()=>void}) {
  const [form,setForm]=useState({expectedSourceIp:"",receiverOrigin:"",expectedDeviceId:"",protocolVersion:"V1.19",heartbeatSeconds:300,authenticationEnabled:true});
  const [loaded,setLoaded]=useState(false);
  const [loadError,setLoadError]=useState("");
  const [publishedPort,setPublishedPort]=useState<number>();
  const [confirmed,setConfirmed]=useState(false);
  const [registration,setRegistration]=useState<Registration>();
  const [secret,setSecret]=useState<{username:string;password:string}>();
  const [busy,setBusy]=useState(false);const[message,setMessage]=useState("");
  const load=useCallback(async()=>{
    const r=await api<{registration:Registration|null;publishedPort:number}>(`/cameras/${cameraId}/itsapi`,{cache:"no-store"});
    setPublishedPort(r.publishedPort);
    setRegistration(r.registration??undefined);
    setForm({expectedSourceIp:r.registration?.expectedSourceIp??"",receiverOrigin:r.registration?.receiverOrigin??"",expectedDeviceId:r.registration?.expectedDeviceId??"",protocolVersion:r.registration?.protocolVersion??"V1.19",heartbeatSeconds:r.registration?.heartbeatSeconds??300,authenticationEnabled:r.registration?.authenticationEnabled??true});
    setConfirmed(Boolean(r.registration?.receiverOrigin));
    setLoaded(true);setLoadError("");
  },[cameraId]);
  useEffect(()=>{setLoaded(false);setLoadError("");setSecret(undefined);void load().catch(e=>setLoadError(e instanceof Error?e.message:"Uploadinstellingen ophalen mislukt."))},[load]);
  const save=async()=>{
    setBusy(true);setMessage("");setSecret(undefined);
    try{
      const r=await api<{message:string}>(`/cameras/${cameraId}/itsapi`,{method:"PUT",body:JSON.stringify({...form,addressConfirmed:confirmed})});
      onChanged?.();
      try{await load();setMessage(r.message)}catch{setLoaded(false);setLoadError("De instellingen zijn opgeslagen, maar opnieuw ophalen is mislukt. Probeer opnieuw te laden.")}
    }catch(e){
      const fields=e instanceof ApiError?Object.values(e.fields??{}).flat():[];
      setMessage(fields.length?fields.join(" "):e instanceof Error?e.message:"Opslaan mislukt.");
    }finally{setBusy(false)}
  };
  const reveal=async(rotate=false)=>{if(rotate&&!confirm("Uploadwachtwoord vervangen? Neem daarna het nieuwe wachtwoord over in de fysieke camera."))return;setBusy(true);try{setSecret(await api(`/cameras/${cameraId}/itsapi/credentials`,{method:"POST",body:JSON.stringify({rotate})}));}catch(e){setMessage(e instanceof Error?e.message:"Opvragen mislukt.")}finally{setBusy(false)}};
  const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setMessage("Gekopieerd.")}catch{setMessage("Kopiëren is hier niet beschikbaar. Selecteer de getoonde tekst en kopieer handmatig.")}};
  if(!loaded)return <section aria-label="ITSAPI-configuratiekaart">{loadError?<><p role="alert">{loadError}</p><button type="button" className="button secondary" onClick={()=>{setLoadError("");void load().catch(e=>setLoadError(e instanceof Error?e.message:"Uploadinstellingen ophalen mislukt."))}}>Uploadinstellingen opnieuw laden</button></>:<p role="status">Uploadinstellingen laden…</p>}</section>;
  return <section aria-label="ITSAPI-configuratiekaart">
    <p>De camera stuurt kentekens en bijbehorende beelden naar dit platform. Neem onderstaande instellingen over in de ITSAPI-instellingen van de camera.</p>
    <div className="alert info">De ontvanger is beschikbaar voor diagnose. De firmware-specifieke berichtstructuur en bevestiging zijn nog niet bewezen. Onbekende berichten worden niet als geslaagde heartbeat of passage bevestigd.</div>
    <p>Camera-IP voor RTSP en camerabeheer: <strong>{cameraHost??"zie Camera bewerken"}</strong>. Het verwachte bron-IP hieronder geldt alleen voor inkomende ITSAPI-berichten.</p>
    <div className="form-grid">
      <div className="field full"><label htmlFor="upload-origin">Ontvangstadres met poort</label><input id="upload-origin" value={form.receiverOrigin} onChange={e=>{setForm({...form,receiverOrigin:e.target.value});setConfirmed(false)}} placeholder={`http://LAN-of-VPN-adres:${publishedPort??"poort"}`}/><small>Gebruik het LAN-/VPN-adres van de platformhost. Geen localhost, Docker-servicenaam of camera-IP. Ingestelde Docker-uploadpoort: {publishedPort??"nog niet opgehaald"}. Bevestig dat deze poort daadwerkelijk bereikbaar is.</small></div>
      <label className="checkbox full"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Ik heb bevestigd dat dit het bedoelde LAN-/VPN-ontvangstadres en de gepubliceerde poort zijn.</label>
      <div className="field"><label htmlFor="device-id">Device ID uit de camera</label><input id="device-id" value={form.expectedDeviceId} onChange={e=>setForm({...form,expectedDeviceId:e.target.value})}/><small>Neem de bestaande ID over. Wijzigbaarheid is firmware-afhankelijk; het platform verzint geen apparaat-ID.</small></div>
      <div className="field"><label htmlFor="expected-source-ip">Verwachte bron-IP (VPN/NAT)</label><input id="expected-source-ip" inputMode="decimal" maxLength={15} aria-describedby="expected-source-help" value={form.expectedSourceIp} onChange={e=>setForm({...form,expectedSourceIp:e.target.value})} placeholder="Bijvoorbeeld 192.0.2.10"/><small id="expected-source-help">Gebruik dit veld wanneer een camera via een VPN-router of NAT verbinding maakt met de ANPR-server. Vul het IP-adres in waarmee de router zich bij de ANPR-server meldt. Laat leeg als de camera rechtstreeks vanaf zijn eigen IP-adres communiceert.</small></div>
      <div className="field"><label htmlFor="protocol-version">Protocolversie uit de camera</label><input id="protocol-version" value={form.protocolVersion} onChange={e=>setForm({...form,protocolVersion:e.target.value})}/></div>
      <div className="field"><label htmlFor="heartbeat-interval">Heartbeatinterval (seconden)</label><input id="heartbeat-interval" type="number" min="5" max="86400" value={form.heartbeatSeconds} onChange={e=>setForm({...form,heartbeatSeconds:Number(e.target.value)})}/></div>
      <label className="checkbox full"><input type="checkbox" checked={form.authenticationEnabled} onChange={e=>setForm({...form,authenticationEnabled:e.target.checked})}/>Digest-authenticatie staat in de camera aan</label>
      {!form.authenticationEnabled&&<p className="alert full">Zonder Digest accepteert de receiver alleen het ingestelde Device ID vanaf het verwachte bron-IP, of bij een leeg veld het vaste camera-IP.</p>}
    </div>
    <button type="button" className="button" disabled={busy||!confirmed||!form.expectedDeviceId||!form.protocolVersion} onClick={save}>Uploadinstellingen opslaan</button>
    {registration&&<div className="card" style={{marginTop:16}}><h3>Instellingen voor de camera</h3>
      <p>Platform Server: <strong>{registration.receiverOrigin}</strong> <button type="button" className="button secondary" onClick={()=>copy(registration.receiverOrigin??"")}>Adres kopiëren</button></p>
      <p>Device ID: {registration.expectedDeviceId} · protocol {registration.protocolVersion}</p><p>Heartbeat: {registration.heartbeatSeconds} seconden. Heartbeat Interface: /NotificationInfo/KeepAlive. ANPR Info Interface: /NotificationInfo/TollgateInfo. Deze paden zijn bevestigd voor V1.19.</p>
      <p>Gegevens: apparaatinfo en ANPR-info. Picture: Original Image, Plate Cutout en Vehicle Body Cutout aanvinken. Accuracy bij Uploading Info aanvinken; de schaal moet nog worden geverifieerd. Camera-herkenningsgebied wordt in de camera ingesteld.</p>
      <p>Opgeslagen verwachte bron-IP: <strong>{registration.expectedSourceIp||"Leeg: directe broncontrole via camera-IP"}</strong>.</p>
      <p>Authentication: {registration.authenticationEnabled?"aan (Digest)":"uit (verwacht bron-IP + Device ID)"}.</p>
      {registration.authenticationEnabled&&<><p>Upload-gebruikersnaam: <code>{registration.username}</code></p><p>Dit is een aparte uploadinlog, onafhankelijk van de camera-inlog voor video. Neem deze uploadinlog over in de camera.</p><div className="actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>reveal()}>Uploadwachtwoord tonen</button><button type="button" className="button secondary" disabled={busy} onClick={()=>reveal(true)}>Nieuw uploadwachtwoord</button></div></>}
      {secret&&<div className="field"><label htmlFor="upload-secret">Uploadwachtwoord (alleen admin)</label><input id="upload-secret" readOnly type="text" value={secret.password} autoComplete="off"/><button type="button" className="button secondary" onClick={()=>copy(secret.password)}>Wachtwoord kopiëren</button><button type="button" className="button secondary" onClick={()=>setSecret(undefined)}>Verbergen</button></div>}
    </div>}
    {message&&<p role="status" className="alert">{message}</p>}
  </section>;
}
