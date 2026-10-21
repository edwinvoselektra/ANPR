// @vitest-environment jsdom
import React from "react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
const apiMock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",async importOriginal=>({...await importOriginal<typeof import("@/lib/api")>(),api:apiMock}));
import {ApiError} from "@/lib/api";
import {ItsapiSetup} from "./ItsapiSetup";
let persisted:Record<string,unknown>;
beforeEach(()=>{
  persisted={receiverOrigin:"http://192.0.2.1:7070",expectedSourceIp:null,expectedDeviceId:"synthetic",protocolVersion:"V1.19",heartbeatSeconds:300,authenticationEnabled:false};
  apiMock.mockImplementation(async(_path:string,options?:RequestInit)=>{
    if(options?.method==="PUT"){persisted={...persisted,...JSON.parse(options.body as string)};return {message:"Uploadinstellingen opgeslagen."}}
    return {registration:{...persisted},publishedPort:7070};
  });
});
afterEach(()=>{cleanup();vi.resetAllMocks()});
it.each(["192.0.2.11",""])("slaat bron %s op, leest serverwaarde terug en herstelt bij heropenen",async value=>{
  persisted.expectedSourceIp="192.0.2.12";
  const view=render(<ItsapiSetup cameraId="fixture" cameraHost="192.0.2.201"/>);
  const input=await screen.findByLabelText<HTMLInputElement>("Verwachte bron-IP (VPN/NAT)");
  expect(input.value).toBe("192.0.2.12");
  expect(screen.getByText("192.0.2.201")).toBeTruthy();
  fireEvent.change(input,{target:{value}});
  fireEvent.click(screen.getByRole("button",{name:"Uploadinstellingen opslaan"}));
  await screen.findByText("Uploadinstellingen opgeslagen.");
  const request=apiMock.mock.calls.find(([,options])=>options?.method==="PUT")!;
  expect(JSON.parse(request[1].body)).toMatchObject({expectedSourceIp:value,expectedDeviceId:"synthetic",authenticationEnabled:false});
  expect(JSON.parse(request[1].body).rtspHost).toBeUndefined();
  expect(apiMock.mock.calls.filter(([,options])=>options?.method!=="PUT")).toHaveLength(2);
  view.unmount();
  render(<ItsapiSetup cameraId="fixture"/>);
  expect((await screen.findByLabelText<HTMLInputElement>("Verwachte bron-IP (VPN/NAT)")).value).toBe(value);
});
it("toont Nederlandse veldvalidatie uit de API",async()=>{
  render(<ItsapiSetup cameraId="fixture"/>);
  await screen.findByLabelText("Verwachte bron-IP (VPN/NAT)");
  apiMock.mockRejectedValueOnce(new ApiError("Controleer de ingevulde gegevens.",400,{expectedSourceIp:["Vul een geldig IPv4-adres in of laat het veld leeg."]}));
  fireEvent.click(screen.getByRole("button",{name:"Uploadinstellingen opslaan"}));
  expect(await screen.findByText("Vul een geldig IPv4-adres in of laat het veld leeg.")).toBeTruthy();
});
it("toont databasefout zonder succes te melden",async()=>{
  render(<ItsapiSetup cameraId="fixture"/>);
  await screen.findByLabelText("Verwachte bron-IP (VPN/NAT)");
  apiMock.mockRejectedValueOnce(new ApiError("Er ging intern iets mis.",500));
  fireEvent.click(screen.getByRole("button",{name:"Uploadinstellingen opslaan"}));
  await screen.findByText("Er ging intern iets mis.");
  expect(screen.queryByText("Uploadinstellingen opgeslagen.")).toBeNull();
});
it("blokkeert leeg overschrijven na laadfout en kan opnieuw laden",async()=>{
  apiMock.mockRejectedValueOnce(new ApiError("Er ging intern iets mis.",500));
  render(<ItsapiSetup cameraId="fixture"/>);
  expect((await screen.findByRole("alert")).textContent).toContain("Er ging intern iets mis.");
  expect(screen.queryByRole("button",{name:"Uploadinstellingen opslaan"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Uploadinstellingen opnieuw laden"}));
  await screen.findByLabelText("Verwachte bron-IP (VPN/NAT)");
});
it("maakt mislukte herlezing na opslaan zichtbaar",async()=>{
  render(<ItsapiSetup cameraId="fixture"/>);
  await screen.findByLabelText("Verwachte bron-IP (VPN/NAT)");
  apiMock.mockResolvedValueOnce({message:"Uploadinstellingen opgeslagen."}).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button",{name:"Uploadinstellingen opslaan"}));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("opgeslagen, maar opnieuw ophalen is mislukt"));
});
