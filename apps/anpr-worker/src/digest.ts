import { createHash, randomBytes } from "node:crypto";
import http, { type IncomingMessage, type RequestOptions } from "node:http";
import https from "node:https";

type DigestChallenge = { realm: string; nonce: string; qop?: string; opaque?: string; algorithm?: string; stale?: string };

function parseChallenge(header: string): DigestChallenge {
  if (!header.toLowerCase().startsWith("digest ")) throw new Error("AUTH_SCHEME_UNSUPPORTED");
  const values: Record<string, string> = {};
  const input = header.slice(7);
  for (const match of input.matchAll(/([a-zA-Z0-9_-]+)=(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g)) {
    values[match[1]!.toLowerCase()] = (match[2] ?? match[3] ?? "").replace(/\\"/g, "\"");
  }
  if (!values.realm || !values.nonce) throw new Error("AUTH_CHALLENGE_INVALID");
  return values as DigestChallenge;
}

function hash(algorithm: string, value: string) {
  return createHash(algorithm).update(value).digest("hex");
}

export function createDigestAuthorization(options: {
  challenge: string; method: string; uri: string; username: string; password: string; cnonce?: string;
}): string {
  const challenge = parseChallenge(options.challenge);
  const declared = (challenge.algorithm ?? "MD5").toUpperCase();
  const session = declared.endsWith("-SESS");
  const algorithm = declared.startsWith("SHA-256") ? "sha256" : declared.startsWith("MD5") ? "md5" : "";
  if (!algorithm) throw new Error("AUTH_ALGORITHM_UNSUPPORTED");
  const qops = challenge.qop?.split(",").map((value) => value.trim().toLowerCase());
  if (qops?.length && !qops.includes("auth")) throw new Error("AUTH_QOP_UNSUPPORTED");
  const cnonce = options.cnonce ?? randomBytes(12).toString("hex");
  const nc = "00000001";
  let ha1 = hash(algorithm, `${options.username}:${challenge.realm}:${options.password}`);
  if (session) ha1 = hash(algorithm, `${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = hash(algorithm, `${options.method}:${options.uri}`);
  const response = qops?.length
    ? hash(algorithm, `${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : hash(algorithm, `${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${options.username.replace(/["\\]/g, "")}"`, `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`, `uri="${options.uri}"`, `response="${response}"`, `algorithm=${declared}`
  ];
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (qops?.length) parts.push("qop=auth", `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(", ")}`;
}

function request(options: RequestOptions, protocol: "http" | "https", signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const transport = protocol === "https" ? https : http;
    const req = transport.request({ ...options, signal }, resolve);
    if (options.timeout) req.setTimeout(Number(options.timeout), () => req.destroy(new Error("CONNECT_TIMEOUT")));
    req.once("error", reject);
    req.end();
  });
}

export async function openDigestStream(options: {
  protocol: "http" | "https"; host: string; port: number; path: string;
  username?: string; password?: string; signal: AbortSignal; timeoutMs: number;
}): Promise<IncomingMessage> {
  const requestOptions: RequestOptions = {
    hostname: options.host, port: options.port, path: options.path, method: "GET",
    headers: { Accept: "multipart/x-mixed-replace", "User-Agent": "ANPR-Platform/0.2.2" },
    timeout: options.timeoutMs
  };
  let response = await request(requestOptions, options.protocol, options.signal);
  if (response.statusCode !== 401) {
    if (response.statusCode !== 200) { response.resume(); throw new Error(`HTTP_${response.statusCode ?? 0}`); }
    return response;
  }
  const challenge = response.headers["www-authenticate"];
  response.resume();
  if (!options.username || !challenge) throw new Error("AUTHENTICATION_FAILED");
  const authorization = createDigestAuthorization({
    challenge, method: "GET", uri: options.path, username: options.username, password: options.password ?? ""
  });
  response = await request({ ...requestOptions, headers: { ...requestOptions.headers, Authorization: authorization } }, options.protocol, options.signal);
  if (response.statusCode !== 200) { response.resume(); throw new Error(response.statusCode === 401 ? "AUTHENTICATION_FAILED" : `HTTP_${response.statusCode ?? 0}`); }
  return response;
}
