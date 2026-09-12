import { normalizeCameraHost } from "@anpr/shared";
import type { Camera } from "@prisma/client";
import { decryptSecret, encryptSecret } from "./crypto.js";

export type CameraConnectionInput = {
  connectionMode: "URL" | "FIELDS";
  rtspUrl?: string;
  rtspHost?: string;
  rtspPort?: number;
  rtspPath?: string;
  username?: string;
  password?: string;
};

export function parseConnection(input: CameraConnectionInput) {
  if (input.connectionMode === "URL") {
    let parsed: URL;
    try { parsed = new URL(input.rtspUrl ?? ""); }
    catch { throw Object.assign(new Error("Gebruik een geldige RTSP URL."), { statusCode: 400 }); }
    if (parsed.protocol !== "rtsp:" && parsed.protocol !== "rtsps:") throw Object.assign(new Error("Gebruik een geldige rtsp:// of rtsps:// URL."), { statusCode: 400 });
    return {
      connectionMode: "URL" as const,
      rtspProtocol: parsed.protocol.slice(0, -1),
      rtspHost: parsed.hostname,
      rtspPort: parsed.port ? Number(parsed.port) : 554,
      rtspPath: `${parsed.pathname}${parsed.search}`,
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password)
    };
  }
  if (!input.rtspHost?.trim()) throw Object.assign(new Error("Vul een IP-adres of hostnaam in."), { statusCode: 400 });
  return {
    connectionMode: "FIELDS" as const,
    rtspProtocol: "rtsp",
    rtspHost: (() => { try { return normalizeCameraHost(input.rtspHost); } catch (error) { throw Object.assign(error as Error, { statusCode: 400 }); } })(),
    rtspPort: input.rtspPort ?? 554,
    rtspPath: input.rtspPath?.trim() || "/",
    username: input.username?.trim(),
    password: input.password
  };
}

export function encryptedConnection(input: CameraConnectionInput, current?: Camera) {
  const parsed = parseConnection(input);
  return {
    connectionMode: parsed.connectionMode,
    rtspProtocol: parsed.rtspProtocol,
    rtspHost: parsed.rtspHost,
    rtspPort: parsed.rtspPort,
    rtspPath: parsed.rtspPath,
    rtspUsernameEncrypted: parsed.username ? encryptSecret(parsed.username) : current?.rtspUsernameEncrypted,
    rtspPasswordEncrypted: parsed.password ? encryptSecret(parsed.password) : current?.rtspPasswordEncrypted
  };
}

export function buildRtspUrl(camera: Pick<Camera, "rtspProtocol" | "rtspHost" | "rtspPort" | "rtspPath" | "rtspUsernameEncrypted" | "rtspPasswordEncrypted">) {
  if (!camera.rtspHost) throw new Error("Camera heeft geen RTSP-host.");
  const protocol = camera.rtspProtocol === "rtsps" ? "rtsps" : "rtsp";
  const username = decryptSecret(camera.rtspUsernameEncrypted);
  const password = decryptSecret(camera.rtspPasswordEncrypted);
  const auth = username ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@` : "";
  const path = camera.rtspPath?.startsWith("/") ? camera.rtspPath : `/${camera.rtspPath ?? ""}`;
  return `${protocol}://${auth}${camera.rtspHost}:${camera.rtspPort}${path}`;
}

export function publicCamera(camera: any) {
  const { rtspUsernameEncrypted, rtspPasswordEncrypted, uploadRegistration, ...safe } = camera;
  void uploadRegistration;
  return { ...safe, name: safe.historicalName ?? safe.name, deviceConnections: Array.isArray(safe.deviceConnections) ? safe.deviceConnections.map((connection:any)=>{
    const {usernameEncrypted,passwordEncrypted,...publicConnection}=connection;
    return {...publicConnection,hasUsername:Boolean(usernameEncrypted),hasPassword:Boolean(passwordEncrypted)};
  }) : undefined, hasUsername: Boolean(rtspUsernameEncrypted), hasPassword: Boolean(rtspPasswordEncrypted) };
}
