// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {
    constructor(message: string, public status: number, public fields?: Record<string, string[]>, public code?: string) { super(message); }
  },
  formatDate: () => "Nog niet"
}));

import { ApiError } from "@/lib/api";
import Users from "./page";

const ME_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ROLE = { id: "55555555-5555-4555-8555-555555555555", name: "Administrator" };
const OPERATOR_ROLE = { id: "66666666-6666-4666-8666-666666666666", name: "Operator" };

const otherUser = { id: OTHER_ID, email: "jan@example.com", username: "jan", displayName: "Jan", active: true, roles: [{ role: OPERATOR_ROLE }] };
const meUser = { id: ME_ID, email: "ik@example.com", username: "ik", displayName: "Ik", active: true, roles: [{ role: ADMIN_ROLE }] };

const setupApi = (overrides: Record<string, (path: string, options?: RequestInit) => Promise<unknown>> = {}) => {
  apiMock.mockImplementation((path: string, options?: RequestInit) => {
    const override = overrides[`${options?.method ?? "GET"} ${path}`];
    if (override) return override(path, options);
    if (path === "/users" && !options?.method) return Promise.resolve({ users: [otherUser, meUser] });
    if (path === "/roles" && !options?.method) return Promise.resolve({ roles: [ADMIN_ROLE, OPERATOR_ROLE] });
    if (path === "/auth/me") return Promise.resolve({ user: { id: ME_ID } });
    throw new Error(`Onverwachte API-aanroep: ${options?.method ?? "GET"} ${path}`);
  });
};

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("gebruikersbeheer interface", () => {
  it("vraagt bevestiging en verwijdert een andere gebruiker definitief", async () => {
    setupApi({ [`DELETE /users/${OTHER_ID}`]: () => Promise.resolve(undefined) });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<Users />);
    expect(await screen.findByText("Jan")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Gebruiker Jan verwijderen" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/users/${OTHER_ID}`, { method: "DELETE" }));
    expect(await screen.findByText("Jan is verwijderd.")).toBeTruthy();
  });

  it("verwijdert niets wanneer de bevestiging wordt geweigerd", async () => {
    setupApi();
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<Users />);
    await screen.findByText("Jan");

    fireEvent.click(screen.getByRole("button", { name: "Gebruiker Jan verwijderen" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Gebruiker Jan verwijderen" })).toBeTruthy());
    expect(apiMock.mock.calls.some(([path, options]) => path === `/users/${OTHER_ID}` && options?.method === "DELETE")).toBe(false);
  });

  it("toont geen verwijderknop voor het eigen account", async () => {
    setupApi();
    render(<Users />);
    await screen.findByText("Ik");

    expect(screen.queryByRole("button", { name: "Gebruiker Ik verwijderen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Gebruiker Jan verwijderen" })).toBeTruthy();
  });

  it("blokkeert rolwijziging en uitschakelen voor het eigen administratoraccount in de interface", async () => {
    setupApi();
    render(<Users />);
    await screen.findByText("Ik");

    expect((screen.getByLabelText("Rol van Ik") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText("Je kunt je eigen rol niet wijzigen.")).toBeTruthy();
    const ownDisable = screen.getByTitle("Je kunt je eigen account niet uitschakelen.") as HTMLButtonElement;
    expect(ownDisable.disabled).toBe(true);
  });
});

describe("rollen en wachtwoord in de interface", () => {
  it("wijzigt de rol van een gebruiker via de rolkeuze", async () => {
    setupApi({ [`PATCH /users/${OTHER_ID}`]: () => Promise.resolve({ user: otherUser }) });
    render(<Users />);
    expect(await screen.findByText("Jan")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Rol van Jan"), { target: { value: ADMIN_ROLE.id } });

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/users/${OTHER_ID}`, expect.objectContaining({ method: "PATCH" })));
    const call = apiMock.mock.calls.find(([path, options]) => path === `/users/${OTHER_ID}` && options?.method === "PATCH");
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ roleIds: [ADMIN_ROLE.id] });
    expect(await screen.findByText("Rol van Jan gewijzigd naar Administrator.")).toBeTruthy();
  });

  it("reset het wachtwoord via de dialoog en meldt actieve sessies af", async () => {
    setupApi({ [`PATCH /users/${OTHER_ID}`]: () => Promise.resolve({ user: otherUser }) });
    render(<Users />);
    await screen.findByText("Jan");

    fireEvent.click(screen.getByRole("button", { name: "Wachtwoord wijzigen van Jan" }));
    fireEvent.change(screen.getByLabelText("Nieuw wachtwoord"), { target: { value: "NieuwSterkWacht1" } });
    fireEvent.change(screen.getByLabelText("Herhaal nieuw wachtwoord"), { target: { value: "NieuwSterkWacht1" } });
    fireEvent.click(screen.getByRole("button", { name: "Wachtwoord opslaan" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/users/${OTHER_ID}`, expect.objectContaining({ method: "PATCH" })));
    const call = apiMock.mock.calls.find(([path, options]) => path === `/users/${OTHER_ID}` && options?.method === "PATCH");
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual({ password: "NieuwSterkWacht1" });
    expect(await screen.findByText(/Alle actieve sessies van deze gebruiker zijn afgemeld/)).toBeTruthy();
  });

  it("toont de Nederlandse serverfout bij een geweigerde verwijdering", async () => {
    const errorMessage = "De laatste actieve administrator kan niet worden verwijderd. Maak eerst een andere administrator aan.";
    setupApi({ [`DELETE /users/${OTHER_ID}`]: () => Promise.reject(new ApiError(errorMessage, 409, undefined, "LAST_ACTIVE_ADMIN")) });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<Users />);
    await screen.findByText("Jan");

    fireEvent.click(screen.getByRole("button", { name: "Gebruiker Jan verwijderen" }));

    expect(await screen.findByText(/De laatste actieve administrator kan niet worden verwijderd/)).toBeTruthy();
  });
});
