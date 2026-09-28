# Blue-team investigation grading — design

**Status:** approved for planning
**Date:** 2026-09-28
**Author:** silofy (with Claude)

## Problem

The Watcher grades offensive runs: it captures a session, aligns it to a golden
methodology, and hands back a grade, a Ghost ("you vs. the optimal line"), and one
lesson. The measurement engine is domain-agnostic, but everything shipped so far
grades the *attacker*. There is no way to grade the **defender** — the DFIR analyst
working an incident.

This feature adds **defensive investigation grading**: score a blue-teamer's
investigation the way the tool scores an offensive run — did they find the malicious
activity, fully, in the right order, quickly, without chasing dead ends — and hand
back the same shape of debrief (grade, Ghost analog, one lesson).

## Goals

- Grade an analyst's investigation session against an incident, producing the same
  artifacts the offense side produces: a weighted grade + letter, a per-artifact
  breakdown, a "you vs. the optimal investigation line" Ghost, and one highest-value
  lesson (the malicious step they missed).
- Require **no hand-authoring**: the incident answer key is auto-derived from an
  attacker Sysmon/EDR capture the tool can already ingest.
- Reuse the existing capture adapters for the analyst's run (PTY for terminal DFIR,
  Claude Code for AI-assisted investigation) — an analyst session is just another
  `WatcherReport`.
- Deterministic and redaction-safe, like the rest of the tool: a model may sharpen
  prose, never facts.

## Non-goals (v1)

