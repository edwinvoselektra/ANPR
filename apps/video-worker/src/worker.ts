import type { CameraRepository, CaptureResult, ManagedCamera, WorkerLogger } from "./types.js";

export type Wait = (milliseconds: number, signal: AbortSignal) => Promise<void>;

export const wait: Wait = (milliseconds, signal) => new Promise((resolve) => {
  if (signal.aborted) return resolve();
  const timer = setTimeout(done, milliseconds);
  function done() { signal.removeEventListener("abort", done); clearTimeout(timer); resolve(); }
  signal.addEventListener("abort", done, { once: true });
});

export async function runCameraLoop(options: {
  camera: ManagedCamera;
  repository: CameraRepository;
  capture: (camera: ManagedCamera) => Promise<CaptureResult>;
  sampleIntervalMs: number;
  retryIntervalMs: number;
  signal: AbortSignal;
  logger: WorkerLogger;
  wait?: Wait;
}) {
  const sleep = options.wait ?? wait;
  let previousStatus: "ONLINE" | "OFFLINE" | undefined;
  while (!options.signal.aborted) {
    const attemptedAt = new Date();
    let result: CaptureResult;
    try {
      result = await options.capture(options.camera);
    } catch {
      result = { success: false, code: "CAPTURE_ERROR", message: "Het cameraframe kon niet veilig worden verwerkt.", responseTimeMs: 0 };
    }
    if (options.signal.aborted) break;
    try {
      if (result.success) {
        await options.repository.markOnline(options.camera.id, result.snapshotObjectId, attemptedAt);
        if (previousStatus !== "ONLINE") options.logger.info("[videoWorker] camera connected:", options.camera.name);
        previousStatus = "ONLINE";
        await sleep(options.sampleIntervalMs, options.signal);
      } else {
        await options.repository.markOffline(options.camera.id, result.code, result.message, attemptedAt);
        if (previousStatus !== "OFFLINE") options.logger.warn("[videoWorker] camera offline:", options.camera.name);
        previousStatus = "OFFLINE";
        options.logger.info(`[videoWorker] retrying camera in ${Math.round(options.retryIntervalMs / 1000)}s:`, options.camera.name);
        await sleep(options.retryIntervalMs, options.signal);
      }
    } catch {
      options.logger.error("[videoWorker] database status update failed; retrying safely");
      await sleep(options.retryIntervalMs, options.signal);
    }
  }
}

type RunningCamera = { configurationFingerprint: string; controller: AbortController; promise: Promise<void> };

function configurationFingerprint(camera: ManagedCamera) {
  return JSON.stringify([
    camera.name, camera.location, camera.rtspProtocol, camera.rtspHost, camera.rtspPort,
    camera.rtspPath, camera.rtspUsernameEncrypted, camera.rtspPasswordEncrypted
  ]);
}

export class CameraSupervisor {
  private readonly running = new Map<string, RunningCamera>();
  private stopped = false;

  constructor(private readonly options: {
    repository: CameraRepository;
    capture: (camera: ManagedCamera) => Promise<CaptureResult>;
    sampleIntervalMs: number;
    retryIntervalMs: number;
    logger: WorkerLogger;
    runLoop?: typeof runCameraLoop;
  }) {}

  async reconcile() {
    if (this.stopped) return;
    const cameras = await this.options.repository.listActive();
    const activeIds = new Set(cameras.map((camera) => camera.id));
    for (const [id, running] of this.running) {
      if (!activeIds.has(id)) {
        running.controller.abort();
        this.running.delete(id);
        await this.options.repository.markDisabled(id);
      }
    }
    for (const camera of cameras) {
      const existing = this.running.get(camera.id);
      const fingerprint = configurationFingerprint(camera);
      if (existing?.configurationFingerprint === fingerprint) continue;
      if (existing) existing.controller.abort();
      const controller = new AbortController();
      const loop = this.options.runLoop ?? runCameraLoop;
      const task: RunningCamera = { configurationFingerprint: fingerprint, controller, promise: Promise.resolve() };
      task.promise = loop({ ...this.options, camera, signal: controller.signal }).catch(() => {
        this.options.logger.error("[videoWorker] camera loop stopped unexpectedly; supervisor will restart it");
      }).finally(() => {
        if (!controller.signal.aborted && this.running.get(camera.id) === task) this.running.delete(camera.id);
      });
      this.running.set(camera.id, task);
    }
  }

  snapshot() { return { managedCameras: this.running.size, running: !this.stopped }; }

  async stop() {
    this.stopped = true;
    const tasks = [...this.running.values()];
    for (const task of tasks) task.controller.abort();
    this.running.clear();
    await Promise.allSettled(tasks.map((task) => task.promise));
  }
}
