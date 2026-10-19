// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlateGroups } from "./PlateGroups";

const mocks = vi.hoisted(() => ({ api: vi.fn(), permissions: ["plates.manage"] as string[] }));
vi.mock("@/lib/api", () => ({ api: mocks.api, formatDate: (value: string) => value }));
vi.mock("./app-shell", () => ({ useCurrentUser: () => ({ permissions: mocks.permissions, roles: [] }) }));
const first = { id: "one", name: "Bestaande groep", active: true, hitEnabled: false, reasonRequired: false };
const second = { id: "two", name: "Signalering", active: true, hitEnabled: true, reasonRequired: true };
const membership = { group: first, active: true, reason: null, validFrom: null, validUntil: null };
let memberships: Array<typeof membership>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.permissions = ["plates.manage"]; memberships = [membership];
  mocks.api.mockImplementation(async (_path: string, options?: RequestInit) => {
    if (options?.method === "PUT") { memberships = [...memberships, { ...membership, group: second }]; return; }
    if (options?.method === "DELETE") { memberships = []; return; }
    return { groups: [first, second, { ...second, id: "inactive", name: "Inactief", active: false }], memberships };
  });
});
afterEach(cleanup);
describe("groepen vanuit detail", () => {
  it("toont gekoppelde groepen en voegt een andere toe met reden", async () => {
    render(<PlateGroups normalized="12ABC3" />);
    await screen.findByText("Bestaande groep");
    fireEvent.click(screen.getByRole("button", { name: "Aan groep toevoegen" }));
    expect(screen.queryByRole("option", { name: "Bestaande groep" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Inactief" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Groep"), { target: { value: "two" } });
    fireEvent.change(screen.getByLabelText("Reden *"), { target: { value: "Controle gewenst" } });
    fireEvent.click(screen.getByRole("button", { name: "Toevoegen" }));
    await screen.findByRole("status");
    expect(mocks.api).toHaveBeenCalledWith("/plates/12ABC3/groups/two", { method: "PUT", body: JSON.stringify({ reason: "Controle gewenst" }) });
    expect(screen.getByText("Bestaande groep")).toBeTruthy();
    expect(screen.getByText("Signalering")).toBeTruthy();
  });
  it("verwijdert ook de laatste koppeling", async () => {
    render(<PlateGroups normalized="12ABC3" />);
    fireEvent.click(await screen.findByRole("button", { name: "Verwijder uit Bestaande groep" }));
    await screen.findByText("Geen groepen gekoppeld.");
    expect(mocks.api).toHaveBeenCalledWith("/plates/12ABC3/groups/one", { method: "DELETE" });
  });
  it("toont Viewer uitsluitend de gekoppelde groepen", async () => {
    mocks.permissions = []; render(<PlateGroups normalized="12ABC3" />);
    await screen.findByText("Bestaande groep");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("behoudt koppelingen en toont een API-fout bij mislukte mutatie", async () => {
    render(<PlateGroups normalized="12ABC3" />);
    const remove = await screen.findByRole("button", { name: "Verwijder uit Bestaande groep" });
    mocks.api.mockRejectedValueOnce(new Error("Opslaan mislukt")); fireEvent.click(remove);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Opslaan mislukt"));
    expect(screen.getByText("Bestaande groep")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
