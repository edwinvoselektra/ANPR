"use client";
import {useEffect,useState} from "react";
import {api} from "@/lib/api";
import {ObservationCollection} from "@/components/ObservationCollection";
import {ViewPreference,useViewPreference} from "@/components/ViewPreference";
export default function LivePassages(){
 const[passages,setPassages]=useState<any[]>([]);const[error,setError]=useState("");const[loading,setLoading]=useState(true);const[mode,setMode]=useViewPreference("passages");
 useEffect(()=>{let mounted=true,busy=false;const load=async()=>{if(busy)return;busy=true;try{const result=await api<{passages:any[]}>("/passages?limit=50",{cache:"no-store"});if(mounted){setPassages(result.passages);setError("")}}catch(e){if(mounted)setError(e instanceof Error?e.message:"Passages ophalen mislukt.")}finally{busy=false;if(mounted)setLoading(false)}};void load();const timer=setInterval(()=>void load(),3000);return()=>{mounted=false;clearInterval(timer)}},[]);
 return <><div className="page-header"><div><h1>Live passages</h1><p>Nieuwste registraties eerst · elke 3 seconden bijgewerkt.</p></div><ViewPreference mode={mode} onChange={setMode}/></div>{error&&<div className="alert error" role="status">{error}</div>}{loading?<div className="loading">Passages laden…</div>:<ObservationCollection mode={mode} kind="passages" items={passages.map(p=>({id:p.id,passageId:p.id,plate:p.displayLicensePlate,camera:p.camera.name,location:p.location??p.camera.location,timestamp:p.timestamp,timeZone:p.timeZone,direction:p.direction,confidence:p.plateConfidence,source:p.source,hit:p.isHit,color:p.vehicleColor,type:p.vehicleType,attention:p.attentionSnapshot,imageKind:p.vehicleImage1ObjectId?"overview":p.plateImageObjectId?"plate":undefined}))}/>} {!loading&&!passages.length&&<div className="card empty">Nog geen passages. Echte cameraregistraties en duidelijk gemarkeerde demopassages verschijnen hier.</div>}</>;
}
