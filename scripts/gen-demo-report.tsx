/**
 * Rich demo fixture generator — for regenerating the README screenshots against the current debrief.
 * The bundled default fixture (`fixtures/session-htb-easy.json`) is schema v1.0 and carries none of
 * the newer features (ghost, findings, methodology), so screenshots taken against it would miss
 * exactly the surfaces worth showing off.
 *
 * Reuses the real HTB Abducted demo (src/lib/demo/abducted.ts, the same run the in-app demo shows)
 * and runs its raw command stream through the full pipeline via `assembleReport` — findings
 * extraction, golden_dag alignment, the Ghost counterfactual, methodology/focus metrics, and the v2
 * grade all come out the other end, schema v1.4.
 *
 *   vite-node scripts/gen-demo-report.tsx
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assembleReport } from "../src/lib/pipeline/ingest";
import { ABDUCTED } from "../src/lib/demo/abducted";

// The demo's session uuid ("demo-abducted-0001-…") is a readable stand-in that works in the app,
// but it isn't RFC4122-shaped, so it fails the schema's `format: "uuid"` check once persisted as a
// static fixture. Swap in a real (fixed, so the fixture stays deterministic across regenerations)
// v4 uuid; nothing else about the session changes.
const session = { ...ABDUCTED.session, uuid: "de00f0e1-0001-4000-8000-000000000001" };

const report = assembleReport(ABDUCTED.raw, { session, golden: ABDUCTED.golden });

const out = resolve(import.meta.dirname, "../fixtures/session-demo-full.json");
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

/* eslint-disable no-console */
console.log(`wrote ${out}`);
console.log(
  `  schema_version=${report.schema_version} findings=${report.findings?.length ?? 0} ` +
    `ghost_items=${report.ghost?.items?.length ?? 0} methodology_coverage_pct=${report.metrics.methodology_coverage_pct}`,
);
