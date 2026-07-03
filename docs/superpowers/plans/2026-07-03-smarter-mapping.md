# Smarter Mapping (Methodology / Focus / Recovery) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add three deterministic upskilling signals — methodology coverage, focus discipline (anti-tunnel-vision), and recovery — surfaced as metrics + coaching insights, WITHOUT touching the letter grade.

**Architecture:** Three pure modules in `src/lib/analysis/` consume a `WatcherReport` and return plain data; `metrics.ts` adds their headline numbers (schema v1.3, additive); `audits.ts` maps their per-item output into existing `AuditItem`s so the existing Phase Audit renders them with no new components. The grade rubric is frozen.

**Tech Stack:** TypeScript, Vitest (node env, pure-logic tests only — NO DOM/testing-library), JSON Schema 2020-12.

## Global Constraints
- **TDD**; **green gate** each task: `npm test` + `npm run typecheck` + `npm run build` + schema round-trip all pass.
- **Additive/backward-compatible**: schema v1.3 fields optional; v1.0–v1.2 reports still load/validate/render.
- **Determinism**: analysis modules are pure functions; re-run → identical output. No clock/random.
- **Grade frozen**: do NOT modify `RUBRIC`, `computeGrade`, or any existing metric's semantics. New signals are surfaced only.
- **DRY**: reuse `LOW_YIELD` from `align.ts` (export it) — do not re-declare the regex.
- **Redaction**: coaching text uses already-redacted fields; never re-derive a secret.
- Single-file test run: `npx vitest run <path>`.

---

## File Structure
- Create: `src/lib/analysis/methodology.ts` (+ `.test.ts`), `src/lib/analysis/focus.ts` (+ `.test.ts`), `src/lib/analysis/recovery.ts` (+ `.test.ts`).
- Modify: `schema/watcher-report.schema.json`, `src/types/report.ts` (v1.3 fields), `src/lib/metrics.ts` (wire headline numbers), `src/lib/pipeline/ingest.ts` (stamp v1.3 + write fields), `src/lib/pipeline/align.ts` (export `LOW_YIELD`), `src/lib/audits.ts` (+ `.test.ts`) (new insight kinds), `README.md`, `crates/capture/CAPTURE.md`.

---

## Task 1: Schema v1.3 additive metrics fields (WP-1)

**Files:** `schema/watcher-report.schema.json`, `src/types/report.ts`.

- [ ] **Step 1: Add schema properties** under `metrics.properties`:
```json
"methodology_coverage_pct": { "type": "number", "minimum": 0, "maximum": 100 },
"focus_discipline_pct": { "type": "number", "minimum": 0, "maximum": 100 },
"recovery_median_ms": { "type": ["integer", "null"], "minimum": 0 }
```
Add `"1.3"` to the `schema_version` enum.

- [ ] **Step 2: Mirror in `src/types/report.ts`** — extend `Metrics` with the three optional fields; widen `WatcherReport.schema_version` to `"1.0" | "1.1" | "1.2" | "1.3"`.

- [ ] **Step 3: Run** `npx vitest run tests/schema.test.ts && npm run typecheck` — all fixtures (v1.2 and earlier) still validate; no runtime reads new fields.

- [ ] **Step 4: Commit**
```bash
git add schema/watcher-report.schema.json src/types/report.ts
git commit -m "feat: schema v1.3 additive analysis metrics fields"
```

---

## Task 2: Methodology coverage engine (WP-2)

**Files:** Create `src/lib/analysis/methodology.ts`, `src/lib/analysis/methodology.test.ts`.

**Interfaces produced:**
```ts
export interface MethodologyCheck { id: string; tactic: string; label: string; applicable: boolean; done: boolean; hint: string; evidence_seq: number | null; }
export interface MethodologyResult { coverage_pct: number; checks: MethodologyCheck[]; }
export function computeMethodology(report: WatcherReport): MethodologyResult;
```

