// @vitest-environment jsdom
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PwaRegistration } from "./pwa-registration";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("haalt een service-workerupdate buiten de HTTP-cache op", async () => {
  const update = vi.fn().mockResolvedValue(undefined);
  const register = vi.fn().mockResolvedValue({ update });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register } });

  render(<PwaRegistration/>);

  await waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" }));
  expect(update).toHaveBeenCalledOnce();
});
