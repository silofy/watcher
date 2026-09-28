# Blue-team investigation grading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grade a DFIR analyst's investigation session against an incident — auto-derived from an attacker capture — producing the same debrief shape as an offensive run (grade, Ghost, one lesson).

**Architecture:** Two `WatcherReport`s in (attacker capture = the incident answer key; analyst session = the run). A new `src/lib/defense/` layer derives the incident, matches which artifacts the analyst surfaced, and grades on a 5-metric defensive rubric. Everything is additive and pure; the offense path is untouched.

**Tech Stack:** TypeScript (strict), Vitest. No new runtime deps. Reuses the existing pipeline, capture adapters, and the `GhostResult` / `OneLesson` shapes for rendering.

**Spec:** docs/superpowers/specs/2026-09-28-blue-team-investigation-grading-design.md

## Global Constraints

- Deterministic core; a model may sharpen prose, never facts or the grade.
- Redaction-safe: indicators come only from already-redacted attacker output; never un-redact.
- No new runtime dependencies. TypeScript strict; Vitest. Run tests with `npx vitest run <file>`, typecheck with `npx tsc -b --noEmit`.
- Additive only: no change to the offense rubric, golden alignment, or existing reports. New code confined to `src/lib/defense/`, one ingest script, and a mode-aware relabel in the debrief.
- Rubric weights (sum 1.0): Coverage 0.34 · Reconstruction 0.20 · Time-to-detect 0.16 · Scoping 0.16 · Discipline 0.14.
- Reuse the exact shapes: `GhostDiffItem { objective, verdict, unlock_seq, actual_seq, lag_ms, note }`, `GhostResult { time_lost_ms, human_wins, items }` (verdicts: "ahead"|"on_time"|"late_pivot"|"skipped"|"off_path_win"); `OneLesson { text, evidence_seq, pivot? }`.

---

### Task 1: Types + incident derivation (`defense/incident.ts`)

**Files:**
- Create: `src/lib/defense/types.ts`, `src/lib/defense/incident.ts`, `src/lib/defense/incident.test.ts`

**Interfaces:**
- Consumes: `WatcherReport`, `Episode`, `Finding` from `../../types/report`.
- Produces:
  - `types.ts`: `UkcPhase`, `Artifact`, `Incident`, `ArtifactHit`, `InvestigationResult`, `DefenseMetric`, `DefenseGrade`, `DefenseReport` (exact fields below).
  - `incident.ts`: `deriveIncident(attacker: WatcherReport): Incident`.

- [ ] **Step 1: Write `src/lib/defense/types.ts`**

```ts
import type { Session } from "../../types/report";
import type { GhostResult } from "../ghost/ghost";
import type { OneLesson } from "../one-lesson";

export type UkcPhase =
  | "reconnaissance" | "initial-access" | "execution" | "persistence"
  | "privilege-escalation" | "defense-evasion" | "credential-access"
  | "discovery" | "lateral-movement" | "collection" | "exfiltration" | "impact" | "unknown";

export interface Artifact {
  id: string;
  label: string;
  phase: UkcPhase;
  technique: string;
  indicators: string[];
  entities: string[];
  weight: number;
  depends_on: string[];
  source_seq: number;
}

export interface Incident {
  artifacts: Artifact[];
  entities: string[];
  target_scope: string;
}

export interface ArtifactHit {
  artifact_id: string;
  found: boolean;
  found_by_seq: number | null;
  found_at_ms: number | null;
  matched_indicator: string | null;
}

export interface InvestigationResult {
  incident: Incident;
  hits: ArtifactHit[];
  advancing_seqs: number[];
  noise_seqs: number[];
}

export interface DefenseMetric { name: string; score: number; weight: number; points: number }
export interface DefenseGrade { score: number; letter: string; metrics: DefenseMetric[] }

export interface DefenseReport {
  mode: "defense";
  session: Session;
  incident: Incident;
  result: InvestigationResult;
  grade: DefenseGrade;
  ghost: GhostResult;
  lesson: OneLesson | null;
}
```

