// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const apiMock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",async(importOriginal)=>({...await importOriginal<typeof import("@/lib/api")>(),api:apiMock}));
import { ApiError } from "@/lib/api";
vi.mock("next/navigation",()=>({useParams:()=>({id:"fixture"}),useRouter:()=>({push:vi.fn()})}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("@/components/NativeAnprTest",()=>({NativeAnprTest:()=>null}));
import EditCamera from "./[id]/page";
afterEach(()=>{cleanup();vi.clearAllMocks()});
it.each(["TOWARD_CAMERA_IS_INCOMING","AWAY_FROM_CAMERA_IS_INCOMING"])("loads and saves direction inversion using existing %s",async(directionMapping)=>{
  apiMock.mockImplementation(async(path:string,options?:RequestInit)=>{
    if(options?.method==="PATCH")return {};
    if(path==="/locations")return {locations:[]};
    return {camera:{id:"fixture",name:"Fixture",location:"Fixture",description:null,latitude:null,longitude:null,hasUsername:true,hasPassword:true,direction:"BOTH",directionMapping,rtspEnabled:false,active:true,rtspPort:554,anprProvider:"DAHUA_ITSAPI",anprHttpProtocol:"http",anprHttpPort:80,anprChannel:1,offlineTimeoutSeconds:120}};
  });
  render(<EditCamera/>);
  const toggle=await screen.findByRole<HTMLInputElement>("checkbox",{name:"Richting omkeren"});
  expect(toggle.checked).toBe(directionMapping==="AWAY_FROM_CAMERA_IS_INCOMING");
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button",{name:"Wijzigingen opslaan"}));
  await waitFor(()=>expect(apiMock).toHaveBeenCalledWith("/cameras/fixture",expect.objectContaining({method:"PATCH"})));
  const options=apiMock.mock.calls.find(([,options])=>options?.method==="PATCH")![1];
  expect(JSON.parse(options.body)).toEqual({directionMapping:directionMapping==="TOWARD_CAMERA_IS_INCOMING"?"AWAY_FROM_CAMERA_IS_INCOMING":"TOWARD_CAMERA_IS_INCOMING"});
});


it("shows the precise API field error instead of only a general message",async()=>{
  apiMock.mockImplementation(async(path:string,options?:RequestInit)=>{
    if(options?.method==="PATCH")throw new ApiError("Controleer de ingevulde gegevens.",400,{directionMapping:["Kies een geldige fysieke richtingsmapping."]},"VALIDATION_ERROR");
    if(path==="/locations")return {locations:[]};
    return {camera:{name:"Fixture",location:"Fixture",directionMapping:"TOWARD_CAMERA_IS_INCOMING",rtspEnabled:false}};
  });
  render(<EditCamera/>);
  fireEvent.click(await screen.findByRole("checkbox",{name:"Richting omkeren"}));
  fireEvent.click(screen.getByRole("button",{name:"Wijzigingen opslaan"}));
  const alert=await screen.findByRole("alert");
  expect(alert.textContent).toContain("Fysieke richtingsmapping / Richting omkeren");
  expect(alert.textContent).toContain("Kies een geldige fysieke richtingsmapping.");
});

it("clears optional coordinates explicitly without sending empty secrets or unrelated legacy fields",async()=>{
  apiMock.mockImplementation(async(path:string,options?:RequestInit)=>{
    if(options?.method==="PATCH")return {};
    if(path==="/locations")return {locations:[]};
    return {camera:{name:"X",location:"X",description:null,direction:"UNKNOWN",latitude:"52.2",longitude:"5.7",directionMapping:"TOWARD_CAMERA_IS_INCOMING",rtspEnabled:false,hasUsername:true,hasPassword:true}};
  });
  render(<EditCamera/>);
  fireEvent.click(await screen.findByRole("checkbox",{name:"Richting omkeren"}));
  fireEvent.change(screen.getByLabelText("Latitude"),{target:{value:""}});
  fireEvent.change(screen.getByLabelText("Longitude"),{target:{value:""}});
  fireEvent.click(screen.getByRole("button",{name:"Wijzigingen opslaan"}));
  expect(await screen.findByRole("status")).toBeTruthy();
  const options=apiMock.mock.calls.find(([,options])=>options?.method==="PATCH")![1];
  expect(JSON.parse(options.body)).toEqual({directionMapping:"AWAY_FROM_CAMERA_IS_INCOMING",latitude:null,longitude:null});
});
