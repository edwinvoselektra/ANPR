// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@anpr/shared";

const apiMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const routerMock = vi.hoisted(() => ({ replace: replaceMock }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => routerMock
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public fields?: Record<string, string[]>, public code?: string) { super(message); }
  }
}));

import { ApiError } from "@/lib/api";
import { AppShell } from "./app-shell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ADMIN-navigatie", () => {
  it("toont Gebruikers aan een Administrator met users.manage", async () => {
    apiMock.mockResolvedValue({
      user: {
        id: "admin",
        displayName: "Beheerder",
        username: "admin",
        roles: ["Administrator"],
        permissions: [PERMISSIONS.USERS_MANAGE]
      }
    });

    render(<AppShell><div>Inhoud</div></AppShell>);

    const link = await screen.findByRole("link", { name: "Gebruikers" });
    expect(link.getAttribute("href")).toBe("/users");
  });

  it("toont de geactiveerde analysepagina's zonder label Later", async () => {
    apiMock.mockResolvedValue({
      user: {
        id: "admin", displayName: "Beheerder", username: "admin", roles: ["Administrator"],
        permissions: [PERMISSIONS.PASSAGES_VIEW, PERMISSIONS.HITS_VIEW, PERMISSIONS.PLATES_MANAGE]
      }
    });
    render(<AppShell><div>Inhoud</div></AppShell>);

    for (const name of ["Hits", "Zoeken", "Kentekens", "Groepen"]) {
      expect((await screen.findByRole("link", { name })).getAttribute("href")).toBeTruthy();
    }
  });

  it("toont Instellingen als echte pagina zonder label Later", async () => {
    apiMock.mockResolvedValue({ user: { id: "viewer", displayName: "Viewer", username: "viewer", roles: ["Viewer"], permissions: [] } });
    render(<AppShell><div>Inhoud</div></AppShell>);
    expect((await screen.findByRole("link", { name: "Instellingen" })).getAttribute("href")).toBe("/settings");
    expect(screen.queryByText("Instellingen", { selector: ".nav-disabled" })).toBeNull();
  });

  it("toont Gebruikers niet aan een Operator zonder users.manage", async () => {
    apiMock.mockResolvedValue({
      user: {
        id: "operator",
        displayName: "Operator",
        username: "operator",
        roles: ["Operator"],
        permissions: [PERMISSIONS.PASSAGES_VIEW]
      }
    });

    render(<AppShell><div>Inhoud</div></AppShell>);

    expect(await screen.findByText("Inhoud")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Gebruikers" })).toBeNull();
  });
});

describe("beveiligde startflow", () => {
  const user = { id: "user", displayName: "Gebruiker", username: "gebruiker", roles: ["Viewer"], permissions: [] };

  it("toont het dashboard na een geldige sessie", async () => {
    apiMock.mockResolvedValue({ user });
    render(<AppShell><div>Dashboardinhoud</div></AppShell>);
    expect(await screen.findByText("Dashboardinhoud")).toBeTruthy();
    expect(document.querySelector('[data-auth-state="loading"]')).toBeNull();
  });

  it.each([
    ["ontbrekende sessie", 401, "AUTH_REQUIRED"],
    ["verlopen sessie", 401, "SESSION_INVALID"],
    ["geweigerde sessie", 403, "FORBIDDEN"]
  ])("stuurt bij een %s naar login en beëindigt de loading-state", async (_label, status, code) => {
    apiMock.mockRejectedValue(new ApiError("Log opnieuw in.", status, undefined, code));
    render(<AppShell><div>Dashboardinhoud</div></AppShell>);
    expect(await screen.findByText("Sessie verlopen")).toBeTruthy();
    expect(replaceMock).toHaveBeenCalledWith("/login");
    expect(screen.getByRole("link", { name: "Naar inloggen" }).getAttribute("href")).toBe("/login");
    expect(document.querySelector('[data-auth-state="loading"]')).toBeNull();
  });

  it("toont een herstelbare fout bij een API-fout", async () => {
    apiMock.mockRejectedValue(new ApiError("Interne fout", 500));
    render(<AppShell><div>Dashboardinhoud</div></AppShell>);
    expect(await screen.findByText("Sessiecontrole mislukt")).toBeTruthy();
    expect(screen.getByText("Sessie kon niet worden gecontroleerd. Probeer het opnieuw of log opnieuw in.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Opnieuw proberen" })).toBeTruthy();
  });

  it("toont een herstelbare fout als de API niet bereikbaar is", async () => {
    apiMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<AppShell><div>Dashboardinhoud</div></AppShell>);
    expect(await screen.findByText("Sessiecontrole mislukt")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Naar inloggen" })).toBeTruthy();
  });

  it("weigert een ongeldig sessieantwoord zonder te blijven laden", async () => {
    apiMock.mockResolvedValue({ user: { id: "onvolledig" } });
    render(<AppShell><div>Dashboardinhoud</div></AppShell>);
    expect(await screen.findByText("Sessiecontrole mislukt")).toBeTruthy();
    expect(document.querySelector('[data-auth-state="loading"]')).toBeNull();
  });

  it("breekt een hangende sessiecontrole na tien seconden af", async () => {
    vi.useFakeTimers();
    apiMock.mockImplementation((_path: string, options?: RequestInit) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Afgebroken", "AbortError")));
    }));
    render(<AppShell><div>Dashboardinhoud</div></AppShell>);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    expect(screen.getByText("Sessiecontrole mislukt")).toBeTruthy();
    expect(document.querySelector('[data-auth-state="loading"]')).toBeNull();
  });

  it("kan de sessiecontrole opnieuw proberen", async () => {
    apiMock.mockRejectedValueOnce(new ApiError("Tijdelijk onbereikbaar", 500)).mockResolvedValueOnce({ user });
    render(<AppShell><div>Dashboardinhoud</div></AppShell>);
    fireEvent.click(await screen.findByRole("button", { name: "Opnieuw proberen" }));
    expect(await screen.findByText("Dashboardinhoud")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it("trekt bij uitloggen de sessie in en navigeert naar login", async () => {
    apiMock.mockResolvedValueOnce({ user }).mockResolvedValueOnce({ success: true });
    render(<AppShell><div>Dashboardinhoud</div></AppShell>);
    fireEvent.click(await screen.findByRole("button", { name: "Uitloggen" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/auth/logout", { method: "POST" }));
    expect(replaceMock).toHaveBeenCalledWith("/login");
  });
});