- [ ] **Step 2: Write the failing test `src/lib/defense/incident.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { deriveIncident } from "./incident";
import type { WatcherReport } from "../../types/report";

const attacker = {
  session: { target_scope: "HTB :: Abducted", target: { name: "Abducted" } },
  episodes: [
    { seq: 7, cmd: "echo 'x' > '|bash'", binary: "echo", tactic: "TA0002", technique: "T1059", output_digest: "payload written; CVE-2026-4480", frameworks: { ukc: "execution" }, started_at_ms: 1000 },
    { seq: 25, cmd: "echo -e '[Service]' > /etc/systemd/system/smbd.service.d/override.conf", binary: "echo", tactic: "TA0004", technique: "T1543", output_digest: "drop-in written", frameworks: { ukc: "privilege-escalation" }, started_at_ms: 2000 },
    { seq: 11, cmd: "whoami", binary: "whoami", tactic: "TA0004", technique: "T1033", output_digest: "nobody", frameworks: { ukc: "privilege-escalation" }, started_at_ms: 1500 },
  ],
  findings: [{ id: "vuln:CVE-2026-4480", kind: "vuln", value: "CVE-2026-4480", source_seq: 7 }],
  phases: [],
  golden_dag: [],
} as unknown as WatcherReport;

describe("deriveIncident", () => {
  it("turns malicious steps into weighted artifacts with discriminating indicators", () => {
    const inc = deriveIncident(attacker);
    // a generic-only command (whoami) is not its own artifact
    expect(inc.artifacts.some((a) => a.source_seq === 11)).toBe(false);
    const injection = inc.artifacts.find((a) => a.source_seq === 7)!;
    expect(injection.phase).toBe("execution");
    expect(injection.indicators).toContain("CVE-2026-4480");
    const persist = inc.artifacts.find((a) => a.source_seq === 25)!;
    expect(persist.indicators).toContain("override.conf");
    // higher-value phase carries more weight than a low one
    expect(persist.weight).toBeGreaterThan(0);
    // artifacts are ordered by seq and chained
    expect(inc.artifacts.map((a) => a.source_seq)).toEqual([7, 25]);
    expect(inc.artifacts[1].depends_on).toContain(inc.artifacts[0].id);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/defense/incident.test.ts` → FAIL (no `./incident`).

- [ ] **Step 4: Write `src/lib/defense/incident.ts`**

```ts
import type { WatcherReport, Episode, Finding } from "../../types/report";
import type { Artifact, Incident, UkcPhase } from "./types";

const PHASE_WEIGHT: Record<string, number> = {
  "initial-access": 5, execution: 4, persistence: 5, "privilege-escalation": 5,
  "credential-access": 4, "lateral-movement": 4, impact: 5, exfiltration: 4,
  "defense-evasion": 3, discovery: 2, collection: 2, reconnaissance: 1, unknown: 2,
};

// Tokens too generic to prove an analyst "found" a specific malicious step.
const STOP = new Set([
  "echo", "cat", "ls", "cd", "id", "whoami", "cp", "mv", "rm", "chmod", "chown",
  "the", "and", "for", "with", "sudo", "bash", "sh", "-e", "-l", "-a", "-la", "|bash",
]);

function phaseOf(ep: Episode): UkcPhase {
  const u = (ep.frameworks?.ukc ?? "").toLowerCase().replace(/\s+/g, "-");
  return (u || "unknown") as UkcPhase;
}

/** Distinctive tokens from a command: filenames, paths, long identifiers — not generic verbs. */
function indicatorsFrom(ep: Episode): string[] {
  const out = new Set<string>();
  for (const tok of `${ep.cmd} ${ep.output_digest ?? ""}`.split(/[\s'"();]+/)) {
    const t = tok.trim();
    if (t.length < 4 || STOP.has(t.toLowerCase())) continue;
    // a path/file, a CVE, an override/service unit, or a long distinctive token
    if (/[/.]/.test(t) || /^CVE-\d/i.test(t) || t.length >= 6) out.add(t.replace(/^\.*/, ""));
    if (out.size >= 6) break;
  }
  // the file basename is a strong indicator (override.conf, rootbash)
  const file = ep.cmd.match(/[\w.-]+\.(conf|sh|service|txt|php|py|exe)\b/);
  if (file) out.add(file[0]);
  return [...out];
}

function entitiesFrom(ep: Episode): string[] {
  const text = `${ep.cmd} ${ep.output_digest ?? ""}`;
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[\w-]+\.(?:htb|local|internal)\b/gi)) out.add(m[0]);
  for (const m of text.matchAll(/user:\[([^\]]+)\]/g)) out.add(m[1]);
  return [...out];
}

export function deriveIncident(attacker: WatcherReport): Incident {
  const eps = [...(attacker.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const cveBySeq = new Map<number, string>();
  for (const f of (attacker.findings ?? []) as Finding[]) {
    if (f.kind === "vuln" && f.source_seq != null) cveBySeq.set(f.source_seq, f.value);
  }
  const artifacts: Artifact[] = [];
  const allEntities = new Set<string>();
  let prevId: string | null = null;
  for (const ep of eps) {
    const indicators = indicatorsFrom(ep);
    const cve = cveBySeq.get(ep.seq);
    if (cve) indicators.push(cve);
    // A step with no discriminating indicator is not a standalone artifact (a generic command).
    if (indicators.length === 0) continue;
    const phase = phaseOf(ep);
    const entities = entitiesFrom(ep);
    entities.forEach((e) => allEntities.add(e));
    const id = `art:seq${ep.seq}`;
    artifacts.push({
      id,
      label: cve ? `${ep.binary} (${cve})` : `${ep.binary}: ${ep.cmd.slice(0, 48)}`,
      phase,
      technique: ep.technique ?? "",
      indicators: [...new Set(indicators)],
      entities,
      weight: (PHASE_WEIGHT[phase] ?? 2) + (cve ? 2 : 0),
      depends_on: prevId ? [prevId] : [],
      source_seq: ep.seq,
    });
    prevId = id;
  }
  return {
    artifacts,
    entities: [...allEntities],
    target_scope: attacker.session?.target?.name ?? attacker.session?.target_scope ?? "Incident",
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/defense/incident.test.ts` → PASS. Then `npx tsc -b --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/defense/types.ts src/lib/defense/incident.ts src/lib/defense/incident.test.ts
git commit -m "feat(defense): incident answer-key derivation from an attacker capture"
```

