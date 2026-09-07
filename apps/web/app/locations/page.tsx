"use client";
import Link from "next/link";
import { useCallback,useEffect,useState } from "react";
import { PERMISSIONS } from "@anpr/shared";
import { Icon } from "@/components/icons";
import { api,formatDate } from "@/lib/api";
import { locationStatusColors,locationStatusLabels,routerLabels,type VpnLocation } from "@/lib/locations";

export default function LocationsPage(){
  const[locations,setLocations]=useState<VpnLocation[]>([]);const[canManage,setCanManage]=useState(false);const[error,setError]=useState("");
  const load=useCallback(async()=>{try{const[data,me]=await Promise.all([api<{locations:VpnLocation[]}>('/locations',{cache:'no-store'}),api<{user:{permissions:string[]}}>('/auth/me')]);setLocations(data.locations);setCanManage(me.user.permissions.includes(PERMISSIONS.LOCATIONS_MANAGE));setError("");}catch(e){setError(e instanceof Error?e.message:"Locaties ophalen mislukt.");}},[]);
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),30_000);return()=>window.clearInterval(timer)},[load]);
  return <><div className="page-header"><div><h1>Locaties</h1><p>VPN-locaties, tunnels en recorders.</p></div>{canManage?<Link className="button" href="/locations/new"><Icon name="plus"/>VPN-locatie toevoegen</Link>:null}</div>{error?<div className="alert error" role="alert">{error}</div>:null}<div className="camera-grid">{locations.map(location=><article className="card location-card" key={location.id}><div className="location-heading"><div><h2>{location.name}</h2><p>{routerLabels[location.routerType]??location.routerType}</p></div><span className={`badge ${locationStatusColors[location.connectionStatus]??'gray'}`}>{locationStatusLabels[location.connectionStatus]??location.connectionStatus}</span></div><div className="detail-list"><div><span>VPN</span><strong>{location.tunnelOnline===true?'Online':location.tunnelOnline===false?'Offline':'Onbekend'}</strong></div><div><span>Recorder</span><strong>{location.recorderPortOpen===true?'Online':location.recorderPortOpen===false?'Niet bereikbaar':'Onbekend'}</strong></div><div><span>Tunnel-IP</span><strong>{location.tunnelAddress}</strong></div><div><span>Remote LAN</span><strong>{location.remoteLanCidr}</strong></div><div><span>Camera’s</span><strong>{location._count?.cameras??0}</strong></div><div><span>Laatste controle</span><strong>{formatDate(location.lastCheckedAt)}</strong></div></div><div className="actions"><Link className="button secondary" href={`/locations/${location.id}`}>{canManage?'Instellen en testen':'Status bekijken'}</Link></div></article>)}</div>{!locations.length&&!error?<div className="card empty">Er zijn nog geen VPN-locaties opgeslagen.</div>:null}</>;
}
