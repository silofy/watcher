/**
 * Rich demo fixture generator — for regenerating the README screenshots against the redesigned,
 * lesson-first debrief. The bundled default fixture (`fixtures/session-htb-easy.json`) is schema
 * v1.0 and carries none of the newer features (ghost, findings, methodology), so screenshots taken
 * against it would miss exactly the surfaces worth showing off.
 *
 * Reuses the same scripted "Forge" playthrough that drives the `?demo=live` walkthrough
 * (src/lib/demo/playthrough.ts) and runs it through the full pipeline via `assembleReport` —
 * findings extraction, golden_dag alignment, the Ghost counterfactual, methodology/focus metrics,
 * and the v2 grade all come out the other end, schema v1.4.
 *
 *   vite-node scripts/gen-demo-report.tsx
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assembleReport } from "../src/lib/pipeline/ingest";
import { DEMO_RAW, DEMO_SESSION, DEMO_GOLDEN } from "../src/lib/demo/playthrough";

// DEMO_SESSION.uuid ("demo-forge-0001-…") is a human-readable stand-in fine for the in-browser
// ?demo=live walkthrough, but it isn't RFC4122-shaped, so it fails the schema's `format: "uuid"`
// check once persisted as a static fixture. Swap in a real (fixed, so the fixture stays
// deterministic across regenerations) v4 uuid; nothing else about the session changes.
const session = { ...DEMO_SESSION, uuid: "de00f0e1-0001-4000-8000-000000000001" };

const report = assembleReport(DEMO_RAW, { session, golden: DEMO_GOLDEN });

const out = resolve(import.meta.dirname, "../fixtures/session-demo-full.json");
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

/* eslint-disable no-console */
console.log(`wrote ${out}`);
console.log(
  `  schema_version=${report.schema_version} findings=${report.findings?.length ?? 0} ` +
    `ghost_items=${report.ghost?.items?.length ?? 0} methodology_coverage_pct=${report.metrics.methodology_coverage_pct}`,
);