---

### Task 2: Investigation alignment (`defense/align.ts`)

**Files:**
- Create: `src/lib/defense/align.ts`, `src/lib/defense/align.test.ts`

**Interfaces:**
- Consumes: `Incident`, `ArtifactHit`, `InvestigationResult` from `./types`; `WatcherReport`, `Episode`.
- Produces: `alignInvestigation(incident: Incident, run: WatcherReport): InvestigationResult`.

- [ ] **Step 1: Write the failing test `src/lib/defense/align.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { alignInvestigation } from "./align";
import type { Incident } from "./types";
import type { WatcherReport } from "../../types/report";

const incident: Incident = {
  target_scope: "Abducted",
  entities: ["abducted.htb"],
  artifacts: [
    { id: "art:seq7", label: "injection", phase: "execution", technique: "T1059", indicators: ["CVE-2026-4480", "|bash"], entities: [], weight: 6, depends_on: [], source_seq: 7 },
    { id: "art:seq25", label: "persistence", phase: "privilege-escalation", technique: "T1543", indicators: ["override.conf"], entities: [], weight: 5, depends_on: ["art:seq7"], source_seq: 25 },
  ],
};

const run = {
  session: {},
  episodes: [
    { seq: 1, cmd: "grep -ri CVE-2026-4480 /var/log", binary: "grep", started_at_ms: 0, output_digest: "match: samba print injection CVE-2026-4480" },
    { seq: 2, cmd: "ls -la /home", binary: "ls", started_at_ms: 5000, output_digest: "nothing useful" },
  ],
} as unknown as WatcherReport;

describe("alignInvestigation", () => {
  it("marks an artifact found when a run episode surfaces its indicator, and flags noise", () => {
    const res = alignInvestigation(incident, run);
    const inj = res.hits.find((h) => h.artifact_id === "art:seq7")!;
    expect(inj.found).toBe(true);
    expect(inj.found_by_seq).toBe(1);
    expect(inj.matched_indicator).toBe("CVE-2026-4480");
    const persist = res.hits.find((h) => h.artifact_id === "art:seq25")!;
    expect(persist.found).toBe(false);
    expect(res.advancing_seqs).toContain(1);
    expect(res.noise_seqs).toContain(2); // the ls found nothing
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/defense/align.test.ts` → FAIL.

- [ ] **Step 3: Write `src/lib/defense/align.ts`**

