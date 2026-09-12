// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({api:mock,formatDate:()=>"12-09-2026 12:30"}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
import Dashboard from "./page";
const base={counters:{cameraTotal:1,cameraOnline:1,passagesToday:0,hitsToday:0,watchedPlates:1,demoPassagesToday:0,demoHitsToday:0},recentPassages:[],recentHits:[],cameraProblems:[]};
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks()});
describe("dashboard polling en historische hitcontext",()=>{
 it("ververst alle tegels en lijsten na een nieuwe groepshit en stopt bij unmount",async()=>{
  vi.useFakeTimers();mock.mockResolvedValueOnce(base).mockResolvedValue({...base,counters:{...base.counters,passagesToday:1,hitsToday:1},recentPassages:[{id:"p1",displayLicensePlate:"TEST12",camera:{name:"Fixture"},source:"DAHUA_CAMERA"}],recentHits:[{id:"h1",normalizedLicensePlate:"TEST12",camera:{name:"Fixture"},passage:{displayLicensePlate:"TEST12",source:"DAHUA_CAMERA"},groups:[{id:"g1",name:"Aandacht",reason:"Reden één"},{id:"g2",name:"PRIO",reason:"Reden twee"},{id:"g3",name:"Extra",reason:"Reden drie"}]}]});
  const view=render(<Dashboard/>);await act(async()=>{});expect(screen.getByText("Vandaag nog geen hits.")).toBeTruthy();
  await act(async()=>{await vi.advanceTimersByTimeAsync(3000)});
  expect(screen.getByText("Aandacht")).toBeTruthy();expect(screen.getByText("Reden één")).toBeTruthy();expect(screen.getByText("Reden twee")).toBeTruthy();expect(screen.getByText("+1 groepen · bekijk hitdetails")).toBeTruthy();expect(screen.getAllByText("TEST12")).toHaveLength(2);
  expect(screen.getByText("Hits vandaag").parentElement?.textContent).toBe("Hits vandaag1");expect(screen.getByText("Passages vandaag").parentElement?.textContent).toBe("Passages vandaag1");
  expect(mock).toHaveBeenLastCalledWith("/dashboard",{cache:"no-store"});view.unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(3000)});expect(mock).toHaveBeenCalledTimes(2);
 });
 it("behoudt het laatste overzicht wanneer verversen mislukt",async()=>{
  vi.useFakeTimers();mock.mockResolvedValueOnce(base).mockRejectedValueOnce(new Error("Tijdelijk offline"));render(<Dashboard/>);await act(async()=>{});await act(async()=>{await vi.advanceTimersByTimeAsync(3000)});expect(screen.getByText("Hits vandaag")).toBeTruthy();expect(screen.getByRole("status").textContent).toContain("Tijdelijk offline");
 });
});
