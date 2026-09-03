// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@anpr/shared";

const apiMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: replaceMock })
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));

import { AppShell } from "./app-shell";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ADMIN-navigatie", () => {
  it("toont Gebruikers aan een Administrator met users.manage", async () => {
    apiMock.mockResolvedValue({
      user: {
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
        displayName: "Beheerder", username: "admin", roles: ["Administrator"],
        permissions: [PERMISSIONS.PASSAGES_VIEW, PERMISSIONS.HITS_VIEW, PERMISSIONS.PLATES_MANAGE]
      }
    });
    render(<AppShell><div>Inhoud</div></AppShell>);

    for (const name of ["Hits", "Zoeken", "Kentekens", "Groepen"]) {
      expect((await screen.findByRole("link", { name })).getAttribute("href")).toBeTruthy();
    }
  });

  it("toont Instellingen als echte pagina zonder label Later", async () => {
    apiMock.mockResolvedValue({ user: { displayName: "Viewer", username: "viewer", roles: ["Viewer"], permissions: [] } });
    render(<AppShell><div>Inhoud</div></AppShell>);
    expect((await screen.findByRole("link", { name: "Instellingen" })).getAttribute("href")).toBe("/settings");
    expect(screen.queryByText("Instellingen", { selector: ".nav-disabled" })).toBeNull();
  });

  it("toont Gebruikers niet aan een Operator zonder users.manage", async () => {
    apiMock.mockResolvedValue({
      user: {
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
