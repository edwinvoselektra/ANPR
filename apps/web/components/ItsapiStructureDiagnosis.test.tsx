// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ItsapiStructureReport } from "@anpr/shared";
const apiMock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({api:apiMock,formatDate:(value:string|null|undefined)=>value??"Onbekend"}));
import { ItsapiStructureDiagnosis } from "./ItsapiStructureDiagnosis";
import { CameraDiagnostics } from "./CameraDiagnostics";
let report:ItsapiStructureReport;
beforeEach(()=>{
  vi.clearAllMocks();report={camera:{id:"camera",name:"Staverhul",configVersion:3},capture:{active:false,until:null,startedAt:null,serverTime:new Date().toISOString()},lastRequestAt:null,lastHeartbeatAt:null,lastSuccessfulEventAt:null,messages:[]};
  apiMock.mockImplementation(async(path:string,options?:RequestInit)=>{
    if(options?.method==="POST"){
      const enabled=JSON.parse(options.body as string).enabled;
      report.capture={active:enabled,until:enabled?new Date(Date.now()+900_000).toISOString():null,startedAt:enabled?new Date().toISOString():null,serverTime:new Date().toISOString()};
      return {message:enabled?"Tijdelijke diagnose gestart.":"Diagnose gestopt."};
    }
    return structuredClone(report);
  });
});
afterEach(()=>{cleanup();vi.useRealTimers()});
it("toont starten, wachten en stoppen zonder terminalcommando of camera-opdracht",async()=>{
  render(<ItsapiStructureDiagnosis cameraId="camera"/>);
  expect(await screen.findByRole("heading",{name:"ITSAPI-structuurdiagnose — Staverhul"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Start structuurdiagnose (15 minuten)"}));
  expect(await screen.findByRole("button",{name:"Diagnose stoppen"})).toBeTruthy();
  expect(screen.getByText(/Wachten op een volgend afgewezen camerabericht sinds/)).toBeTruthy();
  expect(apiMock).toHaveBeenCalledWith("/cameras/camera/itsapi/debug",expect.objectContaining({method:"POST",body:'{"enabled":true}'}));
  fireEvent.click(screen.getByRole("button",{name:"Diagnose stoppen"}));
  await screen.findByText("Diagnose gestopt.");expect(screen.queryByRole("button",{name:"Diagnose stoppen"})).toBeNull();
});
it("toont HTTP 422 met veld, verwacht/ontvangen type en validatiefout direct in de tabel",async()=>{
  report.messages=[{id:"i",kind:"ANPR_UNVERIFIED",httpStatus:422,errorCode:"UNSUPPORTED_TOLLGATE_PAYLOAD",firstReceivedAt:new Date().toISOString(),lastReceivedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86_400_000).toISOString(),attempts:174145,capturedAt:null,deviceIdentityVerified:true,shape:null,violations:[{path:"Picture.Plate.IsExist",expected:"boolean",received:"null",reason:"invalid_type"}]}];
  render(<ItsapiStructureDiagnosis cameraId="camera"/>);
  expect(await screen.findByRole("heading",{name:"Laatste afwijzing — HTTP 422"})).toBeTruthy();
  const table=screen.getByRole("table");expect(table.textContent).toContain("Picture.Plate.IsExist");expect(table.textContent).toContain("boolean");expect(table.textContent).toContain("null");expect(table.textContent).toContain("invalid_type");
  expect(table.closest("details")).toBeNull();expect(screen.getByText(/174145 ontvangstpogingen/)).toBeTruthy();
});
it("maakt oude algemene missinglijsten niet tot bewezen veldfouten",async()=>{
  report.messages=[{id:"i",kind:"ANPR_UNVERIFIED",httpStatus:422,errorCode:"UNSUPPORTED_TOLLGATE_PAYLOAD",firstReceivedAt:new Date().toISOString(),lastReceivedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86_400_000).toISOString(),attempts:1,capturedAt:null,deviceIdentityVerified:false,shape:null,violations:[]}];
  render(<ItsapiStructureDiagnosis cameraId="camera"/>);expect(await screen.findByText(/bevat geen exacte veldfouten/)).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});
it("schakelt de zichtbare opname automatisch uit zonder herladen",async()=>{
  vi.useFakeTimers();
  report.capture={active:true,serverTime:new Date().toISOString(),startedAt:new Date(Date.now()-899_000).toISOString(),until:new Date(Date.now()+1_000).toISOString()};
  render(<ItsapiStructureDiagnosis cameraId="camera"/>);await act(async()=>{await Promise.resolve()});
  expect(screen.getByRole("button",{name:"Diagnose stoppen"})).toBeTruthy();
  await act(async()=>{await vi.advanceTimersByTimeAsync(2_000)});
  expect(screen.queryByRole("button",{name:"Diagnose stoppen"})).toBeNull();expect(screen.getByText("Uitgeschakeld")).toBeTruthy();
});
it("toont mislukte start zonder succesclaim",async()=>{
  render(<ItsapiStructureDiagnosis cameraId="camera"/>);await screen.findByRole("button",{name:"Start structuurdiagnose (15 minuten)"});
  apiMock.mockRejectedValueOnce(new Error("Database tijdelijk niet beschikbaar."));
  fireEvent.click(screen.getByRole("button",{name:"Start structuurdiagnose (15 minuten)"}));
  expect(await screen.findByRole("alert")).toBeTruthy();expect(screen.getByText("Uitgeschakeld")).toBeTruthy();
});
it.each([true,false])("staat in de bestaande cameradiagnose uitsluitend bij admin-toegang %s",async allowed=>{
  apiMock.mockImplementation(async(path:string)=>path.endsWith("/diagnostics")?{canManageStructureDiagnostics:allowed,camera:{isDraft:false,configVersion:3},summary:"Cameradiagnose",nextAction:"Bekijk de schemafout",checks:[],inbox:[]}:report);
  render(<CameraDiagnostics cameraId="camera"/>);await screen.findByRole("heading",{name:"Cameradiagnose"});
  await waitFor(()=>expect(Boolean(screen.queryByRole("heading",{name:"ITSAPI-structuurdiagnose — Staverhul"}))).toBe(allowed));
  if(!allowed)expect(apiMock.mock.calls.some(([path])=>path.endsWith("/itsapi/diagnostic"))).toBe(false);
});
