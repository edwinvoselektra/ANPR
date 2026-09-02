// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: apiMock }));
import System from "./page";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("systeemstatus", () => {
  it("toont workerstatus en databasecamera's zonder hardcoded namen", async () => {
    apiMock.mockResolvedValue({
      services: { videoWorker: { status: "healthy", message: "2 actieve camera's in beheer." }, anprWorker: { status: "not_implemented" } },
      cameras: [
        { id: "1", name: "Dynamische Noordcamera", location: "Uddel", active: true, status: "ONLINE" },
        { id: "2", name: "Dynamische Westcamera", location: "Uddel", active: true, status: "OFFLINE" }
      ],
      demoMode: true,
      version: "0.2.1"
    });

    render(<System />);

    expect(await screen.findByText("Dynamische Noordcamera")).toBeTruthy();
    expect(screen.getByText("Dynamische Westcamera")).toBeTruthy();
    expect(screen.getByText("2 actieve camera's in beheer.")).toBeTruthy();
  });
});
