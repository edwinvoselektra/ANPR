"use client";
import {useEffect,useState} from "react";
import {api} from "@/lib/api";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CameraDiagnostics } from "@/components/CameraDiagnostics";
import { ItsapiSetup } from "@/components/ItsapiSetup";

type SetupCamera={name?:string;anprProvider:string;rtspHost:string|null};
export default function Diagnose(){
  const{id}=useParams<{id:string}>();
  const[camera,setCamera]=useState<SetupCamera>();
  const[admin,setAdmin]=useState(false);
  const[error,setError]=useState("");
  const[retry,setRetry]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    setCamera(undefined);setAdmin(false);setError("");
    void Promise.all([api<{user:{roles:string[]}}>("/auth/me",{cache:"no-store"}),api<{camera:SetupCamera}>(`/cameras/${id}`,{cache:"no-store"})])
      .then(([auth,result])=>{if(!cancelled){setCamera(result.camera);setAdmin(auth.user.roles.some(r=>r==="ADMIN"||r==="Administrator"))}})
      .catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:"ITSAPI-instellingen niet beschikbaar.")});
    return()=>{cancelled=true};
  },[id,retry]);
  return <>
    <div className="page-header"><div><h1>Cameradiagnose{camera?.name?` — ${camera.name}`:""}</h1><p>Opgeslagen instellingen zijn geen bewijs dat de volledige koppeling werkt.</p></div><Link className="button secondary" href={`/cameras/${id}`}>Camera bewerken</Link></div>
    <CameraDiagnostics key={id} cameraId={id}/>
    {error?<div className="alert"><p role="alert">ITSAPI-uploadinstellingen laden mislukt: {error}</p><button type="button" className="button secondary" onClick={()=>setRetry(value=>value+1)}>Opnieuw laden</button></div>:!camera?<p role="status">Toegang tot ITSAPI-instellingen controleren…</p>:admin&&camera.anprProvider==="DAHUA_ITSAPI"?<section className="card" aria-labelledby="itsapi-settings-heading"><h2 id="itsapi-settings-heading">ITSAPI-uploadinstellingen (admin)</h2><ItsapiSetup cameraId={id} cameraHost={camera.rtspHost}/></section>:null}
  </>;
}