```ts
import type { WatcherReport, Episode } from "../../types/report";
import type { Incident, ArtifactHit, InvestigationResult } from "./types";

/** Token-level containment: indicator appears as a whole token in the text (case-insensitive). */
function surfaces(text: string, indicator: string): boolean {
  const hay = text.toLowerCase();
  const needle = indicator.toLowerCase();
  if (!hay.includes(needle)) return false;
  // guard against matching inside a longer alphanumeric run (id -> guid); allow path/punct boundaries
  const i = hay.indexOf(needle);
  const before = hay[i - 1] ?? " ";
  const after = hay[i + needle.length] ?? " ";
  const wordish = (c: string) => /[a-z0-9]/.test(c);
  const boundaryOk = (edge: string, inner: string) => !(wordish(edge) && wordish(inner));
  return boundaryOk(before, needle[0]) && boundaryOk(after, needle[needle.length - 1]);
}

export function alignInvestigation(incident: Incident, run: WatcherReport): InvestigationResult {
  const eps = [...(run.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const t0 = eps[0]?.started_at_ms ?? 0;
  const hits: ArtifactHit[] = incident.artifacts.map((a) => ({
    artifact_id: a.id, found: false, found_by_seq: null, found_at_ms: null, matched_indicator: null,
  }));
  const advancing = new Set<number>();
  for (const ep of eps) {
    const text = `${ep.cmd} ${ep.output_digest ?? ""}`;
    let advanced = false;
    incident.artifacts.forEach((a, i) => {
      if (hits[i].found) return;
      const ind = a.indicators.find((x) => surfaces(text, x));
      if (ind) {
        hits[i] = { artifact_id: a.id, found: true, found_by_seq: ep.seq, found_at_ms: (ep.started_at_ms ?? t0) - t0, matched_indicator: ind };
        advanced = true;
      }
    });
    if (advanced) advancing.add(ep.seq);
  }
  const noise = eps.filter((e) => !advancing.has(e.seq)).map((e) => e.seq);
  return { incident, hits, advancing_seqs: [...advancing], noise_seqs: noise };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/defense/align.test.ts` → PASS. `npx tsc -b --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/defense/align.ts src/lib/defense/align.test.ts
git commit -m "feat(defense): investigation alignment (artifact-found matching)"
```

---

### Task 3: Defensive rubric (`defense/grade.ts`)

**Files:**
- Create: `src/lib/defense/grade.ts`, `src/lib/defense/grade.test.ts`

**Interfaces:**
- Consumes: `InvestigationResult`, `DefenseGrade`, `DefenseMetric` from `./types`.
- Produces: `gradeDefense(result: InvestigationResult): DefenseGrade`; `letterFromScore(score: number): string`.

- [ ] **Step 1: Write the failing test `src/lib/defense/grade.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { gradeDefense, letterFromScore } from "./grade";
import type { Incident, InvestigationResult } from "./types";

const inc: Incident = {
  target_scope: "x", entities: ["a.htb", "b.htb"],
  artifacts: [
    { id: "a1", label: "", phase: "execution", technique: "", indicators: [], entities: ["a.htb"], weight: 6, depends_on: [], source_seq: 1 },
    { id: "a2", label: "", phase: "privilege-escalation", technique: "", indicators: [], entities: ["b.htb"], weight: 4, depends_on: ["a1"], source_seq: 2 },
  ],
};

function res(over: Partial<InvestigationResult>): InvestigationResult {
  return { incident: inc, hits: [], advancing_seqs: [], noise_seqs: [], ...over };
}

describe("gradeDefense", () => {
  it("scores a full, in-order, clean investigation near the top", () => {
    const r = res({
      hits: [
        { artifact_id: "a1", found: true, found_by_seq: 1, found_at_ms: 0, matched_indicator: "x" },
        { artifact_id: "a2", found: true, found_by_seq: 2, found_at_ms: 1000, matched_indicator: "y" },
      ],
      advancing_seqs: [1, 2], noise_seqs: [],
    });
    const g = gradeDefense(r);
    expect(g.score).toBeGreaterThan(85);
    expect(g.metrics.find((m) => m.name === "Coverage")!.score).toBe(100);
    expect(g.metrics.reduce((s, m) => s + m.weight, 0)).toBeCloseTo(1, 5);
  });

  it("penalizes partial coverage, out-of-order finds, and noise", () => {
    const r = res({
      hits: [
        { artifact_id: "a1", found: false, found_by_seq: null, found_at_ms: null, matched_indicator: null },
        { artifact_id: "a2", found: true, found_by_seq: 5, found_at_ms: 9000, matched_indicator: "y" }, // found dependent before its prereq
      ],
      advancing_seqs: [5], noise_seqs: [1, 2, 3, 4],
    });
    const g = gradeDefense(r);
    expect(g.metrics.find((m) => m.name === "Coverage")!.score).toBeLessThan(60);
    expect(g.metrics.find((m) => m.name === "Reconstruction")!.score).toBeLessThan(100);
    expect(g.metrics.find((m) => m.name === "Discipline")!.score).toBeLessThan(50);
  });
});

describe("letterFromScore", () => {
  it("maps score bands to letters", () => {
    expect(letterFromScore(92)).toBe("A");
    expect(letterFromScore(83)).toBe("B");
    expect(letterFromScore(50)).toBe("F");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/defense/grade.test.ts` → FAIL.

- [ ] **Step 3: Write `src/lib/defense/grade.ts`**

