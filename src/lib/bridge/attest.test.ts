import { describe, it, expect } from "vitest";
import fixture from "../../../fixtures/session-htb-easy.json";
import type { WatcherReport } from "../../types/report";
import { minimizedBundle } from "./bundle";
import { buildAttestation, verifyAttestation, verifyChain, generateDeviceKey, hashOf } from "./attest";

const report = fixture as unknown as WatcherReport;

describe("manager-profile minimization", () => {
  const bundle = minimizedBundle(report);

  it("contains scores and evidence digests, never raw telemetry", () => {
    const blob = JSON.stringify(bundle);
    expect(bundle.evidence_digests.length).toBe(report.golden_dag.length);
    // no raw commands or output text leaks into the manager bundle
    expect(blob).not.toContain("gobuster");
    expect(blob).not.toContain("sudo -l");
    expect(blob).not.toContain("10.10.10.5");
  });

  it("records which objectives were satisfied as digests", () => {
    const skipped = bundle.evidence_digests.find((d) => d.objective === "test_credential_reuse_ssh");
    expect(skipped?.satisfied).toBe(false);
    const services = bundle.evidence_digests.find((d) => d.objective === "enumerate_services");
    expect(services?.satisfied).toBe(true);
    expect(services?.by_seq).toBe(1);
  });
});

describe("signed, hash-chained attestation", () => {
  const key = generateDeviceKey();

  it("verifies a freshly built attestation", () => {
    const att = buildAttestation(minimizedBundle(report), key, null);
    expect(verifyAttestation(att)).toMatchObject({ hashOk: true, sigOk: true, ok: true });
  });

  it("detects tampering with the content (hash breaks)", () => {
    const att = buildAttestation(minimizedBundle(report), key, null);
    att.content.grade.score = 100; // inflate the grade
    const v = verifyAttestation(att);
    expect(v.hashOk).toBe(false);
    expect(v.ok).toBe(false);
  });

  it("detects a forged signature (no device key)", () => {
    const att = buildAttestation(minimizedBundle(report), key, null);
    const other = buildAttestation(minimizedBundle(report), generateDeviceKey(), null);
    att.signature = other.signature; // swap in a signature from another key
    expect(verifyAttestation(att).sigOk).toBe(false);
  });

  it("verifies a hash chain and locates a broken link", () => {
    const a = buildAttestation({ ...minimizedBundle(report), redaction_profile: "manager" }, key, null);
    const b = buildAttestation(minimizedBundle(report), key, a.hash);
    const c = buildAttestation(minimizedBundle(report), key, b.hash);
    expect(verifyChain([a, b, c])).toEqual({ ok: true, brokenAt: null });

    // splice the chain: c now points at the wrong previous hash
    const tampered = { ...c, prev_hash: hashOf(c.content, "deadbeef") };
    expect(verifyChain([a, b, tampered]).ok).toBe(false);
    expect(verifyChain([a, b, tampered]).brokenAt).toBe(2);
  });
});
