import { isIP } from "node:net";

function isPrivateIpv4(hostname: string) {
  const octets = hostname.split(".").map(Number);
  return octets[0] === 10 || octets[0] === 127
    || (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isDevelopmentHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) return true;
  return false;
}

export function isAllowedWebOrigin(origin: string, configuredOrigin: string, nodeEnv: "development" | "test" | "production") {
  if (origin === configuredOrigin) return true;
  if (nodeEnv !== "development") return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (!parsed.port || parsed.port === "3000")
      && !parsed.username && !parsed.password
      && isDevelopmentHost(parsed.hostname);
  } catch {
    return false;
  }
}
