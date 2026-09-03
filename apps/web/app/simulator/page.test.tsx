// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
  formatDate: () => "Nog niet"
}));

import Simulator from "./page";

const UDDEL = { id: "11111111-1111-4111-8111-111111111111", name: "Uddel Noord", location: "Uddel Noord" };
const CUSTOM = { id: "22222222-2222-4222-8222-222222222222", name: "Eigen Camera Dorp", location: "Dorpstraat 1" };

const cameraSelect = (container: HTMLElement) => container.querySelector("select") as HTMLSelectElement;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("simulator camerakeuze", () => {
  it("laadt camera's dynamisch uit de API inclusief zelf toegevoegde camera's", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/simulator") return Promise.resolve({ enabled: true, cameras: [UDDEL, CUSTOM] });
      throw new Error(`Onverwachte API-aanroep: ${path}`);
    });

    const { container } = render(<Simulator />);

    expect(await screen.findByText("Eigen Camera Dorp — Dorpstraat 1")).toBeTruthy();
    expect(screen.getByText("Uddel Noord")).toBeTruthy();
    expect(cameraSelect(container).value).toBe(UDDEL.id);
  });

  it("stuurt de gekozen camera-id mee bij het genereren van een demopassage", async () => {
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/simulator" && !options?.method) return Promise.resolve({ enabled: true, cameras: [UDDEL, CUSTOM] });
      if (path === "/simulator/passages" && options?.method === "POST") return Promise.resolve({ passage: { displayLicensePlate: "12-ABC-3", source: "DEMO" }, hit: false });
      throw new Error(`Onverwachte API-aanroep: ${options?.method ?? "GET"} ${path}`);
    });

    const { container } = render(<Simulator />);
    await screen.findByText("Eigen Camera Dorp — Dorpstraat 1");

    fireEvent.change(cameraSelect(container), { target: { value: CUSTOM.id } });
    fireEvent.click(screen.getByRole("button", { name: "DEMO-passage genereren" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/simulator/passages", expect.objectContaining({ method: "POST" })));
    const call = apiMock.mock.calls.find(([path, options]) => path === "/simulator/passages" && options?.method === "POST");
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toEqual(expect.objectContaining({ cameraId: CUSTOM.id }));
    expect(await screen.findByText("DEMO-passage aangemaakt")).toBeTruthy();
  });

  it("stuurt gekozen rijrichting en tijdstip gecontroleerd mee", async () => {
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/simulator" && !options?.method) return Promise.resolve({ enabled: true, cameras: [UDDEL] });
      if (path === "/simulator/passages" && options?.method === "POST") return Promise.resolve({ passage: { displayLicensePlate: "12-ABC-3", source: "DEMO" }, hit: true });
      throw new Error(`Onverwachte API-aanroep: ${options?.method ?? "GET"} ${path}`);
    });
    render(<Simulator />);
    await screen.findByText("Uddel Noord");
    fireEvent.change(screen.getByLabelText("Rijrichting"), { target: { value: "OUTGOING" } });
    fireEvent.change(screen.getByLabelText("Tijdstip (optioneel)"), { target: { value: "2026-09-03T20:15" } });
    fireEvent.click(screen.getByRole("button", { name: "DEMO-passage genereren" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/simulator/passages", expect.objectContaining({ method: "POST" })));
    const call = apiMock.mock.calls.find(([path, options]) => path === "/simulator/passages" && options?.method === "POST");
    expect(JSON.parse((call?.[1] as RequestInit).body as string)).toMatchObject({ direction: "OUTGOING" });
    expect(await screen.findByText("DEMO-HIT aangemaakt")).toBeTruthy();
  });

  it("toont een duidelijke lege staat zonder actieve camera's en blokkeert genereren", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/simulator") return Promise.resolve({ enabled: true, cameras: [] });
      throw new Error(`Onverwachte API-aanroep: ${path}`);
    });

    render(<Simulator />);

    expect(await screen.findByText("Geen actieve camera's beschikbaar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "DEMO-passage genereren" }).hasAttribute("disabled")).toBe(true);
  });
});
