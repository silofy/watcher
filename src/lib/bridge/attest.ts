/**
 * Tamper-evident attestations (brief §6.4): the institution receives a cryptographically signed,
 * minimized bundle — never raw telemetry. Each attestation is hash-chained to the previous one and
 * carries a per-device ed25519 signature, so grades are auditable and defensible: any edit to the
 * content breaks the hash, and forging the signature needs the device private key.
 *
 * Node-only (uses node:crypto) — built by the daemon / bridge, not the student's browser app.
 */
import { createHash, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify, type KeyObject } from "node:crypto";
import type { AttestationContent } from "./bundle";
import { canonical } from "./canonical";

export interface Attestation {
  content: AttestationContent;
  prev_hash: string | null;
  hash: string;
  signature: string;
  pubkey: string;
}

export interface DeviceKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function hashOf(content: AttestationContent, prevHash: string | null): string {
  return createHash("sha256").update(canonical({ prev_hash: prevHash, content })).digest("hex");
}

export function generateDeviceKey(): DeviceKey {
  return generateKeyPairSync("ed25519");
}

export function buildAttestation(content: AttestationContent, key: DeviceKey, prevHash: string | null): Attestation {
  const hash = hashOf(content, prevHash);
  const signature = nodeSign(null, Buffer.from(hash, "hex"), key.privateKey).toString("base64");
  const pubkey = key.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { content, prev_hash: prevHash, hash, signature, pubkey };
}

export function verifyAttestation(att: Attestation): { hashOk: boolean; sigOk: boolean; ok: boolean } {
  const hashOk = hashOf(att.content, att.prev_hash) === att.hash;
  let sigOk = false;
  try {
    const pub = createPublicKey({ key: Buffer.from(att.pubkey, "base64"), type: "spki", format: "der" });
    sigOk = nodeVerify(null, Buffer.from(att.hash, "hex"), pub, Buffer.from(att.signature, "base64"));
  } catch {
    sigOk = false;
  }
  return { hashOk, sigOk, ok: hashOk && sigOk };
}

/** Verify a hash-chained sequence: every link signed, every prev_hash matching the prior hash. */
export function verifyChain(atts: Attestation[]): { ok: boolean; brokenAt: number | null } {
  for (let i = 0; i < atts.length; i++) {
    if (!verifyAttestation(atts[i]).ok) return { ok: false, brokenAt: i };
    const expectedPrev = i === 0 ? null : atts[i - 1].hash;
    if (atts[i].prev_hash !== expectedPrev) return { ok: false, brokenAt: i };
  }
  return { ok: true, brokenAt: null };
}
