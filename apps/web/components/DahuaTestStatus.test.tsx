// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DahuaTestStatus, type DahuaTestResult } from "./DahuaTestStatus";

afterEach(cleanup);

const result = (overrides: Partial<DahuaTestResult> = {}): DahuaTestResult => ({
  success: false,
  tcpPortOpen: true,
  networkStatus: "REACHABLE",
  deviceApi: "NOT_CONFIRMED",
  authentication: "NOT_TESTED",
  message: "TCP-poort bereikbaar; gebruikersnaam/wachtwoord nog niet gevalideerd.",
  ...overrides
});

describe("Dahua teststatus", () => {
  it("presenteert een open poort zonder adapter niet als login- of verbindingssucces", () => {
    render(<DahuaTestStatus result={result()} />);

    expect(screen.getByText("Bereikbaar")).toBeTruthy();
    expect(screen.getByText("Niet bevestigd")).toBeTruthy();
    expect(screen.getByText("Niet getest")).toBeTruthy();
    expect(screen.queryByText("Geslaagd")).toBeNull();
    expect(screen.queryByText("Model")).toBeNull();
  });

  it("toont metadata uitsluitend na officiële apparaat- en authenticatiebevestiging", () => {
    render(<DahuaTestStatus result={result({ success: true, deviceApi: "CONFIRMED", authentication: "SUCCESS", model: "NVR-test", firmware: "1.2.3", channels: [{}, {}], message: "Geverifieerd." })} />);

    expect(screen.getByText("Bevestigd")).toBeTruthy();
    expect(screen.getByText("Geslaagd")).toBeTruthy();
    expect(screen.getByText("NVR-test")).toBeTruthy();
    expect(screen.getByText("1.2.3")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });
});
