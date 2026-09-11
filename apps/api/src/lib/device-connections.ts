import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Socket } from "node:net";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { testRtsp } from "./rtsp.js";

export type CapabilityStatus = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN";
export type DeviceCategory = "CAMERA" | "NVR" | "AUTO";
export type DahuaCapability =
  | "deviceInformation" | "videoChannels" | "channelNames" | "onlineStatus"
  | "anprEvents" | "alarmEvents" | "vehicleMetadata" | "snapshots" | "recordingPlayback";

export const unknownDahuaCapabilities: Record<DahuaCapability, CapabilityStatus> = {
  deviceInformation: "UNKNOWN", videoChannels: "UNKNOWN", channelNames: "UNKNOWN",
  onlineStatus: "UNKNOWN", anprEvents: "UNKNOWN", alarmEvents: "UNKNOWN",
  vehicleMetadata: "UNKNOWN", snapshots: "UNKNOWN", recordingPlayback: "UNKNOWN"
};

export type DeviceChannel = { number: number; name?: string; online: boolean | null; anpr: CapabilityStatus };
export type DahuaSdkInspection = {
  authenticated: boolean;
  supported?: boolean;
  category?: Exclude<DeviceCategory, "AUTO">;
  model?: string;
  firmware?: string;
  serialNumber?: string;
  channels?: DeviceChannel[];
  capabilities?: Partial<Record<DahuaCapability, CapabilityStatus>>;
};

/** Adapterpunt voor de officiële, native Dahua NetSDK. Er wordt bewust geen private protocolpayload geïmplementeerd. */
export interface DahuaSdkAdapter {
  inspect(input: { host: string; port: number; username?: string; password?: string; category: DeviceCategory; timeoutMs: number }): Promise<DahuaSdkInspection>;
}

export type DeviceConnectionResult = {
  success: boolean;
  status: "UNKNOWN" | "CONNECTED" | "AUTH_FAILED" | "OFFLINE" | "ERROR";
  hostReachable: boolean;
  tcpPortOpen: boolean;
  networkStatus: "REACHABLE" | "UNREACHABLE";
  deviceApi: "CONFIRMED" | "NOT_CONFIRMED" | "NOT_SUPPORTED" | "UNKNOWN";
  authentication: "SUCCESS" | "FAILED" | "NOT_TESTED";
  dahuaDevice: CapabilityStatus;
  category: DeviceCategory | "UNKNOWN";
  model?: string;
  firmware?: string;
  serialNumber?: string;
  channels: DeviceChannel[];
  capabilities: Record<DahuaCapability, CapabilityStatus>;
  responseTimeMs: number;
  code?: string;
  message: string;
};

export interface DeviceConnectionProvider<TInput, TResult> {
  readonly type: string;
  test(input: TInput): Promise<TResult>;
}

export class RtspProvider implements DeviceConnectionProvider<{ url: string; createSnapshot?: boolean }, Awaited<ReturnType<typeof testRtsp>>> {
  readonly type = "RTSP";
  test(input: { url: string; createSnapshot?: boolean }) { return testRtsp(input.url, input.createSnapshot); }
}

type ResolveHost = (host: string) => Promise<string[]>;
type TcpProbe = (address: string, port: number, timeoutMs: number) => Promise<void>;

function blockedIpv4(address: string) {
  const octets = address.split(".").map(Number);
  return octets[0] === 0 || octets[0] === 127 || octets[0]! >= 224
    || (octets[0] === 169 && octets[1] === 254);
}

export function isBlockedDeviceTarget(address: string) {
  const version = isIP(address);
  if (version === 4) return blockedIpv4(address);
  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fe8")
      || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")
      || normalized.startsWith("ff") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:169.254.");
  }
  return true;
}

export function validateDeviceHost(host: string) {
  const value = host.trim().toLowerCase();
  if (!value || value.length > 253 || value === "localhost" || value.endsWith(".localhost")) {
    throw Object.assign(new Error("Gebruik een geldig camera- of recorderadres; localhost is niet toegestaan."), { statusCode: 400 });
  }
  if (isIP(value)) {
    if (isBlockedDeviceTarget(value)) throw Object.assign(new Error("Dit gereserveerde netwerkadres mag niet als apparaatdoel worden gebruikt."), { statusCode: 400 });
    return value;
  }
  const labels = value.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw Object.assign(new Error("Gebruik een geldig IP-adres of een geldige hostnaam."), { statusCode: 400 });
  }
  return value;
}