- No authored incident library or write-up-derived incidents (auto-derive only; the
  authored path is a follow-up, mirroring the offense side's authored golden).
- No alert-triage grading (classify true/false positive, escalation) — a different
  framing, deferred.
- No live capture of the analyst; v1 grades a completed session (imported file / CLI).
- No real containment verification (did they actually isolate the host); v1 credits
  containment only when the analyst's session *states or acts on* it as an artifact.
- No new capture adapter — the analyst run uses the existing PTY / Claude Code paths.

## Framing (decided)

- **What we grade:** the ANALYST's own actions during an incident investigation.
- **Scenario (the answer key):** auto-derived from an attacker Sysmon/EDR capture.
  Everything in an attacker capture *is* the malicious activity, so its episodes and
  findings become the artifacts the analyst should surface.
- **Run:** the analyst's investigation session, captured with an existing adapter.

## Design overview

### Data flow

```
attacker capture (Sysmon/EDR/PTY)  ──deriveIncident──▶  Incident { artifacts[] }   (the answer key / scenario)
analyst session (PTY / Claude Code) ──existing ingest─▶  WatcherReport             (the run)
                                                      │
                                       alignInvestigation(incident, run)
                                                      │
                                        InvestigationResult { artifacts found/missed, order, dwell, noise }
                                                      │
                                          gradeDefense(result) ──▶ DefenseReport
                                                      │
                            grade + letter · Ghost analog · one lesson · per-artifact breakdown
```

Both inputs are ordinary `WatcherReport`s produced by the existing pipeline; the new
work sits on top of them.

### Module layout (`src/lib/defense/`)

- **`incident.ts`** — `deriveIncident(attacker: WatcherReport): Incident`. Turns an
  attacker capture into the answer key. Each malicious step and finding becomes an
  `Artifact`; entities and indicators are pulled from the episode `cmd`,
  `output_digest`, `binary`, `technique`, and the report `findings`.
- **`align.ts`** — `alignInvestigation(incident: Incident, run: WatcherReport):
  InvestigationResult`. The one new matching engine: decide which artifacts the
  analyst surfaced, when, and by which step; classify each analyst episode as
  advancing or noise.
- **`grade.ts`** — `gradeDefense(result: InvestigationResult): DefenseGrade`. The
  five-metric defensive rubric → weighted 0–100 + letter.
- **`ghost.ts`** — `investigationGhost(incident, result): GhostResult`-shaped output
  ("you vs. the optimal investigation line"), so the existing Ghost view renders it.
- **`lesson.ts`** — `defenseLesson(incident, result)`: the highest-value missed
  artifact, deep-linked, in the existing one-lesson shape.
- **`assemble.ts`** — `assembleDefenseReport(attacker, run): DefenseReport`.
  Orchestrates derive → align → grade → ghost → lesson into one object. Pure, no I/O.

### Data model

```ts
type UkcPhase =
  | "reconnaissance" | "initial-access" | "execution" | "persistence"
  | "privilege-escalation" | "defense-evasion" | "credential-access"
  | "discovery" | "lateral-movement" | "collection" | "exfiltration" | "impact";

interface Artifact {
  id: string;                 // stable, e.g. "art:seq7" or "art:cve-2026-4480"
  label: string;              // human summary ("Samba print-job injection (CVE-2026-4480)")
  phase: UkcPhase;            // kill-chain phase, from the source episode's UKC tag
  technique: string;          // ATT&CK technique id
  indicators: string[];       // redaction-safe strings that prove discovery
                              //   (malicious command tokens, process/host/file, CVE, flag)
  entities: string[];         // affected entities for scoping (hosts, accounts)
  weight: number;             // value of finding it (severity/phase-derived)
  depends_on: string[];       // artifact ids that are kill-chain prerequisites
  source_seq: number;         // the attacker episode this came from
}

interface Incident {
  artifacts: Artifact[];
  entities: string[];         // the full affected-entity set (for scoping)
  target_scope: string;      // from the attacker capture
}

interface ArtifactHit {
  artifact_id: string;
  found: boolean;
  found_by_seq: number | null;   // analyst episode that surfaced it (first)
  found_at_ms: number | null;    // analyst-run-relative time of first surfacing
  matched_indicator: string | null;
}

interface InvestigationResult {
  incident: Incident;
  hits: ArtifactHit[];
  advancing_seqs: number[];       // analyst episodes that surfaced a new artifact
  noise_seqs: number[];           // analyst episodes that advanced nothing
}
```

### The match (how an artifact is "found")

An artifact is **found** when any analyst episode's `cmd` OR its (already-redacted)
`output_digest` contains one of the artifact's `indicators`, matched at the token
level (mirrors `findings.ts` extraction; equality on whole tokens so short indicators
don't false-match inside longer words). The **first** such episode is the artifact's
`found_by_seq` / `found_at_ms`.

- Indicators are chosen to be discriminating: the malicious command's distinctive
  tokens (e.g. `override.conf`, `|bash`, `rootbash`), process/file/host names, the
  CVE id, the flag sentinel. Generic tokens (`cat`, `ls`, `id`) are excluded so
  merely running a common command doesn't count as finding an artifact.
- Redaction-safe: indicators are drawn from already-redacted attacker output; the
  matcher never un-redacts, and never needs a raw secret (a masked credential's
  sentinel can itself be an indicator).
- An analyst episode that surfaces ≥1 new artifact is **advancing**; one that
  surfaces none is **noise** (used by the Discipline metric). Long idle/think gaps
  are excluded, as in the offense pipeline.

### Defensive rubric (5 metrics → weighted grade)

Same 0–100 + letter shape and rendering as the offense grade. Weights are a starting
point, tunable in implementation:

| Metric | What it measures | Weight |
|---|---|---|
| **Coverage** | weighted % of incident artifacts surfaced | 0.34 |
| **Reconstruction** | artifacts found respecting kill-chain `depends_on` order | 0.20 |
| **Time-to-detect** | how early the key (high-weight) artifacts were surfaced (dwell) | 0.16 |
| **Scoping** | fraction of affected entities the analyst identified | 0.16 |
| **Discipline** | advancing steps ÷ total scored steps (signal-to-noise) | 0.14 |

- **Coverage** is artifact-weight-weighted, so missing the initial-access or root
  step costs more than missing a minor discovery step.
- **Reconstruction** credits finding an artifact only after (or without needing) its
  `depends_on`; finding "root cause" only after stumbling on late-stage effects
  scores lower. This is the defensive analog of UKC progression.
- **Time-to-detect** normalizes each key artifact's first-surfaced time against the
  run length; faster is better. It is coaching-facing, never punitive beyond its
  weight.

### Payoff (reused shapes)

- **One lesson** — the highest-`weight` **missed** artifact: "You never surfaced the
  writable systemd drop-in (root cause). Pivot from the SetUID root shell back to its
  origin." Deep-linked to the attacker `source_seq` so the analyst can see what they
  missed. Uses the existing one-lesson component shape.
- **Ghost analog** — `investigationGhost` emits the existing `GhostResult` shape so
  the Ghost view renders unchanged: per artifact, `ahead` / `on_time` / `late` /
  `missed`, "you vs. the optimal investigation line" by discovery order.

### Surface (v1)

- **CLI:** `vite-node scripts/ingest-defense.tsx --incident <attacker capture>
  --run <analyst session> [--out <path>]`. Both inputs may be any format the existing
  adapters accept (a Watcher report JSON, or a raw capture the adapters detect); the
  script ingests each, derives the incident, grades, and writes a `DefenseReport`
  JSON, plus a fixture the dev app can open. `npm run ingest:defense`.
- **In-app:** the History "Import session" flow learns a **defense pairing** — attach
  an incident capture and an analyst run — producing a defense debrief. Reuses the
  existing import detection; when two files are provided (or a file is tagged as the
  incident), route to `assembleDefenseReport`.
- The analyst run keeps its own source badge (Claude Code / terminal), so an
  AI-assisted investigation is visually distinct from a human one.

### Rendering

`DefenseReport` carries the same top-level fields the debrief already reads (grade,
letter, one-lesson, ghost, a per-item breakdown), so the existing Debrief view
renders it with defensive **labels** (a small mode flag switches "objectives" →
"artifacts", "coverage" copy, etc.). No new view; a mode-aware relabel of the
existing one. The 7-metric offense rubric panel is replaced by the 5-metric defensive
rubric when the report is a defense report.

## Testing (TDD)

- **`incident.ts`** — the Abducted attacker fixture yields artifacts for its key
  malicious steps (print-injection/CVE-2026-4480, the writable systemd drop-in, the
  SetUID root shell), each with discriminating indicators, a UKC phase, and
  `depends_on` reflecting the chain; generic-command episodes do not become
  standalone artifacts.
- **`align.ts`** — a synthetic analyst run that greps the injection and the systemd
  override marks those artifacts found (correct `found_by_seq`), leaves an
  un-surfaced artifact missed, and classifies a dead-end analyst command as noise.
  Indicator matching is token-level (no false-match inside longer words) and never
  matches on a generic token.
- **`grade.ts`** — a run that finds all artifacts in order scores high on all five
  metrics; one that finds half, out of order, with noise, scores lower on Coverage,
  Reconstruction, and Discipline specifically. Deterministic.
- **`ghost.ts` / `lesson.ts`** — the Ghost output validates against the existing
  `GhostResult` shape; the lesson names the highest-weight missed artifact.
- **`assemble.ts` / `ingest-defense.tsx`** — smoke: attacker + analyst fixtures →
  a `DefenseReport` that passes schema/shape checks and renders in the Debrief.

## Global constraints

- Deterministic core; a model only sharpens prose, never facts or the grade.
- Redaction-safe: indicators come from already-redacted attacker output; no
  un-redaction anywhere.
- No new runtime dependencies. TypeScript strict; Vitest.
- Reuses the existing capture adapters, report pipeline, Ghost/lesson/grade
  rendering, and source badges. New code is confined to `src/lib/defense/` plus one
  ingest script and a mode-aware relabel in the debrief view.
- The offense path is untouched: defense grading is additive; no change to the
  offense rubric, golden alignment, or existing reports.
