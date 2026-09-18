import Link from "next/link";
import {directionLabel} from "@anpr/shared";
import {formatDate} from "@/lib/api";
import {vehicleColors,vehicleTypes} from "@/lib/vehicle-labels";
import type {ViewMode} from "./ViewPreference";
import { AttentionBadge } from "./AttentionPanel";
export type Observation={id:string;passageId:string;plate:string;camera:string;location:string;timestamp:string;timeZone?:string;direction?:string;source:string;hit:boolean;imageKind?:string;color?:string;type?:string;groups?:Array<{id:string;name:string;reason?:string|null}>;status?:string;confidence?:number|null;attention?:{score:number;confidence:"LOW"|"MEDIUM"|"HIGH"}|null};
const statusLabels:Record<string,string>={PENDING:"Push in wachtrij",PROCESSING:"Push wordt aangeboden",SENT:"Aangeboden aan pushdienst",FAILED:"Push mislukt",SKIPPED:"Push overgeslagen"};
export function ObservationCollection({items,mode,kind}:{items:Observation[];mode:ViewMode;kind:"passages"|"hits"}){
 return <div className={`observation-collection ${mode}`} aria-label={mode==="list"?"Lijstweergave":"Tegelweergave"}>{items.map(p=><Link className={`card observation ${p.hit?"has-hit":""}`} href={`/${kind}/${p.id}`} key={p.id}>
  <div className="observation-image">{p.imageKind?<img loading="lazy" src={`/api/passages/${p.passageId}/image/${p.imageKind}`} alt={`Voertuig bij ${p.camera}`}/>:<span>Geen foto</span>}{p.hit&&<span className="badge red">HIT</span>}</div>
  <div className="observation-body"><div className="observation-heading"><strong className="license-plate">{p.plate}</strong><span>{p.attention&&<AttentionBadge attention={p.attention}/>} {p.source==="DEMO"&&<span className="badge amber">DEMO</span>}</span></div><div className="observation-location"><strong>{p.camera}</strong><small>{p.location}</small></div>
   <div className="observation-time"><time dateTime={p.timestamp}>{formatDate(p.timestamp,p.timeZone)}</time><span className={`direction direction-${p.direction?.toLowerCase()??"unknown"}`}>{directionLabel(p.direction,true)}</span></div>
   {(p.color||p.type)&&<p className="observation-meta">{vehicleColors[p.color??"UNKNOWN"]??"Onbekend"} · {vehicleTypes[p.type??"UNKNOWN"]??"Onbekend"}</p>}
   {p.groups?.map(g=><div className="observation-group" key={g.id}><strong>{g.name}</strong><span>{g.reason||"Geen reden vastgelegd"}</span></div>)}
   {p.confidence!=null&&<small>Betrouwbaarheid: {Math.round(p.confidence*100)}%</small>}<small className="observation-source">{p.source==="DAHUA_CAMERA"?"Camera-ANPR":p.source==="DEMO"?"Simulator":p.source}{p.status?` · ${statusLabels[p.status]??p.status}`:""}</small>
  </div></Link>)}</div>;
}
