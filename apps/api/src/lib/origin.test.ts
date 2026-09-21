import { describe, expect, it } from "vitest";
import { isAllowedWebOrigin } from "./origin.js";

describe("toegestane web-origin", () => {
  const configured = "http://localhost:3000";

  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.1.25:3000",
    "http://10.10.0.4:3000",
    "http://anpr-server.local:3000",
    "http://anpr-server:3000"
  ])("accepteert de lokale ontwikkelorigin %s", (origin) => {
    expect(isAllowedWebOrigin(origin, configured, "development")).toBe(true);
  });

  it("accepteert in productie uitsluitend de exact geconfigureerde HTTPS-origin", () => {
    const publicOrigin = "https://anpr.vanmilligentechniek.com";
    expect(isAllowedWebOrigin(publicOrigin, publicOrigin, "production")).toBe(true);
    expect(isAllowedWebOrigin("http://192.168.1.25:3000", publicOrigin, "production")).toBe(false);
    expect(isAllowedWebOrigin("https://kwaad.example", publicOrigin, "production")).toBe(false);
  });

  it.each(["not-a-url", "http://example.com:3000", "http://192.168.1.25:4000", "http://[2001:4860:4860::8888]:3000"])("weigert %s", (origin) => {
    expect(isAllowedWebOrigin(origin, configured, "development")).toBe(false);
  });
});