```ts
import type { InvestigationResult, DefenseGrade, DefenseMetric, ArtifactHit } from "./types";

export function letterFromScore(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

const round = (n: number) => Math.round(n * 10) / 10;

export function gradeDefense(result: InvestigationResult): DefenseGrade {
  const { incident, hits, advancing_seqs, noise_seqs } = result;
  const arts = incident.artifacts;
  const hitById = new Map<string, ArtifactHit>(hits.map((h) => [h.artifact_id, h]));
  const foundIds = new Set(hits.filter((h) => h.found).map((h) => h.artifact_id));

  // Coverage: weighted fraction of artifacts surfaced.
  const totalW = arts.reduce((s, a) => s + a.weight, 0) || 1;
  const foundW = arts.filter((a) => foundIds.has(a.id)).reduce((s, a) => s + a.weight, 0);
  const coverage = (foundW / totalW) * 100;

  // Reconstruction: of found artifacts with deps, the share found after all their prereqs.
  const seqOf = (id: string) => hitById.get(id)?.found_by_seq ?? Infinity;
  const withDeps = arts.filter((a) => foundIds.has(a.id) && a.depends_on.length > 0);
  const inOrder = withDeps.filter((a) => a.depends_on.every((d) => foundIds.has(d) && seqOf(d) <= seqOf(a.id)));
  const reconstruction = withDeps.length ? (inOrder.length / withDeps.length) * 100 : 100;

  // Time-to-detect: earlier surfacing of high-weight artifacts is better. Normalize each found
  // artifact's order position (index among run steps) to [0,1]; score = 100*(1 - avg position).
  const foundHits = hits.filter((h) => h.found && h.found_by_seq != null);
  const maxSeq = Math.max(1, ...advancing_seqs, ...noise_seqs);
  const dwellAvg = foundHits.length
    ? foundHits.reduce((s, h) => s + (h.found_by_seq! / maxSeq), 0) / foundHits.length
    : 1;
  const timeToDetect = foundHits.length ? Math.max(0, (1 - dwellAvg) * 100) : 0;

  // Scoping: fraction of affected entities the analyst surfaced (an entity is surfaced if any
  // artifact carrying it was found, or it appears among found artifacts' entities).
  const foundEntities = new Set(arts.filter((a) => foundIds.has(a.id)).flatMap((a) => a.entities));
  const scoping = incident.entities.length
    ? (incident.entities.filter((e) => foundEntities.has(e)).length / incident.entities.length) * 100
    : 100;

  // Discipline: advancing steps / total scored steps.
  const scored = advancing_seqs.length + noise_seqs.length;
  const discipline = scored ? (advancing_seqs.length / scored) * 100 : 100;

  const metrics: DefenseMetric[] = [
    { name: "Coverage", score: round(coverage), weight: 0.34, points: 0 },
    { name: "Reconstruction", score: round(reconstruction), weight: 0.2, points: 0 },
    { name: "Time-to-detect", score: round(timeToDetect), weight: 0.16, points: 0 },
    { name: "Scoping", score: round(scoping), weight: 0.16, points: 0 },
    { name: "Discipline", score: round(discipline), weight: 0.14, points: 0 },
  ].map((m) => ({ ...m, points: round(m.score * m.weight) }));

  const score = round(metrics.reduce((s, m) => s + m.points, 0));
  return { score, letter: letterFromScore(score), metrics };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/defense/grade.test.ts` → PASS. `npx tsc -b --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/defense/grade.ts src/lib/defense/grade.test.ts
git commit -m "feat(defense): 5-metric defensive rubric"
```

---

### Task 4: Investigation Ghost + one lesson (`defense/ghost.ts`, `defense/lesson.ts`)

**Files:**
- Create: `src/lib/defense/ghost.ts`, `src/lib/defense/lesson.ts`, `src/lib/defense/ghost.test.ts`, `src/lib/defense/lesson.test.ts`

**Interfaces:**
- Consumes: `Incident`, `InvestigationResult` from `./types`; `GhostResult`, `GhostDiffItem` from `../ghost/ghost`; `OneLesson` from `../one-lesson`.
- Produces: `investigationGhost(result: InvestigationResult): GhostResult`; `defenseLesson(result: InvestigationResult): OneLesson | null`.

- [ ] **Step 1: Write the failing tests**

