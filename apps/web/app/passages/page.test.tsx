// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const apiMock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({api:apiMock,formatDate:()=>"02-09-2026 14:00"}));
import LivePassages from "./page";
afterEach(()=>{cleanup();vi.clearAllMocks();vi.useRealTimers()});
describe("Live passages",()=>{
  it("toont echte Dahua-passages met foto en metadata",async()=>{apiMock.mockResolvedValue({passages:[{id:"11111111-1111-4111-8111-111111111111",displayLicensePlate:"12-ABC-3",plateConfidence:.97,timestamp:"2026-09-02T12:00:00Z",vehicleColor:"BLUE",vehicleType:"CAR",source:"DAHUA_CAMERA",isHit:false,vehicleImage1ObjectId:"object",camera:{name:"hal vos",location:"Uddel"}}]});render(<LivePassages/>);expect(await screen.findByText("12-ABC-3")).toBeTruthy();expect(screen.getByText("Camera-ANPR")).toBeTruthy();expect(screen.getByAltText("Voertuig bij hal vos").getAttribute("src")).toContain("/api/passages/")});
  it("markeert simulatorrecords nadrukkelijk als DEMO",async()=>{apiMock.mockResolvedValue({passages:[{id:"11111111-1111-4111-8111-111111111111",displayLicensePlate:"DE-MO-1",timestamp:"2026-09-02T12:00:00Z",vehicleColor:"UNKNOWN",vehicleType:"UNKNOWN",source:"DEMO",isHit:false,camera:{name:"Uddel Noord",location:"Uddel"}}]});render(<LivePassages/>);expect(await screen.findByText("DEMO")).toBeTruthy()});
  it("ververst de lijst via polling",async()=>{vi.useFakeTimers();apiMock.mockResolvedValue({passages:[]});render(<LivePassages/>);await act(async()=>{await Promise.resolve()});expect(apiMock).toHaveBeenCalledTimes(1);await act(async()=>{await vi.advanceTimersByTimeAsync(3000)});expect(apiMock).toHaveBeenCalledTimes(2)});
});
