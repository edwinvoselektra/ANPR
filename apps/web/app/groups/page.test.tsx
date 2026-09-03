// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@anpr/shared";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {}
}));

import GroupsPage from "./page";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("bestaande groep bewerken", () => {
  it("wijzigt de bestaande seedgroep via PATCH met hetzelfde ID en toont opnieuw opgehaalde waarden", async () => {
    Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
    let group = {
      id: GROUP_ID, name: "Aandacht", description: "DEMO-signaleringsgroep", color: "#dc2626", icon: null,
      active: true, hitEnabled: true, reasonRequired: true, _count: { members: 2 }
    };
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/auth/me") return Promise.resolve({ user: { permissions: [PERMISSIONS.PLATES_MANAGE] } });
      if (path === "/plate-groups" && !options?.method) return Promise.resolve({ groups: [group] });
      if (path === `/plate-groups/${GROUP_ID}` && options?.method === "PATCH") {
        const body = JSON.parse(options.body as string);
        group = { ...group, ...body };
        return Promise.resolve({ group });
      }
      throw new Error(`Onverwachte API-aanroep: ${options?.method ?? "GET"} ${path}`);
    });

    const { container } = render(<GroupsPage />);
    expect(await screen.findByText("DEMO-signaleringsgroep")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
    fireEvent.change(screen.getByDisplayValue("Aandacht"), { target: { value: "Aandacht gewijzigd" } });
    fireEvent.change(screen.getByDisplayValue("DEMO-signaleringsgroep"), { target: { value: "Nieuwe omschrijving" } });
    fireEvent.change(container.querySelector('input[type="color"]')!, { target: { value: "#123456" } });
    fireEvent.change(container.querySelector('input[placeholder="alert"]')!, { target: { value: "" } });
    for (const checkbox of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(`/plate-groups/${GROUP_ID}`, expect.objectContaining({ method: "PATCH" })));
    const call = apiMock.mock.calls.find(([path, options]) => path === `/plate-groups/${GROUP_ID}` && options?.method === "PATCH");
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toMatchObject({
      name: "Aandacht gewijzigd", description: "Nieuwe omschrijving", color: "#123456", icon: null,
      active: false, hitEnabled: false, reasonRequired: false
    });
    expect(await screen.findByText("Groep gewijzigd en opgeslagen.")).toBeTruthy();
    expect(await screen.findByText("Aandacht gewijzigd")).toBeTruthy();
    expect(apiMock.mock.calls.filter(([path, options]) => path === "/plate-groups" && !options?.method)).toHaveLength(2);
  });
});
