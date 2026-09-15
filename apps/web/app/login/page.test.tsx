// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock=vi.hoisted(()=>vi.fn<(path:string,options?:RequestInit)=>Promise<{user:Record<string,never>}>>(()=>Promise.resolve({user:{}})));
const replaceMock=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/api",()=>({api:apiMock,ApiError:class ApiError extends Error{}}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:replaceMock})}));
import LoginPage from "./page";

afterEach(()=>{cleanup();vi.clearAllMocks()});

describe("inloggen onthouden",()=>{
  it("is standaard ingeschakeld en stuurt alleen credentials naar de login-API",async()=>{
    const storageSpy=vi.spyOn(Storage.prototype,"setItem");
    render(<LoginPage/>);
    expect((screen.getByRole("checkbox",{name:"Inloggegevens onthouden"}) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("E-mail of gebruikersnaam"),{target:{value:"beheerder"}});
    fireEvent.change(screen.getByLabelText("Wachtwoord"),{target:{value:"tijdelijk-geheim"}});
    fireEvent.click(screen.getByRole("button",{name:"Inloggen"}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalled());
    const body=JSON.parse(String(apiMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({identifier:"beheerder",password:"tijdelijk-geheim",remember:true});
    expect(storageSpy).not.toHaveBeenCalled();
    storageSpy.mockRestore();
  });

  it("stuurt de korte sessiekeuze wanneer de checkbox uit staat",async()=>{
    render(<LoginPage/>);
    fireEvent.change(screen.getByLabelText("E-mail of gebruikersnaam"),{target:{value:"beheerder"}});
    fireEvent.change(screen.getByLabelText("Wachtwoord"),{target:{value:"geheim"}});
    fireEvent.click(screen.getByRole("checkbox",{name:"Inloggegevens onthouden"}));
    fireEvent.click(screen.getByRole("button",{name:"Inloggen"}));
    await waitFor(()=>expect(apiMock).toHaveBeenCalled());
    expect(JSON.parse(String(apiMock.mock.calls[0]?.[1]?.body)).remember).toBe(false);
  });
});
