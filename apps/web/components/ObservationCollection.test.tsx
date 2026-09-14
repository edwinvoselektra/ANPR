// @vitest-environment jsdom
import React from "react";
import {render,screen,cleanup,fireEvent} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
vi.mock("./app-shell",()=>({useCurrentUser:()=>({id:"fixture-user"})}));
import {ObservationCollection} from "./ObservationCollection";
import {useViewPreference,ViewPreference} from "./ViewPreference";
const item={id:"fixture",passageId:"passage",plate:"TEST12",camera:"Camera Noord",location:"Uddel",timestamp:"2026-07-14T12:42:16Z",timeZone:"Europe/Amsterdam",direction:"INCOMING",source:"DEMO",hit:true,groups:[{id:"g",name:"Aandacht",reason:"Testreden"}]};
afterEach(()=>{cleanup();localStorage.clear()});
it.each(["list","tiles"] as const)("renders passage and hit in %s with local time and direction",mode=>{const {unmount}=render(<ObservationCollection items={[item]} mode={mode} kind="passages"/>);expect(screen.getByText("14-07-2026 14:42:16")).toBeTruthy();expect(screen.getByText("↓ Inkomend")).toBeTruthy();expect(screen.getByRole("link").getAttribute("href")).toBe("/passages/fixture");unmount();render(<ObservationCollection items={[item]} mode={mode} kind="hits"/>);expect(screen.getByText("Testreden")).toBeTruthy();expect(screen.getByRole("link").getAttribute("href")).toBe("/hits/fixture")});
function Choice({page}:{page:"passages"|"hits"}){const[mode,setMode]=useViewPreference(page);return <ViewPreference mode={mode} onChange={setMode}/>}
it.each(["passages","hits"] as const)("persists %s view after remount and isolates pages",page=>{const{unmount}=render(<Choice page={page}/>);fireEvent.click(screen.getByRole("button",{name:/Lijst/}));expect(localStorage.getItem(`anpr-view-v1:fixture-user:${page}`)).toBe("list");unmount();render(<Choice page={page}/>);expect(screen.getByRole("button",{name:/Lijst/}).getAttribute("aria-pressed")).toBe("true");fireEvent.click(screen.getByRole("button",{name:/Tegels/}));expect(localStorage.getItem(`anpr-view-v1:fixture-user:${page}`)).toBe("tiles")});
