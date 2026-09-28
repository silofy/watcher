/**
 * Defense debrief CLI. Grades an analyst investigation against an incident.
 *   vite-node scripts/ingest-defense.tsx --incident <attacker capture> --run <analyst session> [--out <path>]
 * Each input may be a raw capture (auto-detected adapter) or an already-assembled Watcher report JSON.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { reportFromCapture } from "../src/lib/ingest/detect";
import { assembleDefenseReport } from "../src/lib/defense/assemble";
import type { WatcherReport } from "../src/types/report";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

function loadReport(path: string): WatcherReport {
  const text = readFileSync(resolve(path), "utf8").replace(/^﻿/, "");
  const fromCapture = reportFromCapture(text, path);
  if (fromCapture) return fromCapture;
  const rep = JSON.parse(text) as WatcherReport;
  if (!rep?.session?.uuid || !Array.isArray(rep.episodes)) throw new Error(`${path}: not a capture or a Watcher report`);
  return rep;
}

const incidentPath = arg("incident", "");
const runPath = arg("run", "");
if (!incidentPath || !runPath) {
  console.error("usage: vite-node scripts/ingest-defense.tsx --incident <attacker capture> --run <analyst session> [--out <path>]");
  process.exit(1);
}

const attacker = loadReport(incidentPath);
const run = loadReport(runPath);
const report = assembleDefenseReport(attacker, run);

const outPath = resolve(arg("out", "dist/report-from-defense.json"));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
writeFileSync(resolve("fixtures/session-defense.json"), JSON.stringify(report, null, 2), "utf8");

/* eslint-disable no-console */
console.log(`✓ defense debrief → ${outPath}`);
console.log(
  `  ${report.incident.artifacts.length} incident artifacts · ` +
    `${report.result.hits.filter((h) => h.found).length} found · grade ${report.grade.letter} (${report.grade.score})`,
);