const resolveHost: ResolveHost = async (host) => {
  if (isIP(host)) return [host];
  return (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
};

const tcpProbe: TcpProbe = (address, port, timeoutMs) => new Promise((resolve, reject) => {
  const socket = new Socket();
  const done = (error?: Error) => { socket.destroy(); if (error) reject(error); else resolve(); };
  socket.setTimeout(timeoutMs, () => done(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
  socket.once("error", done);
  socket.connect({ host: address, port }, () => done());
});

function classifyNetworkError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "TCP_ERROR";
  if (code === "ETIMEDOUT") return { code: "TIMEOUT", message: "De verbindingstest duurde te lang." };
  if (code === "ECONNREFUSED") return { code: "PORT_CLOSED", message: "De host is bereikbaar, maar TCP-poort 37777 (of de gekozen poort) is gesloten." };
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return { code: "HOST_NOT_FOUND", message: "De hostnaam kon niet worden gevonden." };
  return { code: "UNREACHABLE", message: "De host of TCP-poort is niet bereikbaar." };
}

export class DahuaTcpProvider implements DeviceConnectionProvider<{
  host: string; port?: number; username?: string; password?: string; category?: DeviceCategory; timeoutMs?: number;
}, DeviceConnectionResult> {
  readonly type = "DAHUA_TCP_SDK";
  constructor(private readonly sdk?: DahuaSdkAdapter, private readonly resolver: ResolveHost = resolveHost, private readonly probe: TcpProbe = tcpProbe) {}

  async test(input: { host: string; port?: number; username?: string; password?: string; category?: DeviceCategory; timeoutMs?: number }): Promise<DeviceConnectionResult> {
    const started = Date.now();
    const host = validateDeviceHost(input.host);
    const port = input.port ?? 37777;
    const timeoutMs = input.timeoutMs ?? 3_000;
    const capabilities = { ...unknownDahuaCapabilities };
    try {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error("De TCP-poort moet tussen 1 en 65535 liggen."), { statusCode: 400 });
      const addresses = await this.resolver(host);
      if (!addresses.length || addresses.some(isBlockedDeviceTarget)) throw Object.assign(new Error("De host verwijst naar een gereserveerd adres en is daarom geblokkeerd."), { statusCode: 400 });
      await this.probe(addresses[0]!, port, timeoutMs);
      if (!this.sdk) return { success: false, status: "UNKNOWN", hostReachable: true, tcpPortOpen: true, networkStatus: "REACHABLE", deviceApi: "NOT_CONFIRMED", authentication: "NOT_TESTED", dahuaDevice: "UNKNOWN", category: "UNKNOWN", channels: [], capabilities, responseTimeMs: Date.now() - started, code: "SDK_NOT_CONFIGURED", message: "TCP-poort bereikbaar; gebruikersnaam/wachtwoord nog niet gevalideerd." };
      const inspection = await this.sdk.inspect({ host: addresses[0]!, port, username: input.username, password: input.password, category: input.category ?? "AUTO", timeoutMs });
      if (inspection.supported === false) return { success: false, status: "UNKNOWN", hostReachable: true, tcpPortOpen: true, networkStatus: "REACHABLE", deviceApi: "NOT_SUPPORTED", authentication: "NOT_TESTED", dahuaDevice: "UNSUPPORTED", category: "UNKNOWN", channels: [], capabilities, responseTimeMs: Date.now() - started, code: "DEVICE_NOT_SUPPORTED", message: "De officiële Dahua SDK herkent dit doel niet als een ondersteund Dahua-apparaat." };
      if (!inspection.authenticated) return { success: false, status: "AUTH_FAILED", hostReachable: true, tcpPortOpen: true, networkStatus: "REACHABLE", deviceApi: "CONFIRMED", authentication: "FAILED", dahuaDevice: "SUPPORTED", category: "UNKNOWN", channels: [], capabilities, responseTimeMs: Date.now() - started, code: "AUTH_FAILED", message: "De Dahua-login is geweigerd. Controleer gebruikersnaam en wachtwoord." };
      Object.assign(capabilities, inspection.capabilities ?? {}, { deviceInformation: "SUPPORTED" as const });
      return { success: true, status: "CONNECTED", hostReachable: true, tcpPortOpen: true, networkStatus: "REACHABLE", deviceApi: "CONFIRMED", authentication: "SUCCESS", dahuaDevice: "SUPPORTED", category: inspection.category ?? "UNKNOWN", model: inspection.model, firmware: inspection.firmware, serialNumber: inspection.serialNumber, channels: inspection.channels ?? [], capabilities, responseTimeMs: Date.now() - started, message: "Dahua-apparaat en authenticatie zijn via de officiële SDK geverifieerd." };
    } catch (error) {
      if (typeof error === "object" && error !== null && "statusCode" in error) throw error;
      const failure = classifyNetworkError(error);
      return { success: false, status: "OFFLINE", hostReachable: failure.code === "PORT_CLOSED", tcpPortOpen: false, networkStatus: "UNREACHABLE", deviceApi: "UNKNOWN", authentication: "NOT_TESTED", dahuaDevice: "UNKNOWN", category: "UNKNOWN", channels: [], capabilities, responseTimeMs: Date.now() - started, ...failure };
    }
  }
}

export function encryptedDahuaConnection(input: { host: string; port?: number; username?: string; password?: string; category?: DeviceCategory }, current?: { usernameEncrypted: string | null; passwordEncrypted: string | null }) {
  return {
    type: "DAHUA_TCP_SDK" as const,
    host: validateDeviceHost(input.host), port: input.port ?? 37777, requestedCategory: input.category ?? "AUTO",
    usernameEncrypted: input.username ? encryptSecret(input.username.trim()) : current?.usernameEncrypted,
    passwordEncrypted: input.password ? encryptSecret(input.password) : current?.passwordEncrypted,
    capabilities: unknownDahuaCapabilities
  };
}

export function credentialsForDahua(connection: { usernameEncrypted: string | null; passwordEncrypted: string | null }) {
  return { username: decryptSecret(connection.usernameEncrypted), password: decryptSecret(connection.passwordEncrypted) };
}

export function publicDeviceConnection(connection: any) {
  const { usernameEncrypted, passwordEncrypted, ...safe } = connection;
  return { ...safe, hasUsername: Boolean(usernameEncrypted), hasPassword: Boolean(passwordEncrypted) };
}
