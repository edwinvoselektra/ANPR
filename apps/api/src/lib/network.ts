import { isIP } from "node:net";

export type Ipv4Cidr = { address: string; prefix: number; network: number; broadcast: number };

export function ipv4ToNumber(value: string): number {
  if (isIP(value) !== 4) throw new Error("Gebruik een geldig IPv4-adres.");
  return value.split(".").reduce((result, part) => (result * 256 + Number(part)) >>> 0, 0) >>> 0;
}

export function numberToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

export function parseIpv4Cidr(value: string): Ipv4Cidr {
  const [rawAddress, rawPrefix, ...rest] = value.trim().split("/");
  const address=rawAddress??"";
  const prefix = Number(rawPrefix);
  if (rest.length || isIP(address) !== 4 || !Number.isInteger(prefix) || prefix < 1 || prefix > 32) {
    throw new Error("Gebruik een geldige IPv4-CIDR, bijvoorbeeld 192.168.178.0/24.");
  }
  const ip = ipv4ToNumber(address!);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  if (ip !== network) throw new Error(`Gebruik het netwerkadres ${numberToIpv4(network)}/${prefix}.`);
  return { address: address!, prefix, network, broadcast };
}

export function cidrsOverlap(left: string, right: string): boolean {
  const a = parseIpv4Cidr(left); const b = parseIpv4Cidr(right);
  return a.network <= b.broadcast && b.network <= a.broadcast;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const value = ipv4ToNumber(ip); const range = parseIpv4Cidr(cidr);
  return value >= range.network && value <= range.broadcast;
}

export function hostIsValid(value: string): boolean {
  if (isIP(value)) return true;
  return value.length <= 253 && /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(value);
}

export function allocateTunnelAddress(cidr: string, serverAddress: string, used: string[]): string {
  const range = parseIpv4Cidr(cidr); const reserved = new Set([serverAddress, ...used]);
  for (let value = range.network + 1; value < range.broadcast; value++) {
    const candidate = numberToIpv4(value >>> 0);
    if (!reserved.has(candidate)) return candidate;
  }
  throw Object.assign(new Error("De VPN-adresrange heeft geen vrij tunneladres meer."), { statusCode: 409 });
}
