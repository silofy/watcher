/**
 * Enterprise Bridge demo (brief §6.4): grade a report, build the signed, hash-chained,
 * manager-profile attestation (the only thing that crosses to the institution), validate it
 * against the schema, and verify the signature.
 *
 *   vite-node scripts/attest.tsx [report.json]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/watcher-attestation.schema.json";
import type { WatcherReport } from "../src/types/report";
import { computeGrade } from "../src/lib/bridge/grade";
import { minimizedBundle } from "../src/lib/bridge/bundle";
import { buildAttestation, generateDeviceKey, verifyAttestation, verifyChain } from "../src/lib/bridge/attest";

const path = resolve(process.argv[2] ?? "fixtures/session-htb-easy.json");
const report = JSON.parse(readFileSync(path, "utf8")) as WatcherReport;

const grade = computeGrade(report);
const bundle = minimizedBundle(report, grade);
const key = generateDeviceKey();
const att = buildAttestation(bundle, key, null);
// a second attestation chained to the first (e.g. the student's next submission)
const att2 = buildAttestation(bundle, key, att.hash);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
const schemaOk = validate(att);
if (!schemaOk) console.error(validate.errors);

/* eslint-disable no-console */
console.log(`Report: ${path}`);
console.log(`\nGrade: ${grade.score} (${grade.letter}) — routed to ${grade.routed_to}`);
for (const [k, c] of Object.entries(grade.components)) {
  console.log(`  ${k.padEnd(12)} raw ${String(c.raw).padStart(5)} × ${c.weight} = ${c.weighted}`);
}
console.log(`  independence gate: ${grade.independence_gate.score} vs ${grade.independence_gate.threshold} → ${grade.independence_gate.flagged ? "FLAGGED" : "ok"}`);
console.log(`\nConsent preview (what syncs to the institution — no raw telemetry):`);
console.log(`  session ${bundle.session.uuid} · ${bundle.session.target_scope}`);
console.log(`  ${bundle.evidence_digests.filter((d) => d.satisfied).length}/${bundle.evidence_digests.length} objectives, as digests`);
console.log(`  redaction_profile: ${bundle.redaction_profile}`);
console.log(`\nAttestation: schema=${schemaOk ? "valid" : "INVALID"} · verify=${JSON.stringify(verifyAttestation(att))}`);
console.log(`Hash chain [a → a2]: ${JSON.stringify(verifyChain([att, att2]))}`);
console.log(`  hash:   ${att.hash}`);
console.log(`  sig:    ${att.signature.slice(0, 32)}…  (ed25519)`);
