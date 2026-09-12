import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { config } from "../config.js";

export type ProcessResult = { code: number | null; stderr: string; stdout: Buffer; timedOut: boolean };
export type ProcessRunner = (command: string, args: string[], timeoutMs: number, binary?: boolean) => Promise<ProcessResult>;

type CheckResult = {
  status: "SUCCESS" | "FAILED" | "AVAILABLE" | "UNAVAILABLE" | "NOT_REQUESTED";
  code?: string;
  message?: string;
};

function run(command: string, args: string[], timeoutMs: number, binary = false): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    let stderr = "";
    let settled = false;
    let outputBytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes > 12_000_000) child.kill("SIGKILL"); else stdout.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(0, 20_000); });
    child.on("error", (error) => { stderr += error.message; });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderr, stdout: binary ? Buffer.concat(stdout) : Buffer.from(Buffer.concat(stdout).toString("utf8")), timedOut: signal === "SIGKILL" });
    });
  });
}

function classify(result: ProcessResult) {
  const value = result.stderr.toLowerCase();
  if (result.timedOut) return { code: "TIMEOUT", message: "De camera reageerde niet binnen de ingestelde tijd." };
  if (/401|unauthorized|authentication|method describe failed: 401/.test(value)) return { code: "AUTHENTICATION_FAILED", message: "Gebruikersnaam of wachtwoord is niet geaccepteerd." };
  if (/enoent|not found/.test(value) && /ffprobe|ffmpeg/.test(value)) return { code: "FFMPEG_MISSING", message: "FFmpeg/ffprobe is niet beschikbaar op de server." };
  if (/name or service not known|temporary failure in name resolution|nodename nor servname/.test(value)) return { code: "DNS_ERROR", message: "De hostnaam kan niet worden gevonden (DNS/netwerkprobleem)." };
  if (/connection refused|actively refused/.test(value)) return { code: "PORT_CLOSED", message: "De RTSP-poort weigert de verbinding." };
  if (/no route to host|network is unreachable|connection timed out/.test(value)) return { code: "UNREACHABLE", message: "De camera is niet bereikbaar via het netwerk." };
  if (/404|not found|method describe failed|invalid data found|server returned 4\d\d/.test(value)) return { code: "STREAM_NOT_FOUND", message: "De stream is niet beschikbaar. Controleer het RTSP-pad, channel en subtype." };
  return { code: "RTSP_ERROR", message: "FFmpeg kon de RTSP-stream niet openen. Controleer camera, pad en codec." };
}

export async function testRtsp(rtspUrl: string, createSnapshot = true, execute: ProcessRunner = run) {
  const started = Date.now();
  // A fresh FFmpeg process must actually decode a frame. DESCRIBE/ffprobe is not video evidence.
  const shot = await execute("ffmpeg", ["-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", rtspUrl, "-map", "0:v:0", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], 15_000, true);
  const validFrame = shot.code === 0 && shot.stdout.length >= 4 && shot.stdout[0] === 0xff && shot.stdout[1] === 0xd8 && shot.stdout.at(-2) === 0xff && shot.stdout.at(-1) === 0xd9;
  const checkedAt = new Date().toISOString();
  if (!validFrame) {
    const failure = shot.code !== 0 ? classify(shot) : { code: "NO_DECODED_VIDEO", message: "Geen decodeerbaar videoframe ontvangen. Een open poort of streammetadata is onvoldoende." };
    return { success: false as const, checkedAt, responseTimeMs: Date.now() - started, ...failure,
      rtspVideo: { status: "FAILED", ...failure } satisfies CheckResult,
      snapshot: { status: "UNAVAILABLE", code: "DEPENDENCY_FAILED", message: "Niet uitgevoerd door bovenstaande videofout." } satisfies CheckResult };
  }
  let snapshotObjectId: string | undefined;
  let snapshot: CheckResult = { status: "NOT_REQUESTED" };
  if (createSnapshot) {
    try {
      await mkdir(join(config.STORAGE_PATH, "snapshots"), { recursive: true });
      snapshotObjectId = `snapshots/${randomUUID()}.jpg`;
      await writeFile(join(config.STORAGE_PATH, snapshotObjectId), shot.stdout, { mode: 0o600 });
      snapshot = { status: "AVAILABLE", message: "Nieuw gedecodeerd frame opgeslagen." };
    } catch {
      snapshotObjectId = undefined;
      snapshot = { status: "UNAVAILABLE", code: "STORAGE_FAILED", message: "Video ontvangen, maar het nieuwe beeld kon niet worden opgeslagen." };
    }
  }
  return { success: true as const, checkedAt, snapshotAt: snapshotObjectId ? checkedAt : undefined,
    responseTimeMs: Date.now() - started, snapshotObjectId,
    rtspVideo: { status: "SUCCESS", message: "Nieuw videoframe ontvangen en gedecodeerd via RTSP-over-TCP." } satisfies CheckResult, snapshot };
}
