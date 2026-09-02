"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, formatDate } from "@/lib/api";

type Passage = {
  id:string;displayLicensePlate:string;plateConfidence?:number|null;timestamp:string;vehicleColor:string;vehicleType:string;
  source:string;isHit:boolean;vehicleImage1ObjectId?:string|null;plateImageObjectId?:string|null;
  camera:{name:string;location:string};
};
const colors:Record<string,string>={BLACK:"Zwart",WHITE:"Wit",GRAY:"Grijs",SILVER:"Zilver",RED:"Rood",BLUE:"Blauw",GREEN:"Groen",YELLOW:"Geel",BROWN:"Bruin",ORANGE:"Oranje",OTHER:"Overig",UNKNOWN:"Onbekend"};
const types:Record<string,string>={CAR:"Personenauto",VAN:"Bestelauto",TRUCK:"Vrachtwagen",MOTORCYCLE:"Motor",BUS:"Bus",TRAILER:"Aanhanger",UNKNOWN:"Onbekend"};

export default function LivePassages(){
  const[passages,setPassages]=useState<Passage[]>([]);const[error,setError]=useState("");const[loading,setLoading]=useState(true);
  useEffect(()=>{let mounted=true;const load=async()=>{try{const result=await api<{passages:Passage[]}>("/passages?limit=50",{cache:"no-store"});if(mounted){setPassages(result.passages);setError("");}}catch(e){if(mounted)setError(e instanceof Error?e.message:"Passages ophalen mislukt.");}finally{if(mounted)setLoading(false);}};void load();const timer=window.setInterval(()=>void load(),3000);return()=>{mounted=false;window.clearInterval(timer)}},[]);
  return <><div className="page-header"><div><h1>Live passages</h1><p>Nieuwe cameraregistraties verschijnen automatisch, nieuwste eerst.</p></div><span className="badge green"><span className="dot"/>Elke 3 seconden bijgewerkt</span></div>{error&&<div className="alert error">{error}</div>}{loading?<div className="loading"><span className="spinner"/>Passages laden…</div>:<div className="passage-grid">{passages.map(p=><Link href={`/passages/${p.id}`} className={`card passage-card ${p.isHit?"hit":""}`} key={p.id}><div className="passage-image">{p.vehicleImage1ObjectId?<img src={`/api/passages/${p.id}/image/overview`} alt={`Voertuig bij ${p.camera.name}`}/>:p.plateImageObjectId?<img src={`/api/passages/${p.id}/image/plate`} alt={`Kentekenbeeld bij ${p.camera.name}`}/>:<span>Geen foto beschikbaar</span>}{p.source==="DEMO"&&<span className="badge amber passage-source">DEMO</span>}{p.source==="DAHUA_CAMERA"&&<span className="badge green passage-source">Camera-ANPR</span>}</div><div className="passage-body"><div className="passage-title"><strong>{p.displayLicensePlate}</strong>{p.isHit&&<span className="badge red">HIT</span>}</div><p>{p.camera.name} · {p.camera.location}</p><div className="passage-meta"><span>{formatDate(p.timestamp)}</span><span>{colors[p.vehicleColor]??p.vehicleColor}</span><span>{types[p.vehicleType]??p.vehicleType}</span>{p.plateConfidence!=null&&<span>{Math.round(p.plateConfidence*100)}% confidence</span>}</div></div></Link>)}</div>}{!loading&&!passages.length&&<div className="card empty">Nog geen passages. Een echt camera-event of een duidelijk gemarkeerde demopassage verschijnt hier automatisch.</div>}</>;
}
