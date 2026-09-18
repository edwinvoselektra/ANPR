// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AttentionPanel } from "./AttentionPanel";

const apiMock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({api:apiMock,formatDate:(value:string)=>new Date(value).toLocaleString("nl-NL")}));
vi.mock("./app-shell",()=>({useCurrentUser:()=>({roles:["ADMIN"],permissions:[]})}));

describe("AttentionPanel",()=>{
  beforeEach(()=>{vi.clearAllMocks();apiMock.mockImplementation((path:string,options?:RequestInit)=>{if(path.includes("/history"))return Promise.resolve({history:[]});if(options?.method==="PUT")return Promise.resolve({review:{reviewLabel:"NORMAL"}});return Promise.resolve({attention:{id:"snap",normalizedLicensePlate:"12ABC3",score:82,confidence:"HIGH",status:"SCORED",reasons:["Afwijkend tijdstip"],calculatedAt:"2026-09-18T08:30:00Z",review:null}})})});
  afterEach(()=>cleanup());
  it("toont backend-score, confidence en reasons",async()=>{render(<AttentionPanel normalized="12ABC3"/>);expect(await screen.findByText("82%")).toBeTruthy();expect(screen.getByText("Hoog")).toBeTruthy();expect(screen.getByText("Afwijkend tijdstip")).toBeTruthy()});
  it("toont onvoldoende gegevens zonder nulscore",async()=>{apiMock.mockImplementation((path:string)=>path.includes("/history")?Promise.resolve({history:[]}):Promise.resolve({attention:{id:"snap",normalizedLicensePlate:"12ABC3",score:12,confidence:"LOW",status:"INSUFFICIENT_DATA",reasons:["Onvoldoende gegevens"],calculatedAt:"2026-09-18T08:30:00Z",review:null}}));render(<AttentionPanel normalized="12ABC3"/>);expect((await screen.findAllByText("Onvoldoende gegevens")).length).toBeGreaterThan(0);expect(screen.queryByText("12%")).toBeNull()});
  it("slaat een ADMIN-review op",async()=>{render(<AttentionPanel normalized="12ABC3"/>);await screen.findByText("82%");fireEvent.click(screen.getByRole("button",{name:"Normaal patroon"}));await waitFor(()=>expect(apiMock).toHaveBeenCalledWith("/attention/snap/review",expect.objectContaining({method:"PUT"})))})
});
