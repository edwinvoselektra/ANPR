import { describe, expect, it } from "vitest";
import { videoWorkerStatus } from "./health.js";

describe("video-worker heartbeat", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");

  it("rapporteert een recente actieve worker als gezond", () => {
    const raw = JSON.stringify({ timestamp: "2026-09-01T11:59:55.000Z", running: true, managedCameras: 4 });
    expect(videoWorkerStatus(raw, now)).toEqual({ status: "healthy", message: "4 actieve camera's in beheer." });
  });

  it("rapporteert een verlopen of ontbrekende heartbeat als offline", () => {
    const stale = JSON.stringify({ timestamp: "2026-09-01T11:59:40.000Z", running: true, managedCameras: 4 });
    expect(videoWorkerStatus(stale, now).status).toBe("unhealthy");
    expect(videoWorkerStatus(null, now).status).toBe("unhealthy");
  });
});
