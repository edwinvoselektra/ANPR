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
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

import Cameras from "./page";

const camera = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Te verwijderen camera",
  location: "Uddel",
  direction: "INCOMING",
  status: "DISABLED",
  active: false,
  _count: { passages: 0 }
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("cameraoverzicht verwijderen", () => {
  it("stuurt maximaal één DELETE en ververst de lijst zonder cache", async () => {
    let resolveDelete: (() => void) | undefined;
    const deleteResponse = new Promise<void>((resolve) => { resolveDelete = resolve; });
    let listRequests = 0;
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/cameras" && !options?.method) {
        listRequests += 1;
        return Promise.resolve({ cameras: listRequests === 1 ? [camera] : [] });
      }
      if (path === `/cameras/${camera.id}` && options?.method === "DELETE") return deleteResponse;
      throw new Error(`Onverwachte API-aanroep: ${path}`);
    });
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<Cameras />);
    expect(await screen.findByText("Te verwijderen camera")).toBeTruthy();

    const removeButton = screen.getByRole("button", { name: "Verwijderen" });
    fireEvent.click(removeButton);
    fireEvent.click(removeButton);

    expect(apiMock.mock.calls.filter(([path, options]) => path === `/cameras/${camera.id}` && options?.method === "DELETE")).toHaveLength(1);
    resolveDelete?.();

    await waitFor(() => expect(screen.queryByText("Te verwijderen camera")).toBeNull());
    expect(apiMock.mock.calls.filter(([path]) => path === "/cameras")).toHaveLength(2);
    expect(apiMock.mock.calls.filter(([path]) => path === "/cameras").every(([, options]) => options?.cache === "no-store")).toBe(true);
  });
});