`src/lib/defense/ghost.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { investigationGhost } from "./ghost";
import type { Incident, InvestigationResult } from "./types";

const inc: Incident = { target_scope: "x", entities: [], artifacts: [
  { id: "a1", label: "injection", phase: "execution", technique: "", indicators: [], entities: [], weight: 6, depends_on: [], source_seq: 7 },
  { id: "a2", label: "persistence", phase: "privilege-escalation", technique: "", indicators: [], entities: [], weight: 5, depends_on: ["a1"], source_seq: 25 },
]};

describe("investigationGhost", () => {
  it("emits a GhostResult with one item per artifact, missed ones marked skipped", () => {
    const res: InvestigationResult = { incident: inc, advancing_seqs: [1], noise_seqs: [],
      hits: [
        { artifact_id: "a1", found: true, found_by_seq: 1, found_at_ms: 0, matched_indicator: "x" },
        { artifact_id: "a2", found: false, found_by_seq: null, found_at_ms: null, matched_indicator: null },
      ] };
    const g = investigationGhost(res);
    expect(g.items).toHaveLength(2);
    expect(g.items.find((i) => i.objective === "persistence")!.verdict).toBe("skipped");
    expect(typeof g.time_lost_ms).toBe("number");
  });
});
```

`src/lib/defense/lesson.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defenseLesson } from "./lesson";
import type { Incident, InvestigationResult } from "./types";

const inc: Incident = { target_scope: "x", entities: [], artifacts: [
  { id: "a1", label: "injection", phase: "execution", technique: "", indicators: [], entities: [], weight: 6, depends_on: [], source_seq: 7 },
  { id: "a2", label: "writable systemd drop-in", phase: "privilege-escalation", technique: "", indicators: [], entities: [], weight: 8, depends_on: [], source_seq: 25 },
]};

describe("defenseLesson", () => {
  it("names the highest-weight missed artifact, deep-linked to its source step", () => {
    const res: InvestigationResult = { incident: inc, advancing_seqs: [], noise_seqs: [],
      hits: [
        { artifact_id: "a1", found: true, found_by_seq: 1, found_at_ms: 0, matched_indicator: "x" },
        { artifact_id: "a2", found: false, found_by_seq: null, found_at_ms: null, matched_indicator: null },
      ] };
    const l = defenseLesson(res)!;
    expect(l.text).toContain("writable systemd drop-in");
    expect(l.evidence_seq).toBe(25);
  });

  it("returns null when every artifact was found", () => {
    const res: InvestigationResult = { incident: inc, advancing_seqs: [], noise_seqs: [],
      hits: inc.artifacts.map((a) => ({ artifact_id: a.id, found: true, found_by_seq: 1, found_at_ms: 0, matched_indicator: "x" })) };
    expect(defenseLesson(res)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/defense/ghost.test.ts src/lib/defense/lesson.test.ts` → FAIL.

- [ ] **Step 3: Write `src/lib/defense/ghost.ts`**

```ts
import type { GhostResult, GhostDiffItem } from "../ghost/ghost";
import type { InvestigationResult, ArtifactHit } from "./types";

/**
 * "You vs. the optimal investigation line": one item per incident artifact, in kill-chain
 * (source_seq) order. Found respecting prerequisites → on_time; found before a prereq was
 * surfaced → late_pivot (you stumbled on the effect before the cause); missed → skipped.
 */
export function investigationGhost(result: InvestigationResult): GhostResult {
  const { incident, hits } = result;
  const byId = new Map<string, ArtifactHit>(hits.map((h) => [h.artifact_id, h]));
  const seqOf = (id: string) => byId.get(id)?.found_by_seq ?? null;
  const items: GhostDiffItem[] = incident.artifacts.map((a) => {
    const h = byId.get(a.id)!;
    let verdict: GhostDiffItem["verdict"];
    if (!h.found) verdict = "skipped";
    else if (a.depends_on.length && a.depends_on.some((d) => { const ds = seqOf(d); return ds == null || ds > (h.found_by_seq ?? Infinity); }))
      verdict = "late_pivot";
    else verdict = "on_time";
    return { objective: a.label, verdict, unlock_seq: a.source_seq, actual_seq: h.found_by_seq, lag_ms: 0, note: "" };
  });
  const time_lost_ms = 0;
  const human_wins = items.filter((i) => i.verdict === "on_time").length;
  return { time_lost_ms, human_wins, items };
}
```

- [ ] **Step 4: Write `src/lib/defense/lesson.ts`**

