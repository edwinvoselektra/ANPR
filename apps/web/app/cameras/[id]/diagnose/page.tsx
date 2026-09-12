"use client";
import {useEffect,useState} from "react";
import {api} from "@/lib/api";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CameraDiagnostics } from "@/components/CameraDiagnostics";
import { ItsapiSetup } from "@/components/ItsapiSetup";
export default function Diagnose(){const{id}=useParams<{id:string}>();const[setup,setSetup]=useState(false);useEffect(()=>{void Promise.all([api<{user:{roles:string[]}}>("/auth/me"),api<{camera:{anprProvider:string}}>(`/cameras/${id}`)]).then(([auth,result])=>setSetup(result.camera.anprProvider==="DAHUA_ITSAPI"&&auth.user.roles.some(r=>r==="ADMIN"||r==="Administrator"))).catch(()=>setSetup(false))},[id]);return <><div className="page-header"><div><h1>Cameradiagnose</h1><p>Opgeslagen instellingen zijn geen bewijs dat de volledige koppeling werkt.</p></div><Link className="button secondary" href={`/cameras/${id}`}>Camera bewerken</Link></div><CameraDiagnostics cameraId={id}/>{setup&&<details className="card" style={{marginTop:20}}><summary>ITSAPI-uploadinstellingen (admin)</summary><ItsapiSetup cameraId={id}/></details>}</>}
