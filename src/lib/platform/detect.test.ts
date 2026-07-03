import { describe, it, expect } from "vitest";
import { ipInCidr, ipsInScope, cidrConfidence } from "./detect";

describe("detect helpers", () => {
  it("matches an IP inside a CIDR and rejects one outside", () => {
    expect(ipInCidr("10.129.4.9", "10.129.0.0/16")).toBe(true);
    expect(ipInCidr("10.10.1.5", "10.10.0.0/16")).toBe(true);
    expect(ipInCidr("192.168.1.1", "10.129.0.0/16")).toBe(false);
  });
  it("extracts IPv4 addresses from a scope string", () => {
    expect(ipsInScope("THM::Blue 10.10.1.5")).toEqual(["10.10.1.5"]);
    expect(ipsInScope("no ips here")).toEqual([]);
  });
  it("scores CIDR confidence per platform", () => {
    expect(cidrConfidence(["10.129.4.9"], "htb")).toBeCloseTo(0.6);
    expect(cidrConfidence(["10.201.2.2"], "thm")).toBeCloseTo(0.6);
    expect(cidrConfidence(["192.168.1.1"], "htb")).toBe(0);
  });
});