```ts
import type { OneLesson } from "../one-lesson";
import type { InvestigationResult } from "./types";

/** The single highest-value malicious step the analyst never surfaced. */
export function defenseLesson(result: InvestigationResult): OneLesson | null {
  const found = new Set(result.hits.filter((h) => h.found).map((h) => h.artifact_id));
  const missed = result.incident.artifacts.filter((a) => !found.has(a.id));
  if (missed.length === 0) return null;
  const worst = missed.reduce((a, b) => (b.weight > a.weight ? b : a));
  return {
    text: `You never surfaced ${worst.label}. It is the highest-value step you missed; trace back from what you did find to its origin.`,
    evidence_seq: worst.source_seq,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/defense/ghost.test.ts src/lib/defense/lesson.test.ts` → PASS. `npx tsc -b --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/defense/ghost.ts src/lib/defense/lesson.ts src/lib/defense/ghost.test.ts src/lib/defense/lesson.test.ts
git commit -m "feat(defense): investigation Ghost + one-lesson"
```

---

### Task 5: Report assembly (`defense/assemble.ts`)

**Files:**
- Create: `src/lib/defense/assemble.ts`, `src/lib/defense/assemble.test.ts`

**Interfaces:**
- Consumes: `deriveIncident`, `alignInvestigation`, `gradeDefense`, `investigationGhost`, `defenseLesson`; `WatcherReport`; `DefenseReport` from `./types`.
- Produces: `assembleDefenseReport(attacker: WatcherReport, run: WatcherReport): DefenseReport`.

- [ ] **Step 1: Write the failing test `src/lib/defense/assemble.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { assembleDefenseReport } from "./assemble";
import type { WatcherReport } from "../../types/report";

const attacker = {
  session: { target_scope: "HTB :: Abducted", target: { name: "Abducted" }, source: "plugin", shell: "sysmon" },
  episodes: [
    { seq: 7, cmd: "smbclient print '|bash' override.conf", binary: "smbclient", tactic: "TA0002", technique: "T1059", output_digest: "CVE-2026-4480", frameworks: { ukc: "execution" }, started_at_ms: 1000 },
  ],
  findings: [{ id: "vuln:CVE-2026-4480", kind: "vuln", value: "CVE-2026-4480", source_seq: 7 }],
  phases: [], golden_dag: [],
} as unknown as WatcherReport;

const run = {
  session: { target_scope: "Investigation", source: "plugin", shell: "claude-code", started_at: "2026-09-28T00:00:00Z", uuid: "r" },
  episodes: [{ seq: 1, cmd: "grep CVE-2026-4480 /var/log/samba", binary: "grep", started_at_ms: 0, output_digest: "found CVE-2026-4480" }],
  findings: [], phases: [], golden_dag: [],
} as unknown as WatcherReport;

describe("assembleDefenseReport", () => {
  it("produces a defense report the debrief can read", () => {
    const rep = assembleDefenseReport(attacker, run);
    expect(rep.mode).toBe("defense");
    expect(rep.incident.artifacts.length).toBeGreaterThan(0);
    expect(rep.grade.letter).toMatch(/[A-F]/);
    expect(rep.ghost.items.length).toBe(rep.incident.artifacts.length);
    expect(rep.session.shell).toBe("claude-code"); // the analyst run's session drives the badge
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/defense/assemble.test.ts` → FAIL.

- [ ] **Step 3: Write `src/lib/defense/assemble.ts`**

```ts
import type { WatcherReport } from "../../types/report";
import type { DefenseReport } from "./types";
import { deriveIncident } from "./incident";
import { alignInvestigation } from "./align";
import { gradeDefense } from "./grade";
import { investigationGhost } from "./ghost";
import { defenseLesson } from "./lesson";

/** Orchestrate an attacker capture (incident) + an analyst run into one defense report. Pure. */
export function assembleDefenseReport(attacker: WatcherReport, run: WatcherReport): DefenseReport {
  const incident = deriveIncident(attacker);
  const result = alignInvestigation(incident, run);
  return {
    mode: "defense",
    session: run.session,
    incident,
    result,
    grade: gradeDefense(result),
    ghost: investigationGhost(result),
    lesson: defenseLesson(result),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/defense/assemble.test.ts` → PASS. `npx tsc -b --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/defense/assemble.ts src/lib/defense/assemble.test.ts
git commit -m "feat(defense): assembleDefenseReport orchestration"
```

---

### Task 6: CLI (`scripts/ingest-defense.tsx`)

**Files:**
- Create: `scripts/ingest-defense.tsx`
- Modify: `package.json` (add `ingest:defense` script)

**Interfaces:**
- Consumes: `assembleDefenseReport`; the existing `reportFromCapture` (`src/lib/ingest/detect`) to turn a raw capture file into a `WatcherReport`, falling back to parsing an already-assembled report JSON.
- Produces: `dist/report-from-defense.json` + `fixtures/session-defense.json`.

- [ ] **Step 1: Write `scripts/ingest-defense.tsx`**

```tsx
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
```

- [ ] **Step 2: Add the npm script**

