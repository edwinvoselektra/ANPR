// @vitest-environment jsdom
import React from "react";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
const apiMock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",async importOriginal=>({...await importOriginal<typeof import("@/lib/api")>(),api:apiMock}));
vi.mock("next/navigation",()=>({useParams:()=>({id:"fixture"})}));
vi.mock("next/link",()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock("@/components/CameraDiagnostics",()=>({CameraDiagnostics:()=> <div>Diagnoseresultaten</div>}));
import Diagnose from "./page";
function setup(role:string){
  apiMock.mockImplementation(async(path:string)=>path==="/auth/me"?{user:{roles:[role]}}:path.endsWith("/itsapi")?{registration:null,publishedPort:7070}:{camera:{anprProvider:"DAHUA_ITSAPI",rtspHost:"192.0.2.201"}});
}
afterEach(()=>{cleanup();vi.resetAllMocks()});
it.each(["ADMIN","Administrator"])("toont voor %s het invoerveld direct zonder ingeklapte sectie",async role=>{
  setup(role);render(<Diagnose/>);
  const input=await screen.findByLabelText("Verwachte bron-IP (VPN/NAT)");
  expect(input.closest("details")).toBeNull();
  expect(screen.getByText("192.0.2.201")).toBeTruthy();
  expect(screen.getByRole("heading",{name:"ITSAPI-uploadinstellingen (admin)"})).toBeTruthy();
});
it("toont operator geen admininstellingen",async()=>{
  setup("OPERATOR");render(<Diagnose/>);
  await screen.findByText("Diagnoseresultaten");
  // Wait for both access checks to finish.
  await vi.waitFor(()=>expect(screen.queryByText("Toegang tot ITSAPI-instellingen controleren…")).toBeNull());
  expect(screen.queryByLabelText("Verwachte bron-IP (VPN/NAT)")).toBeNull();
  expect(apiMock.mock.calls.some(([path])=>path.endsWith("/itsapi"))).toBe(false);
});
it("verbergt API-fout niet stilzwijgend en biedt herstel",async()=>{
  setup("ADMIN");apiMock.mockRejectedValueOnce(new Error("Sessiecontrole mislukt."));
  render(<Diagnose/>);
  expect((await screen.findByRole("alert")).textContent).toContain("Sessiecontrole mislukt.");
  fireEvent.click(screen.getByRole("button",{name:"Opnieuw laden"}));
  await screen.findByLabelText("Verwachte bron-IP (VPN/NAT)");
});
