import { describe, expect, it, vi } from "vitest";
import { CameraSupervisor, runCameraLoop } from "./worker.js";
import type { CameraRepository, ManagedCamera, WorkerLogger } from "./types.js";

const camera = (id: string, name: string): ManagedCamera => ({
  id, name, location: "Uddel", rtspProtocol: "rtsp", rtspHost: "camera.invalid", rtspPort: 554,
  rtspPath: "/stream", rtspUsernameEncrypted: "encrypted-user", rtspPasswordEncrypted: "encrypted-password", updatedAt: new Date(0)
});
function dependencies() {
  const repository: CameraRepository = {
    listActive: vi.fn(), markOnline: vi.fn(), markOffline: vi.fn(), markDisabled: vi.fn()
  };
  const messages: string[] = [];
  const logger: WorkerLogger = {
    info: (message, name) => messages.push(`${message} ${name ?? ""}`),
    warn: (message, name) => messages.push(`${message} ${name ?? ""}`),
    error: (message) => messages.push(message)
  };
  return { repository, logger, messages };
}

describe("video-worker cameraloop", () => {
  it("markeert offline, probeert opnieuw en herstelt daarna naar online", async () => {
    const { repository, logger } = dependencies();
    const controller = new AbortController();
    const capture = vi.fn()
      .mockResolvedValueOnce({ success: false, code: "TIMEOUT", message: "Camera timeout", responseTimeMs: 100 })
      .mockResolvedValueOnce({ success: true, snapshotObjectId: "worker-snapshots/camera.jpg", responseTimeMs: 50 });
    let waits = 0;

    await runCameraLoop({ camera: camera("camera-1", "Uddel Noord"), repository, capture, sampleIntervalMs: 10_000, retryIntervalMs: 10_000,
      signal: controller.signal, logger, wait: async () => { waits += 1; if (waits === 2) controller.abort(); } });

    expect(repository.markOffline).toHaveBeenCalledOnce();
    expect(repository.markOnline).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("laat een offline camera een andere online camera niet blokkeren", async () => {
    const first = dependencies();
    const second = dependencies();
    const firstController = new AbortController();
    const secondController = new AbortController();

    await Promise.all([
      runCameraLoop({ camera: camera("camera-1", "Uddel West"), repository: first.repository,
        capture: async () => ({ success: false, code: "UNREACHABLE", message: "Niet bereikbaar", responseTimeMs: 20 }),
        sampleIntervalMs: 10_000, retryIntervalMs: 10_000, signal: firstController.signal, logger: first.logger,
        wait: async () => firstController.abort() }),
      runCameraLoop({ camera: camera("camera-2", "Hal Vos"), repository: second.repository,
        capture: async () => ({ success: true, snapshotObjectId: "worker-snapshots/camera-2.jpg", responseTimeMs: 20 }),
        sampleIntervalMs: 10_000, retryIntervalMs: 10_000, signal: secondController.signal, logger: second.logger,
        wait: async () => secondController.abort() })
    ]);

    expect(first.repository.markOffline).toHaveBeenCalledOnce();
    expect(second.repository.markOnline).toHaveBeenCalledOnce();
  });

  it("neemt credentials en volledige RTSP-URL nooit op in normale logs", async () => {
    const { repository, logger, messages } = dependencies();
    const controller = new AbortController();
    const managed = camera("camera-1", "Veilige camera");

    await runCameraLoop({ camera: managed, repository,
      capture: async () => ({ success: false, code: "AUTHENTICATION_FAILED", message: "Veilige melding", responseTimeMs: 10 }),
      sampleIntervalMs: 10_000, retryIntervalMs: 10_000, signal: controller.signal, logger,
      wait: async () => controller.abort() });

    const output = messages.join(" ");
    expect(output).toContain("Veilige camera");
    expect(output).not.toContain("encrypted-password");
    expect(output).not.toContain("rtsp://");
  });
});

describe("camera supervisor", () => {
  it("start alleen databasecamera's uit de actieve selectie en stopt uitgeschakelde camera's", async () => {
    const { repository, logger } = dependencies();
    const active = camera("camera-1", "Actieve camera");
    vi.mocked(repository.listActive).mockResolvedValueOnce([active]).mockResolvedValueOnce([]);
    const runLoop = vi.fn(async ({ signal }: { signal: AbortSignal }) => new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }));
    const supervisor = new CameraSupervisor({
      repository,
      capture: vi.fn(),
      sampleIntervalMs: 10_000,
      retryIntervalMs: 10_000,
      logger,
      runLoop: runLoop as typeof runCameraLoop
    });

    await supervisor.reconcile();
    expect(supervisor.snapshot().managedCameras).toBe(1);
    expect(runLoop).toHaveBeenCalledOnce();

    await supervisor.reconcile();
    expect(supervisor.snapshot().managedCameras).toBe(0);
    expect(repository.markDisabled).toHaveBeenCalledWith("camera-1");
    await supervisor.stop();
  });

  it("herstart een cameraloop niet door alleen een database-statusupdate", async () => {
    const { repository, logger } = dependencies();
    const firstRead = camera("camera-1", "Actieve camera");
    const afterStatusUpdate = { ...firstRead, updatedAt: new Date("2026-09-02T10:00:00Z") };
    vi.mocked(repository.listActive).mockResolvedValueOnce([firstRead]).mockResolvedValueOnce([afterStatusUpdate]);
    const runLoop = vi.fn(async ({ signal }: { signal: AbortSignal }) => new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    }));
    const supervisor = new CameraSupervisor({ repository, capture: vi.fn(), sampleIntervalMs: 10_000,
      retryIntervalMs: 10_000, logger, runLoop: runLoop as typeof runCameraLoop });

    await supervisor.reconcile();
    await supervisor.reconcile();

    expect(runLoop).toHaveBeenCalledOnce();
    await supervisor.stop();
  });
});
