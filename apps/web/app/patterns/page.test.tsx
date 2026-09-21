// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock, formatDate: () => "18-09-2026 12:00" }));
import PatternsPage from "./page";

const response = { patterns: [], total: 51, page: 1, limit: 50, totalPages: 2, sort: "scoreDesc" };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.mockImplementation((path: string) => {
    if (path === "/cameras") return Promise.resolve({ cameras: [] });
    if (path.startsWith("/attention/patterns?")) {
      const page = new URLSearchParams(path.split("?")[1]).get("page");
      return Promise.resolve({ ...response, page: Number(page) });
    }
    throw new Error(`Onverwachte API-aanroep: ${path}`);
  });
});
afterEach(() => cleanup());

describe("Opvallende patronen", () => {
  it("vraagt standaard de hoogste aandachtsscore eerst op", async () => {
    render(<PatternsPage/>);
    expect((screen.getByLabelText("Sorteren") as HTMLSelectElement).value).toBe("scoreDesc");
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/attention/patterns?sort=scoreDesc&page=1&limit=50", { cache: "no-store" }));
  });

  it("behoudt sortering en filters bij paginering", async () => {
    render(<PatternsPage/>);
    await screen.findByText("Pagina 1 van 2");
    fireEvent.change(screen.getByLabelText("Sorteren"), { target: { value: "scoreAsc" } });
    fireEvent.change(screen.getByLabelText("Minimumscore"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Filteren" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/attention/patterns?sort=scoreAsc&page=1&limit=50&minScore=10", { cache: "no-store" }));
    fireEvent.click(screen.getByRole("button", { name: "Volgende" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/attention/patterns?sort=scoreAsc&page=2&limit=50&minScore=10", { cache: "no-store" }));
  });
});
