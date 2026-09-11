import type { AnprEventProvider, CameraRepository, ManagedAnprCamera, NormalizedAnprEvent, ProviderLogger } from "./types.js";

export type Wait = (milliseconds: number, signal: AbortSignal) => Promise<void>;
export const wait: Wait = (milliseconds, signal) => new Promise((resolve) => {
  if (signal.aborted) return resolve();
  const timer = setTimeout(done, milliseconds);
  function done() { signal.removeEventListener("abort", done); clearTimeout(timer); resolve(); }
  signal.addEventListener("abort", done, { once: true });
});

export function reconnectDelay(attempt: number, minMs: number, maxMs: number, random = Math.random) {
  const base = Math.min(maxMs, minMs * 2 ** Math.min(attempt, 12));
  return Math.round(base * (0.8 + random() * 0.4));
}

function safeFailure(error: unknown) {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "ANPR_STREAM_ERROR";
  const messages: Record<string, string> = {
    AUTHENTICATION_FAILED: "De camera heeft de ANPR-inloggegevens niet geaccepteerd.", INVALID_CAMERA_HOST: "De opgeslagen camerahost is ongeldig.",
    INVALID_ANPR_PROTOCOL: "Het ingestelde HTTP-protocol is ongeldig.", AUTH_SCHEME_UNSUPPORTED: "De authenticatiemethode van de camera wordt nog niet ondersteund.",
    EVENT_PART_TOO_LARGE: "De camera stuurde een eventonderdeel boven de veilige limiet.", EVENT_PART_LENGTH_INVALID: "De camera stuurde een ongeldig eventonderdeel.",
    MULTIPART_BOUNDARY_INVALID: "De camera stuurde geen geldige multipart-eventstream.", ABORT_ERR: "De eventverbinding is gestopt."
  };
  return { code, message: messages[code] ?? "De ANPR-eventverbinding is onverwacht verbroken." };
}

export async function runCameraLoop(options: {
  camera: ManagedAnprCamera; repository: CameraRepository; provider: AnprEventProvider;
  onEvent: (event: NormalizedAnprEvent) => Promise<void>;
  minRetryMs: number; maxRetryMs: number; signal: AbortSignal; logger: ProviderLogger; wait?: Wait; random?: () => number;
}) {
  const sleep = options.wait ?? wait;
  let attempt = 0;
  while (!options.signal.aborted) {
    const startedAt = Date.now();
    try {
      await options.repository.markConnecting(options.camera.id);
      await options.provider.connect(options.camera, {
        onConnected: async () => {
          // Reset only after a stable connection, not immediately on HTTP 200.
          await options.repository.markConnected(options.camera.id, new Date());
          options.logger.info("[dahua-anpr] connected:", options.camera.name);
        },
        onEvent: options.onEvent
      }, options.signal);
      if (options.signal.aborted) break;
      const failure = { code: "STREAM_DISCONNECTED", message: "De ANPR-eventstream is verbroken." };
      await options.repository.markDisconnected(options.camera.id, failure.code, failure.message);
    } catch (error) {
      if (options.signal.aborted) break;
      const failure = safeFailure(error);
      await options.repository.markDisconnected(options.camera.id, failure.code, failure.message).catch(() => undefined);
    }
    if (options.signal.aborted) break;
    if (Date.now() - startedAt > 60_000) attempt = 0;
    const delay = reconnectDelay(attempt++, options.minRetryMs, options.maxRetryMs, options.random);
    options.logger.warn(`[dahua-anpr] disconnected; reconnecting in ${Math.round(delay / 1000)}s:`, options.camera.name);
    await sleep(delay, options.signal);
  }
}

type RunningCamera = { fingerprint: string; controller: AbortController; promise: Promise<void> };
export class AnprSupervisor {
  private readonly running = new Map<string, RunningCamera>();
  private stopped = false;
  constructor(private readonly options: {
    repository: CameraRepository; providers: Map<string, AnprEventProvider>; onEvent: (event: NormalizedAnprEvent) => Promise<void>;
    minRetryMs: number; maxRetryMs: number; logger: ProviderLogger; runLoop?: typeof runCameraLoop;
  }) {}
  async reconcile() {
    if (this.stopped) return;
    const cameras = await this.options.repository.listEnabled();
    const ids = new Set(cameras.map((camera) => camera.id));
    for (const [id, running] of this.running) if (!ids.has(id)) {
      running.controller.abort(); await running.promise; this.running.delete(id); await this.options.repository.markDisabled(id);
    }
    for (const camera of cameras) {
      const fingerprint = JSON.stringify([camera.rtspHost, camera.rtspUsernameEncrypted, camera.rtspPasswordEncrypted, camera.anprProvider, camera.anprHttpProtocol, camera.anprHttpPort, camera.anprChannel, camera.name, camera.location, camera.direction]);
      const current = this.running.get(camera.id);
      if (current?.fingerprint === fingerprint) continue;
      if (current) { current.controller.abort(); await current.promise; }
      const provider = this.options.providers.get(camera.anprProvider);
      if (!provider) continue;
      const controller = new AbortController();
      const task: RunningCamera = { fingerprint, controller, promise: Promise.resolve() };
      const loop = this.options.runLoop ?? runCameraLoop;
      task.promise = loop({ ...this.options, camera, provider, signal: controller.signal }).catch(() => this.options.logger.error("[anprWorker] camera loop stopped unexpectedly"));
      this.running.set(camera.id, task);
    }
  }
  snapshot() { return { managedCameras: this.running.size, running: !this.stopped }; }
  async stop() { this.stopped = true; const tasks = [...this.running.values()]; tasks.forEach((task) => task.controller.abort()); this.running.clear(); await Promise.allSettled(tasks.map((task) => task.promise)); }
}
