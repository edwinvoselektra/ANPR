// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const apiMock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({api:apiMock,formatDate:()=>"19-10-2026 19:09:38"}));
vi.mock("next/navigation",()=>({useParams:()=>({id:"fixture"})}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("@/components/PlateGroups",()=>({PlateGroups:()=>null}));
vi.mock("@/components/AttentionPanel",()=>({AttentionPanel:()=>null,AttentionBadge:()=>null}));
vi.mock("@/components/ViewPreference",()=>({useViewPreference:()=>["list",()=>{}],ViewPreference:()=>null}));
import Dashboard from "./page";
import LivePassages from "./passages/page";
import PassageDetail from "./passages/[id]/page";
import HitDetail from "./hits/[id]/page";
import SearchPage from "./search/page";

afterEach(()=>{cleanup();vi.clearAllMocks()});
describe("direction across passage views",()=>{
  it.each([["INCOMING","Inkomend"],["OUTGOING","Uitgaand"],["UNKNOWN","Onbekend"]])("shows stored %s consistently",async(direction,label)=>{
    const passage={id:"fixture",normalizedLicensePlate:"TEST12",displayLicensePlate:"TEST12",direction,source:"DAHUA_CAMERA",timestamp:"2026-10-19T17:09:38Z",timeZone:"Europe/Amsterdam",location:"Fixture",camera:{name:"Fixture",location:"Fixture"},vehicleColor:"BLUE",vehicleType:"CAR",isHit:true,rawEventMetadata:{},createdAt:"2026-10-19T17:09:39Z"};
    const hit={id:"fixture",passage,camera:passage.camera,groups:[],timestamp:passage.timestamp,timeZone:passage.timeZone,notificationStatus:"SENT"};
    apiMock.mockImplementation(async(path:string)=>{
      if(path==="/dashboard")return {counters:{cameraTotal:1,cameraOnline:1,passagesToday:1,hitsToday:1,watchedPlates:1},recentPassages:[passage],recentHits:[],cameraProblems:[]};
      if(path==="/passages/fixture")return {passage};
      if(path.startsWith("/passages"))return {passages:[passage]};
      if(path==="/hits/fixture")return {hit};
      if(path==="/cameras")return {cameras:[]};
      if(path==="/plate-groups")return {groups:[]};
      if(path.startsWith("/search/passages?"))return {passages:[passage],total:1,limit:25,timeZone:passage.timeZone};
      throw new Error("Unexpected test API path");
    });
    for(const Page of [Dashboard,LivePassages,PassageDetail,HitDetail]){
      const view=render(<Page/>);
      expect((await screen.findAllByText(new RegExp(`^(?:[↓↑] )?${label}$`))).length).toBeGreaterThan(0);
      view.unmount();
    }
    render(<SearchPage/>);
    const select=screen.getByRole("option",{name:"Alle richtingen"}).closest("select")!;
    fireEvent.change(select,{target:{value:direction}});
    fireEvent.click(screen.getByRole("button",{name:"Zoeken"}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalledWith(expect.stringContaining(`direction=${direction}`),{cache:"no-store"}));
    expect(await screen.findByText("TEST12")).toBeTruthy();
    expect(screen.getByRole("cell",{name:new RegExp(label)})).toBeTruthy();
  });
});
