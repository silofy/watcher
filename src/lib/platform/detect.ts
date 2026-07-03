import type { PlatformId } from "../../types/report";

export interface DetectContext {
  targetScope?: string;
  contextPath?: string;
  targetIps?: string[];
  platformHint?: PlatformId;
}

/** Known VPN CIDR ranges. HTB 10.10.10.x overlaps retired THM space — CIDR alone is ambiguous there,
 *  broken by platformHint/contextPath in the adapters. */
export const CIDRS: Record<PlatformId, string[]> = {
  htb: ["10.10.10.0/24", "10.129.0.0/16"],
  thm: ["10.10.0.0/16", "10.201.0.0/16"],
  offsec: [],
  immersive: [],
  local: [],
};

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

export function ipsInScope(scope?: string): string[] {
  if (!scope) return [];
  return scope.match(IPV4) ?? [];
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + (Number(o) & 255), 0) >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask);
}

/** 0.6 if any provided IP falls in one of the platform's CIDRs, else 0. */
export function cidrConfidence(ips: string[], id: PlatformId): number {
  const ranges = CIDRS[id];
  if (!ranges.length) return 0;
  return ips.some((ip) => ranges.some((c) => ipInCidr(ip, c))) ? 0.6 : 0;
}
