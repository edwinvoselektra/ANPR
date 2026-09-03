// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));
import SettingsPage from "./page";

const preferences = { preference: { pushEnabled: false, allHitGroups: true, groupIds: [] }, subscriptions: [], groups: [{ id: "group", name: "Aandacht", color: "#dc2626" }] };
const requestPermission = vi.fn();
const subscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.mockImplementation((path: string, options?: RequestInit) => {
    if (path === "/notifications/preferences" && !options?.method) return Promise.resolve(preferences);
    if (path === "/notifications/config") return Promise.resolve({ configured: true, publicKey: "AQID", message: "Web Push is geconfigureerd." });
    if (path === "/notifications/subscriptions" && options?.method === "POST") return Promise.resolve({ message: "Meldingen zijn op dit apparaat ingeschakeld." });
    throw new Error(`Onverwachte API-aanroep: ${options?.method ?? "GET"} ${path}`);
  });
  requestPermission.mockResolvedValue("granted");
  subscribe.mockResolvedValue({ toJSON: () => ({ endpoint: "https://push.example/device", keys: { p256dh: "public-key", auth: "auth-key" } }) });
  Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default", requestPermission } });
  Object.defineProperty(window, "PushManager", { configurable: true, value: class PushManager {} });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe } }) } });
});
afterEach(() => cleanup());

describe("Web Push-toestemming", () => {
  it("laat de service worker een melding naar de interne detail-URL navigeren", () => {
    const serviceWorker = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
    expect(serviceWorker).toContain("notificationclick");
    expect(serviceWorker).toContain("event.notification.data?.url");
    expect(serviceWorker).toContain("existing.navigate(target)");
  });

  it("vraagt nooit automatisch toestemming bij het openen van Instellingen", async () => {
    render(<SettingsPage/>);
    expect(await screen.findByText("Web Push is geconfigureerd.")).toBeTruthy();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("vraagt pas na de expliciete knop en registreert daarna het eigen apparaat", async () => {
    render(<SettingsPage/>);
    fireEvent.click(await screen.findByRole("button", { name: "Meldingen op dit apparaat inschakelen" }));
    await waitFor(() => expect(requestPermission).toHaveBeenCalledOnce());
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/notifications/subscriptions", expect.objectContaining({ method: "POST" })));
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
  });
});
