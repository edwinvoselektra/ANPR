"use client";
import {useEffect,useState} from "react";
import {useCurrentUser} from "./app-shell";
export type ViewMode="list"|"tiles";
export function useViewPreference(page:"passages"|"hits"){
 const user=useCurrentUser();const key=`anpr-view-v1:${user?.id??"local"}:${page}`;
 const[mode,setMode]=useState<ViewMode>("tiles");
 useEffect(()=>{try{const value=localStorage.getItem(key);setMode(value==="list"?"list":"tiles")}catch{setMode("tiles")}},[key]);
 return [mode,(next:ViewMode)=>{setMode(next);try{localStorage.setItem(key,next)}catch{/* Presentation still works without browser storage. */}}] as const;
}
export function ViewPreference({mode,onChange}:{mode:ViewMode;onChange:(mode:ViewMode)=>void}){
 return <div className="view-switch" role="group" aria-label="Weergave"><button type="button" aria-pressed={mode==="list"} onClick={()=>onChange("list")}><span aria-hidden="true">☰</span> Lijst</button><button type="button" aria-pressed={mode==="tiles"} onClick={()=>onChange("tiles")}><span aria-hidden="true">▦</span> Tegels</button></div>;
}
