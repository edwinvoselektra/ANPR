import { spawn } from "node:child_process";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CaptureResult, ManagedCamera } from "./types.js";
import { buildRtspUrl } from "./credentials.js";

type ProcessResult = { code: number | null; stderr: string; stdout: Buffer; timedOut: boolean; oversized: boolean };
const MAX_FRAME_BYTES = 20 * 1024 * 1024;

function runFfmpeg(rtspUrl: string, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
      "-i", rtspUrl, "-an", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"
    ], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    let outputSize = 0;
    let stderr = "";
    let oversized = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > MAX_FRAME_BYTES) {
        oversized = true;
        child.kill("SIGKILL");
      } else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8").slice(0, 20_000 - stderr.length); });
    child.once("error", (error) => { stderr += error.message; });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, stderr, stdout: Buffer.concat(output), timedOut: signal === "SIGKILL" && !oversized, oversized });
    });
  });
}

function classify(result: ProcessResult): { code: string; message: string } {
  const value = result.stderr.toLowerCase();
  if (result.oversized) return { code: "FRAME_TOO_LARGE", message: "Het cameraframe is groter dan de veilige limiet." };
  if (result.timedOut) return { code: "TIMEOUT", message: "De camera reageerde niet binnen de ingestelde tijd." };
  if (/401|unauthorized|authentication|method describe failed: 401/.test(value)) return { code: "AUTHENTICATION_FAILED", message: "De camera heeft de inloggegevens niet geaccepteerd." };
  if (/name or service not known|temporary failure in name resolution|nodename nor servname/.test(value)) return { code: "DNS_ERROR", message: "De hostnaam van de camera kan niet worden gevonden." };
  if (/connection refused|actively refused/.test(value)) return { code: "PORT_CLOSED", message: "De RTSP-poort weigert de verbinding." };
  if (/no route to host|network is unreachable|connection timed out/.test(value)) return { code: "UNREACHABLE", message: "De camera is niet bereikbaar via het netwerk." };
  if (/404|not found|method describe failed/.test(value)) return { code: "STREAM_NOT_FOUND", message: "De RTSP-stream of het pad bestaat niet." };
  if (/enoent/.test(value)) return { code: "FFMPEG_MISSING", message: "FFmpeg is niet beschikbaar in de video-worker." };
  return { code: "RTSP_ERROR", message: "De video-worker kon geen frame uit de RTSP-stream lezen." };
}

export function createFrameCapture(options: { storagePath: string; keyHex: string; timeoutMs: number }) {
  return async (camera: ManagedCamera): Promise<CaptureResult> => {
    const started = Date.now();
    let rtspUrl: string;
    try { rtspUrl = buildRtspUrl(camera, options.keyHex); }
    catch {
      return { success: false, code: "INVALID_CONFIGURATION", message: "De opgeslagen RTSP-configuratie is ongeldig.", responseTimeMs: Date.now() - started };
    }
    const result = await runFfmpeg(rtspUrl, options.timeoutMs);
    if (result.code !== 0 || result.stdout.length === 0) {
      return { success: false, ...classify(result), responseTimeMs: Date.now() - started };
    }

    const directory = join(options.storagePath, "worker-snapshots");
    const objectId = `worker-snapshots/${camera.id}.jpg`;
    const destination = join(options.storagePath, objectId);
    const temporary = join(directory, `.${camera.id}-${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(temporary, result.stdout, { mode: 0o600 });
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return { success: true, snapshotObjectId: objectId, responseTimeMs: Date.now() - started };
  };
}