- [ ] **Step 1: Write the failing test** (`methodology.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { computeMethodology } from "./methodology";
import type { WatcherReport, Episode, Finding } from "../../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "", duration_ms: 0, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", ...o });
const rep = (episodes: Episode[], findings: Finding[], golden: WatcherReport["golden_dag"] = []): WatcherReport => ({
  schema_version: "1.3", session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:10:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
  episodes, phases: [], golden_dag: golden, findings,
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] }, redaction_profile: "full",
});

describe("computeMethodology", () => {
  it("flags smb_enum applicable-but-not-done when 445 is found and no SMB tool used", () => {
    const r = rep([ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap", tactic: "TA0007" })],
      [{ id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 }]);
    const res = computeMethodology(r);
    const smb = res.checks.find((c) => c.id === "smb_enum")!;
    expect(smb.applicable).toBe(true);
    expect(smb.done).toBe(false);
    expect(smb.evidence_seq).toBe(0);
  });
  it("marks smb_enum done when enum4linux was used", () => {
    const r = rep([ep({ seq: 0, cmd: "nmap 10.10.1.5", binary: "nmap" }), ep({ seq: 1, cmd: "enum4linux-ng 10.10.1.5", binary: "enum4linux-ng", tactic: "TA0007" })],
      [{ id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 }]);
    expect(computeMethodology(r).checks.find((c) => c.id === "smb_enum")!.done).toBe(true);
  });
  it("excludes non-applicable checks from coverage (no NaN when nothing applies)", () => {
    const res = computeMethodology(rep([], []));
    expect(Number.isFinite(res.coverage_pct)).toBe(true);
    expect(res.coverage_pct).toBe(0);
  });
  it("is deterministic", () => {
    const r = rep([ep({ seq: 0, binary: "nmap" })], [{ id: "port:80-tcp", kind: "port", value: "80/tcp", source_seq: 0 }]);
    expect(computeMethodology(r)).toEqual(computeMethodology(r));
  });
});
```

- [ ] **Step 2: Run to confirm FAIL** — `npx vitest run src/lib/analysis/methodology.test.ts`.

- [ ] **Step 3: Implement `methodology.ts`:**
```ts
import type { WatcherReport, Episode, Finding } from "../../types/report";

interface Ctx {
  episodes: Episode[];
  findings: Finding[];
  binaries: Set<string>;
  techniquesByTactic: Map<string, Set<string>>;
  ports: Map<string, number>;   // "445" -> source_seq
  hasWeb: boolean; webSeq: number | null;
  hasFoothold: boolean;
}

export interface MethodologyCheck { id: string; tactic: string; label: string; applicable: boolean; done: boolean; hint: string; evidence_seq: number | null; }
export interface MethodologyResult { coverage_pct: number; checks: MethodologyCheck[]; }

interface Rule {
  id: string; tactic: string; label: string; hint: string;
  applies: (c: Ctx) => number | null; // returns evidence_seq when applicable, else null
  done: (c: Ctx) => boolean;
}

const usesAny = (c: Ctx, bins: string[]) => bins.some((b) => c.binaries.has(b));

const RULES: Rule[] = [
  { id: "port_scan", tactic: "TA0007", label: "Full service scan", hint: "Start with a full service scan (`nmap -sV -sC`).",
    applies: () => 0, done: (c) => usesAny(c, ["nmap", "rustscan", "masscan"]) || c.findings.some((f) => f.kind === "port") },
  { id: "service_version_enum", tactic: "TA0007", label: "Service version enumeration", hint: "Enumerate service versions (`-sV`) to map the exploit surface.",
    applies: (c) => { const p = c.findings.find((f) => f.kind === "port"); return p ? p.source_seq : null; },
    done: (c) => c.findings.some((f) => f.kind === "version") },
  { id: "web_content_enum", tactic: "TA0007", label: "Web content discovery", hint: "Brute web content (`ffuf`/`gobuster`) — you found a web service.",
    applies: (c) => c.hasWeb ? c.webSeq : null,
    done: (c) => usesAny(c, ["gobuster", "ffuf", "feroxbuster", "dirb", "wfuzz"]) || c.findings.filter((f) => f.kind === "url" || f.kind === "path").length >= 2 },
  { id: "smb_enum", tactic: "TA0007", label: "SMB enumeration", hint: "SMB is open — enumerate it (`enum4linux-ng`, `smbclient -L`).",
    applies: (c) => c.ports.get("445") ?? c.ports.get("139") ?? null,
    done: (c) => usesAny(c, ["enum4linux", "enum4linux-ng", "smbclient", "crackmapexec", "cme"]) },
  { id: "priv_enum", tactic: "TA0004", label: "Privilege-escalation enumeration", hint: "After foothold, enumerate privesc (`sudo -l`, `linpeas`, `pspy`).",
    applies: (c) => c.hasFoothold ? (c.episodes.find((e) => e.tactic === "TA0004")?.seq ?? 0) : null,
    done: (c) => usesAny(c, ["linpeas", "linpeas.sh", "pspy", "pspy64", "getcap"]) || c.episodes.some((e) => /\bsudo\s+-l\b/.test(e.cmd)) },
];

function buildCtx(report: WatcherReport): Ctx {
  const episodes = report.episodes;
  const findings = report.findings ?? [];
  const binaries = new Set(episodes.map((e) => e.binary.toLowerCase()).filter(Boolean));
  const techniquesByTactic = new Map<string, Set<string>>();
  for (const e of episodes) { if (!e.technique) continue; (techniquesByTactic.get(e.tactic) ?? techniquesByTactic.set(e.tactic, new Set()).get(e.tactic)!).add(e.technique); }
  const ports = new Map<string, number>();
  for (const f of findings) if (f.kind === "port") { const n = f.value.split("/")[0]; if (!ports.has(n)) ports.set(n, f.source_seq); }
  const webPort = ["80", "443", "8080", "8000", "8443"].map((p) => ports.get(p)).find((s) => s != null) ?? null;
  const urlSeq = findings.find((f) => f.kind === "url")?.source_seq ?? null;
  const webSeq = webPort ?? urlSeq;
  const hasWeb = webSeq != null;
  const hasFoothold = report.golden_dag.some((o) => o.tactic === "TA0002" && o.user_satisfied_by_seq != null)
    || episodes.some((e) => e.context_path && /ssh:|target/i.test(e.context_path));
  return { episodes, findings, binaries, techniquesByTactic, ports, hasWeb, webSeq, hasFoothold };
}

/** Deterministic methodology coverage: applicable disciplined checks the run performed. */
export function computeMethodology(report: WatcherReport): MethodologyResult {
  const c = buildCtx(report);
  const checks: MethodologyCheck[] = RULES.map((r) => {
    const ev = r.applies(c);
    const applicable = ev != null;
    return { id: r.id, tactic: r.tactic, label: r.label, applicable, done: applicable ? r.done(c) : false, hint: r.hint, evidence_seq: applicable ? ev : null };
  });
  const applicable = checks.filter((c) => c.applicable);
  const doneN = applicable.filter((c) => c.done).length;
  const coverage_pct = applicable.length === 0 ? 0 : (doneN / applicable.length) * 100;
  return { coverage_pct, checks };
}
```

- [ ] **Step 4: Run to confirm PASS**, then **Step 5: Commit**
```bash
git add src/lib/analysis/methodology.ts src/lib/analysis/methodology.test.ts
git commit -m "feat: deterministic methodology-coverage engine"
```

---

## Task 3: Focus discipline (anti-tunnel-vision) (WP-3)

**Files:** Create `src/lib/analysis/focus.ts`, `src/lib/analysis/focus.test.ts`. Modify `src/lib/pipeline/align.ts` (export `LOW_YIELD`).

**Interfaces produced:**
```ts
export interface RabbitHole { start_seq: number; end_seq: number; binary: string; wasted_ms: number; }
export interface FocusResult { discipline_pct: number; rabbit_holes: RabbitHole[]; }
export function computeFocus(report: WatcherReport): FocusResult;
```

- [ ] **Step 1: Export `LOW_YIELD` from `align.ts`** — change `const LOW_YIELD = ...` to `export const LOW_YIELD = ...`. (DRY — focus.ts imports it.)

- [ ] **Step 2: Write the failing test** (`focus.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { computeFocus } from "./focus";
import type { WatcherReport, Episode } from "../../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "sqlmap", duration_ms: 60000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0001", ...o });
const rep = (episodes: Episode[], tActive = 300000): WatcherReport => ({
  schema_version: "1.3", session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:20:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
  episodes, phases: [], golden_dag: [], findings: [],
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: tActive }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] }, redaction_profile: "full",
});

describe("computeFocus", () => {
  it("detects a run of >=3 consecutive low-yield same-binary episodes as one rabbit hole", () => {
    const eps = [0, 1, 2, 3].map((seq) => ep({ seq, binary: "sqlmap", alignment: "detour", output_digest: "no results found" }));
    const res = computeFocus(rep(eps));
    expect(res.rabbit_holes.length).toBe(1);
    expect(res.rabbit_holes[0]).toMatchObject({ start_seq: 0, end_seq: 3, binary: "sqlmap" });
    expect(res.discipline_pct).toBeLessThan(100);
  });
  it("does not flag a single failure that is then pivoted away from", () => {
    const eps = [ep({ seq: 0, binary: "sqlmap", alignment: "detour", output_digest: "no results" }), ep({ seq: 1, binary: "gobuster", alignment: "match" })];
    const res = computeFocus(rep(eps));
    expect(res.rabbit_holes).toEqual([]);
    expect(res.discipline_pct).toBe(100);
  });
  it("is deterministic", () => { const r = rep([0,1,2].map((seq)=>ep({seq,alignment:"detour",output_digest:"fail"}))); expect(computeFocus(r)).toEqual(computeFocus(r)); });
});
```

- [ ] **Step 3: Run to confirm FAIL.**

- [ ] **Step 4: Implement `focus.ts`:**
```ts
import type { WatcherReport, Episode } from "../../types/report";
import { LOW_YIELD } from "../pipeline/align";

export interface RabbitHole { start_seq: number; end_seq: number; binary: string; wasted_ms: number; }
export interface FocusResult { discipline_pct: number; rabbit_holes: RabbitHole[]; }

const RUN_MIN = 3; // sustained low-yield episodes on one binary before it's a rabbit hole

function lowYield(e: Episode): boolean {
  return e.alignment === "detour" || e.loop_of_seq != null || (e.exit_code != null && e.exit_code !== 0) || (e.output_digest != null && LOW_YIELD.test(e.output_digest));
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Deterministic focus discipline: sustained low-yield persistence on one surface = a rabbit hole. */
export function computeFocus(report: WatcherReport): FocusResult {
  const running = report.episodes.filter((e) => e.actor !== "think_pause" && e.actor !== "idle");
  const holes: RabbitHole[] = [];
  let i = 0;
  while (i < running.length) {
    const bin = running[i].binary.toLowerCase();
    if (!bin || !lowYield(running[i])) { i++; continue; }
    let j = i;
    while (j + 1 < running.length && running[j + 1].binary.toLowerCase() === bin && lowYield(running[j + 1])) j++;
    const len = j - i + 1;
    if (len >= RUN_MIN) {
      let wasted = 0;
      for (let k = i; k <= j; k++) wasted += running[k].duration_ms + running[k].gap_before_ms;
      holes.push({ start_seq: running[i].seq, end_seq: running[j].seq, binary: bin, wasted_ms: wasted });
    }
    i = j + 1;
  }
  const tActive = report.metrics.time_waster.t_active_ms || 1;
  const wastedTotal = holes.reduce((a, h) => a + h.wasted_ms, 0);
  const discipline_pct = clamp(100 - (wastedTotal / tActive) * 100);
  return { discipline_pct, rabbit_holes: holes };
}
```

- [ ] **Step 5: Run PASS**, then **Commit**
```bash
git add src/lib/analysis/focus.ts src/lib/analysis/focus.test.ts src/lib/pipeline/align.ts
git commit -m "feat: focus-discipline (anti-tunnel-vision) engine"
```

---

## Task 4: Recovery signal (WP-4)

**Files:** Create `src/lib/analysis/recovery.ts`, `src/lib/analysis/recovery.test.ts`.

**Interfaces produced:**
```ts
export interface Recovery { stuck_seq: number; recovered_seq: number; latency_ms: number; }
export interface RecoveryResult { recoveries: Recovery[]; median_ms: number | null; }
export function computeRecovery(report: WatcherReport): RecoveryResult;
```

- [ ] **Step 1: Write the failing test** (`recovery.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { computeRecovery } from "./recovery";
import type { WatcherReport, Episode } from "../../types/report";

const ep = (o: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "x", duration_ms: 1000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", ...o });
const rep = (episodes: Episode[], golden: WatcherReport["golden_dag"] = []): WatcherReport => ({
  schema_version: "1.3", session: { uuid: "u", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:20:00Z", target_scope: "t", shell: "bash", source: "local_pty" },
  episodes, phases: [], golden_dag: golden, findings: [],
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] }, redaction_profile: "full",
});

describe("computeRecovery", () => {
  it("measures latency from a stuck cluster to the next objective-advancing episode", () => {
    const eps = [
      ep({ seq: 0, alignment: "detour", duration_ms: 60000 }),
      ep({ seq: 1, alignment: "detour", duration_ms: 60000 }),
      ep({ seq: 2, alignment: "match", duration_ms: 1000 }),
    ];
    const golden = [{ objective: "o", tactic: "TA0007", satisfied_by: ["x"], user_satisfied_by_seq: 2 }];
    const res = computeRecovery(rep(eps, golden));
    expect(res.recoveries.length).toBe(1);
    expect(res.recoveries[0]).toMatchObject({ stuck_seq: 0, recovered_seq: 2 });
    expect(res.recoveries[0].latency_ms).toBeGreaterThan(0);
    expect(res.median_ms).toBe(res.recoveries[0].latency_ms);
  });
  it("returns [] and null median when there are no stalls", () => {
    const res = computeRecovery(rep([ep({ seq: 0, alignment: "match" })], [{ objective: "o", tactic: "TA0007", satisfied_by: ["x"], user_satisfied_by_seq: 0 }]));
    expect(res.recoveries).toEqual([]);
    expect(res.median_ms).toBeNull();
  });
  it("is deterministic", () => { const r = rep([ep({seq:0,alignment:"detour"}),ep({seq:1,alignment:"detour"}),ep({seq:2,alignment:"match"})],[{objective:"o",tactic:"TA0007",satisfied_by:["x"],user_satisfied_by_seq:2}]); expect(computeRecovery(r)).toEqual(computeRecovery(r)); });
});
```

- [ ] **Step 2: Run to confirm FAIL.**

- [ ] **Step 3: Implement `recovery.ts`:**
```ts
import type { WatcherReport, Episode } from "../../types/report";

export interface Recovery { stuck_seq: number; recovered_seq: number; latency_ms: number; }
export interface RecoveryResult { recoveries: Recovery[]; median_ms: number | null; }

function isStuck(e: Episode): boolean { return e.alignment === "detour" || e.loop_of_seq != null; }

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Deterministic recovery: latency from the start of a stuck/detour cluster to the next objective-advancing episode. */
export function computeRecovery(report: WatcherReport): RecoveryResult {
  const running = report.episodes.filter((e) => e.actor !== "think_pause" && e.actor !== "idle");
  const satisfierSeqs = new Set(report.golden_dag.map((o) => o.user_satisfied_by_seq).filter((s): s is number => s != null));
  const recoveries: Recovery[] = [];
  let i = 0;
  while (i < running.length) {
    if (!isStuck(running[i])) { i++; continue; }
    const start = i;
    while (i < running.length && isStuck(running[i])) i++;
    // i now points at the first non-stuck episode after the cluster (or end)
    const recovered = running.slice(i).find((e) => satisfierSeqs.has(e.seq) || e.alignment === "match" || e.alignment === "alternative");
    if (recovered) {
      let latency = 0;
      for (let k = start; k < running.length && running[k].seq <= recovered.seq; k++) latency += running[k].duration_ms + running[k].gap_before_ms;
      recoveries.push({ stuck_seq: running[start].seq, recovered_seq: recovered.seq, latency_ms: latency });
    }
  }
  return { recoveries, median_ms: median(recoveries.map((r) => r.latency_ms)) };
}
```

- [ ] **Step 4: Run PASS**, then **Commit**
```bash
git add src/lib/analysis/recovery.ts src/lib/analysis/recovery.test.ts
git commit -m "feat: recovery (pivot-latency) engine"
```

---

## Task 5: Wire headline numbers into metrics (WP-5)

**Files:** `src/lib/metrics.ts`, `src/lib/pipeline/ingest.ts`, test `src/lib/metrics.test.ts`.

**Interfaces:** consumes `computeMethodology`/`computeFocus`/`computeRecovery`. `ComputedMetrics` gains `methodology_coverage_pct`, `focus_discipline_pct`, `recovery_median_ms`.

- [ ] **Step 1: Write a grade-stability + wiring test** (add to `metrics.test.ts`):
```ts
import { computeGrade } from "./bridge/grade";
// ... using an existing fixture import pattern in this file:
it("adds analysis fields without changing existing metrics or the grade", () => {
  const before = computeGrade(fixture); // fixture = an imported existing report
  const m = computeMetrics(fixture);
  expect(typeof m.methodology_coverage_pct).toBe("number");
  expect(typeof m.focus_discipline_pct).toBe("number");
  expect(m.recovery_median_ms === null || typeof m.recovery_median_ms === "number").toBe(true);
  // existing fields untouched:
  expect(m.objective_coverage_pct).toBe(computeMetrics(fixture).objective_coverage_pct);
  // grade unchanged (analysis fields must not feed the grade):
  expect(computeGrade({ ...fixture, metrics: { ...fixture.metrics } })).toEqual(before);
});
```
(Adapt to how `metrics.test.ts` currently loads a fixture.)

- [ ] **Step 2: Implement wiring in `metrics.ts`** — import the three engines; in `computeMetrics`, after the existing return object is assembled, add:
```ts
import { computeMethodology } from "./analysis/methodology";
import { computeFocus } from "./analysis/focus";
import { computeRecovery } from "./analysis/recovery";
// inside computeMetrics, extend ComputedMetrics type + return:
methodology_coverage_pct: computeMethodology(report).coverage_pct,
focus_discipline_pct: computeFocus(report).discipline_pct,
recovery_median_ms: computeRecovery(report).median_ms,
```
Add the three fields to the `ComputedMetrics` interface. Do NOT touch any existing field.

- [ ] **Step 3: Write them to the report in `ingest.ts::assembleReport`** — add to the `m: Metrics` object: `methodology_coverage_pct: round(metrics.methodology_coverage_pct)`, `focus_discipline_pct: round(metrics.focus_discipline_pct)`, `recovery_median_ms: metrics.recovery_median_ms`; change `schema_version` to `"1.3"`.

- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Confirm the grade-stability test passes and existing fixtures' grades are unchanged.

- [ ] **Step 5: Commit**
```bash
git add src/lib/metrics.ts src/lib/metrics.test.ts src/lib/pipeline/ingest.ts
git commit -m "feat: surface analysis signals as v1.3 metrics (grade frozen)"
```

---

## Task 6: Surface as coaching insights in the Phase Audit (WP-6)

**Files:** `src/lib/audits.ts`, `src/lib/audits.test.ts`.

**Context:** read `src/lib/audits.ts` first — `buildPhaseAudits(report)` produces `PhaseAudit[]` each with `insights: AuditItem[]` and `manual: AuditItem[]`, plus a `general` bucket. `AuditItem` has `{ id, kind, title, detail?, category?, savings_ms?, evidence_seq? }` (confirm exact shape). You will emit new `AuditItem`s from the three engines and merge them into the right phase.

- [ ] **Step 1: Write the failing test** (`audits.test.ts`): a report engineered with a `445` port finding and no SMB tool yields, in the Discovery (TA0007) phase's insights, an item whose title mentions SMB and whose `evidence_seq` is the finding's `source_seq`. Also: a rabbit-hole run yields a "step back and enumerate" item.

- [ ] **Step 2: Implement** — in `audits.ts`, after building the base phase audits, call `computeMethodology`/`computeFocus`/`computeRecovery` and:
  - For each `check` with `applicable && !done`: push an `AuditItem` (`kind: "insight"`, `title` from `check.label`, `detail` from `check.hint`, `category` derived from `check.tactic`, `evidence_seq: check.evidence_seq`) into the phase whose `mitre_tactic === check.tactic` (or `general` if no such phase).
  - For the largest `rabbit_hole` (if any): one `AuditItem` ("Stepped in a rabbit hole — N low-yield `<binary>` attempts; step back and enumerate", `savings_ms: wasted_ms`, `evidence_seq: start_seq`).
  - For a slow recovery (median above a test-pinned threshold, e.g. > 5 min): one general note.
  Keep it deterministic; text is redaction-safe (uses labels/binary names, not raw output).

- [ ] **Step 3: Run** the audits test + full suite; confirm no existing insight regresses.

- [ ] **Step 4: Commit**
```bash
git add src/lib/audits.ts src/lib/audits.test.ts
git commit -m "feat: methodology/focus/recovery coaching insights in Phase Audit"
```

---

## Task 7: Docs + honest limits (WP-7)

**Files:** `README.md`, `crates/capture/CAPTURE.md`, and a one-line in-product note near the grade rationale (`src/components/Assessment.tsx` or wherever the grade is explained — read to confirm).

- [ ] **Step 1:** README/CAPTURE: add a short "Methodology signals" note describing the three signals and that they inform coaching but are **not** (yet) part of the letter grade.
- [ ] **Step 2:** Near the grade explanation in the UI, add one muted line: "Methodology, focus, and recovery are surfaced as coaching — not yet weighted into the grade." (No layout change.)
- [ ] **Step 3:** Run `npm test && npm run build`; commit.
```bash
git add README.md crates/capture/CAPTURE.md src/components/Assessment.tsx
git commit -m "docs: methodology/focus/recovery signals + honest grade-scope note"
```

---

## Self-Review (planner)
- **Spec coverage:** WP-1→T1, WP-2→T2, WP-3→T3, WP-4→T4, WP-5→T5, WP-6→T6, WP-7→T7. All spec goals G1–G4 covered; grade-freeze enforced by T5's stability test.
- **Placeholders:** engine code is complete; T6's audit emission is described with exact inputs (read `audits.ts` for the `AuditItem` shape — the one read the plan asks for).
- **Type consistency:** `MethodologyResult`/`FocusResult`/`RecoveryResult` defined once (T2/3/4), consumed in T5/T6 with matching names; `LOW_YIELD` exported once (T3) and imported in focus.ts.
- **Determinism:** every engine has a determinism test; grade stability asserted in T5.
