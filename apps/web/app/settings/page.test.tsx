// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const apiMock = vi.hoisted(() => vi.fn());
const currentUser = vi.hoisted(() => ({ roles: ["Viewer"] as string[] }));
const formatDateMock = vi.hoisted(() => vi.fn(() => "14-09-2026 17:12:00"));
vi.mock("@/lib/api", () => ({ api: apiMock, formatDate: formatDateMock }));
vi.mock("@/components/app-shell", () => ({ useCurrentUser: () => currentUser }));
import SettingsPage from "./page";

const preferences = { preference: { pushEnabled: false, allHitGroups: true, groupIds: [] }, subscriptions: [], groups: [{ id: "group", name: "Aandacht", color: "#dc2626" }] };
const requestPermission = vi.fn();
const subscribe = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.roles = ["Viewer"];
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

describe("compact administratoroverzicht", () => {
  const overview = { storage: { programBytes: 6.4 * 1024 ** 3, storageBytes: 18.7 * 1024 ** 3, totalBytes: 25.1 * 1024 ** 3 }, storageNote: "Betrouwbaar meetbare onderdelen.", timeZone: "Europe/Amsterdam",
    activity: [{ id: "audit-1", createdAt: "2026-09-14T15:12:00Z", user: "Edwin van Milligen", action: "Camera gewijzigd", object: "ANPR Hal Vos", description: "Camera gewijzigd: ANPR Hal Vos." }] };

  it("toont opslag, lokale tijd en gesaneerde recente activiteit alleen aan ADMIN", async () => {
    currentUser.roles = ["Administrator"];
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/notifications/preferences" && !options?.method) return Promise.resolve(preferences);
      if (path === "/notifications/config") return Promise.resolve({ configured: true, message: "Web Push is geconfigureerd." });
      if (path === "/admin/overview") return Promise.resolve(overview);
      throw new Error(`Onverwachte API-aanroep: ${path}`);
    });
    render(<SettingsPage/>);
    expect(await screen.findByText("Systeemopslag")).toBeTruthy();
    expect(screen.getByText("6.4 GB")).toBeTruthy(); expect(screen.getByText("18.7 GB")).toBeTruthy(); expect(screen.getByText("25.1 GB")).toBeTruthy();
    expect(screen.getByText("Camera gewijzigd")).toBeTruthy(); expect(screen.getByText("ANPR Hal Vos")).toBeTruthy();
    expect(screen.getByText("14-09-2026 17:12:00")).toBeTruthy(); expect(formatDateMock).toHaveBeenCalledWith("2026-09-14T15:12:00Z", "Europe/Amsterdam");
    expect(document.body.textContent).not.toContain("token"); expect(document.body.textContent).not.toContain("password");
  });

  it("vraagt en toont beheerinformatie niet voor een niet-ADMIN", async () => {
    render(<SettingsPage/>); await screen.findByText("Web Push is geconfigureerd.");
    expect(apiMock).not.toHaveBeenCalledWith("/admin/overview", expect.anything());
    expect(screen.queryByText("Systeemopslag")).toBeNull(); expect(screen.queryByText("Recente activiteit")).toBeNull();
  });

  it("toont een nette melding bij een lege auditlog", async () => {
    currentUser.roles = ["ADMIN"];
    apiMock.mockImplementation((path: string) => path === "/notifications/preferences" ? Promise.resolve(preferences) : path === "/notifications/config" ? Promise.resolve({ configured: true, message: "Web Push is geconfigureerd." }) : Promise.resolve({ ...overview, activity: [] }));
    render(<SettingsPage/>); expect(await screen.findByText("Nog geen auditactiviteit vastgelegd.")).toBeTruthy();
  });
});