In `package.json` scripts, after the `ingest:sysmon` line, add:
```json
    "ingest:defense": "vite-node scripts/ingest-defense.tsx",
```

- [ ] **Step 3: Verify end-to-end**

Run (using the built-in demo fixture as the "attacker" and any host capture as the "run"):
```bash
npm run gen:demo
npx vite-node scripts/ingest-defense.tsx --incident fixtures/session-demo-full.json --run fixtures/session-demo-full.json --out dist/report-from-defense.json
```
Expected: prints `✓ defense debrief → ...` with a non-zero artifact count and a grade (grading the demo against itself surfaces everything → high coverage; this is a smoke test of the wiring, not a realistic score). `npx tsc -b --noEmit` clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-defense.tsx package.json
git commit -m "feat(defense): ingest-defense CLI"
```

---

### Task 7: Mode-aware debrief rendering

**Files:**
- Modify: `src/store/report.ts` (accept a `DefenseReport`), the debrief container component, `src/components/Assessment.tsx` (or wherever the rubric renders)
- Create: `src/components/DefenseRubric.tsx`

**Interfaces:**
- Consumes: `DefenseReport` from `../lib/defense/types`.
- Produces: the debrief renders a defense report with the 5-metric rubric, the incident-artifact breakdown, the reused Ghost and one-lesson, and defensive labels.

> This is the one integration task. Read the current debrief container and `src/components/Assessment.tsx`, `src/components/SessionFacts.tsx`, the Ghost view, and the one-lesson component first to match their patterns. The offense report is untouched; this adds a branch.

- [ ] **Step 1: Add a defense fixture loader path to the store**

Read `src/store/report.ts`. Where it loads `fixtures/session-*.json` (dev glob) and derives a report, allow an object with `mode === "defense"` to pass through as a `DefenseReport` held on the store (e.g. a `defenseReport: DefenseReport | null` field set when the active fixture has `mode: "defense"`). Do not run it through the offense pipeline. Keep the offense path unchanged when `mode` is absent.

- [ ] **Step 2: Write `src/components/DefenseRubric.tsx`**

```tsx
import type { DefenseGrade } from "../lib/defense/types";

export function DefenseRubric({ grade }: { grade: DefenseGrade }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="font-display text-4xl" style={{ color: "var(--color-signal)" }}>{grade.letter}</span>
        <span className="mono text-lg text-fg">{grade.score}</span>
        <span className="label text-faint">defensive investigation</span>
      </div>
      <div className="mt-3 space-y-1">
        {grade.metrics.map((m) => (
          <div key={m.name} className="flex items-center justify-between text-sm">
            <span className="text-muted">{m.name}</span>
            <span className="mono text-fg">{m.score} <span className="text-faint">· {Math.round(m.weight * 100)}% · +{m.points}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Branch the debrief on `mode`**

In the debrief container, when the active report is a `DefenseReport`, render: the `SessionFacts` badge (unchanged — the analyst run's session drives it), `<DefenseRubric grade={report.grade} />`, the existing Ghost view fed `report.ghost`, the existing one-lesson component fed `report.lesson`, and an artifact breakdown listing `report.result.hits` (found/missed with labels). Relabel "objectives" → "artifacts" and the coverage copy for defense. Leave the offense branch exactly as-is.

- [ ] **Step 4: Verify in the app**

```bash
npx vite-node scripts/ingest-defense.tsx --incident fixtures/session-demo-full.json --run fixtures/session-demo-full.json
npm run dev
```
Open the `session-defense` fixture from History; confirm it shows the defensive grade + 5-metric rubric, the Ghost, and the one lesson, with the analyst run's source badge. `npx tsc -b --noEmit` clean; `npx vitest run` all green.

- [ ] **Step 5: Commit**

```bash
git add src/store/report.ts src/components/DefenseRubric.tsx src/components/*.tsx
git commit -m "feat(defense): mode-aware debrief rendering"
```

---

### Task 8: Full-suite gate + docs

**Files:**
- Modify: `README.md` (a short "Grade a defensive investigation" subsection)

- [ ] **Step 1: Run the whole suite and typecheck**

```bash
npx vitest run
npx tsc -b --noEmit
```
Expected: all tests pass (offense suite unchanged + the new `src/lib/defense/*` tests), tsc clean.

- [ ] **Step 2: Add a README subsection**

Under the existing ingest/usage docs, add a short "Grade a defensive investigation" note showing `npm run ingest:defense -- --incident <attacker capture> --run <analyst session>` and one line on what it scores (the 5 metrics). Keep the prose em-dash-free (house style).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: defensive investigation grading usage"
```
