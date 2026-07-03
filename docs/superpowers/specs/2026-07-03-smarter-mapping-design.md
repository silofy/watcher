# Design Spec — Smarter Mapping: Methodology-Coverage, Tunnel-Vision & Recovery Signals

**Date:** 2026-07-03
**Status:** Approved for implementation (sub-project 2 of 3)
**Executor model:** Claude Opus 4.8, one Work Package at a time
**Depends on:** sub-project 1 (platform-agnostic task-spine) — merged to `main`.

---

## 0. How to use this document

Same working rules as sub-project 1 (`docs/superpowers/specs/2026-07-02-platform-agnostic-taskspine-design.md` §0). In brief, on every Work Package:

1. **TDD** — failing test first.
2. **Green gate** — `npm test`, `npm run typecheck`, `npm run build`, and the schema round-trip all pass before a WP is done.
3. **Additive & backward-compatible** — schema/type changes are additive (schema v1.3); v1.0–v1.2 reports still load and render.
4. **Determinism is sacred** — new signals are pure functions of the report; re-running yields identical output. Models never move a number.
5. **The existing grade rubric is FROZEN in this sub-project** — do NOT change `RUBRIC` weights, `computeGrade`, or the semantics of any existing metric. New signals are *surfaced* (metrics fields + coaching insights), never folded into the letter grade here. (Grading them is sub-project 2b, gated on a human weighting decision — see §7.)
6. **Redaction before persistence** — any new text field respects `public_safe`.
7. **No scope creep** — the report visual redesign and longitudinal view are sub-project 3.

---

## 1. Thesis & what this builds on

Sub-project 1 gave Watcher the object model a strong offensive agent maintains: an attributed objective tree, a first-class findings ledger (`enum → finding → action` via `source_seq`/`used_by_seq`), and claimed-vs-proven verification. Sub-project 2 turns that structure into **methodology feedback** — the highest-leverage upskill signal in an AI world, where the scarce skill is *what to enumerate, when to pivot, and not spinning*.

Three new **deterministic** signals, all derived from data that now exists:

1. **Methodology coverage** — did the operator perform the disciplined checks their own findings made relevant? (Found 445/tcp but never enumerated SMB.)
2. **Tunnel-vision / focus discipline** — did they keep hammering one low-yield surface instead of stepping back to enumeration?
3. **Recovery** — after a dead-end or stall, how fast did they pivot to something productive?

All three are **surfaced** as metrics + coaching insights. None reweights the grade (§0.5).

Research grounding (sub-project 1 Appendix A): methodology coverage = PentestGPT's "reason over the whole task tree, pick the highest-yield untried sub-task"; tunnel-vision = the "frontier / don't-tunnel" principle; recovery = D-CIPHER's explicit give-up/pivot states.

---

## 2. Goals / non-goals

### Goals
- **G1.** A deterministic **methodology-coverage** model: a rule set of expected checks per phase, made *applicable* by findings/context, scored `done / applicable`, with per-missed-check coaching that deep-links to the finding that made it relevant.
- **G2.** A deterministic **focus-discipline (anti-tunnel-vision)** signal: detect sustained low-yield persistence on one surface and surface the worst rabbit-hole with a "step back and enumerate" insight.
- **G3.** A deterministic **recovery** signal: measure pivot latency out of stuck/detour clusters; reward fast recovery, flag slow ones.
- **G4.** Surface all three in the existing Phase Audit / coaching (additive insight kinds) and as schema v1.3 metrics fields — no visual redesign.

### Non-goals (deferred)
- Reweighting the grade rubric to include these (sub-project 2b — needs a human weighting call, §7).
- Model-based intent enrichment / expanding the 12-rule MITRE table (a separate follow-up; the deterministic table stays authoritative for numbers).
- Any report layout/visual change, live-HUD rework, or longitudinal view (sub-project 3).
- Hypothesis-driven-work detection (the "prior bug → variant" reward) — noted as a future signal; out of scope here to keep this shippable.

---

## 3. Architecture

```
report (v1.2: episodes + findings + objective tree + phases + metrics)
        │
        ├─ methodology.ts   → MethodologyResult { coverage_pct, checks[] }   (pure)
        ├─ focus.ts         → FocusResult { discipline_pct, rabbit_holes[] } (pure)
        ├─ recovery.ts      → RecoveryResult { recoveries[], median_ms }     (pure)
        │
        ▼
  metrics (v1.3 additive fields) + audits.ts (new insight kinds) + coaching
        ▼
  Phase Audit / coaching UI (existing components; additive rows only)
```

New pure modules live in `src/lib/analysis/` (new directory): `methodology.ts`, `focus.ts`, `recovery.ts` (+ tests). They consume a `WatcherReport` and return plain data. `metrics.ts` calls them and adds their headline numbers to `ComputedMetrics`/`Metrics`. `audits.ts` maps their per-item output into `AuditItem`s (the existing insight/manual structures) so they render in the existing Phase Audit with zero new components.

**Invariant:** these modules never mutate the report and never feed `computeGrade`. `computeMetrics` gains fields but its existing fields are byte-identical.

---

## 4. Data model — schema v1.3 (additive)

Add to `metrics` in `schema/watcher-report.schema.json` + `src/types/report.ts` (all optional):

```jsonc
"methodology_coverage_pct": { "type": "number", "minimum": 0, "maximum": 100,
  "description": "Share of context-applicable disciplined checks the run performed (schema v1.3)." },
"focus_discipline_pct": { "type": "number", "minimum": 0, "maximum": 100,
  "description": "100 = no rabbit-holes; lower = sustained low-yield persistence on one surface (schema v1.3)." },
"recovery_median_ms": { "type": ["integer","null"], "minimum": 0,
  "description": "Median pivot latency out of stuck/detour clusters; null if none occurred (schema v1.3)." }
```

Optionally add a top-level `analysis` object carrying the itemized detail (checks, rabbit_holes, recoveries) for the UI — but PREFER surfacing detail through the existing `coaching.next_steps` / phase-audit `AuditItem`s to avoid schema bloat. Only add `analysis` if the UI genuinely needs structured per-item data beyond what an `AuditItem` carries. Decide in WP-4; default to no new top-level field.

Bump `schema_version` enum to include `"1.3"` and the TS union to `"1.0" | "1.1" | "1.2" | "1.3"`. `assembleReport` stamps `"1.3"`.

---

## 5. The methodology rule set (the core of G1)

A **check** is `{ id, phase (tactic), label, applies(ctx): boolean, done(ctx): boolean, hint }`. `ctx` is a derived view of the report: `{ findings, episodes, techniquesByTactic, binariesUsed, portsOpen, hasWeb, hasSmb, ... }`.

- **applies** gates on context so we never penalize a check that wasn't relevant (only expect SMB enum if a `445`/`139` port finding exists; only expect web-content enum if an http(s) port/url finding exists).
- **done** checks whether the run performed it (a technique touched, a binary used, or a finding of the right kind produced).
- **coverage_pct** = `done ∧ applies` / `applies`. Checks that don't apply are excluded from the denominator (like the grade's independence re-normalization).

Ship a **starter rule set** (extend via tests). At minimum:

| id | phase | applies when | done when | hint |
|---|---|---|---|---|
| `port_scan` | TA0007 | always | an nmap/rustscan/masscan technique or port finding exists | "Start with a full service scan (`nmap -sV -sC`)." |
| `service_version_enum` | TA0007 | ≥1 port finding | a `version` finding exists | "Enumerate service versions (`-sV`) to map exploit surface." |
| `web_content_enum` | TA0007 | an http(s) port/url finding | a gobuster/ffuf/feroxbuster technique or ≥2 `url`/`path` findings | "Brute web content (`ffuf`/`gobuster`) — you found a web service." |
| `smb_enum` | TA0007 | a 139/445 port finding | an smbclient/enum4linux/crackmapexec binary used | "Port 445 is open — enumerate SMB (`enum4linux-ng`, `smbclient -L`)." |
| `priv_enum` | TA0004 | foothold reached (a TA0002 objective reached OR on-target episodes exist) | linpeas/pspy/`sudo -l`/getcap used | "After foothold, enumerate privesc (`sudo -l`, `linpeas`, `pspy`)." |

Each unmet applicable check becomes a coaching insight (category derived from tactic) that deep-links to the finding/episode that made it applicable (`evidence_seq`). This is the pedagogical payload: *"you found X and didn't do Y."*

---

## 6. Work packages

Each WP: Goal · Files · Interface · Steps · Acceptance · Tests · Depends on. Same green-gate discipline as sub-project 1.

### WP-1 — Schema v1.3 additive metrics fields
- **Goal:** Land the three optional metrics fields (§4) + version bump. No behavior change.
- **Files:** `schema/watcher-report.schema.json`, `src/types/report.ts`; new fixture is NOT required (existing fixtures stay valid; a later WP adds values).
- **Acceptance:** all fixtures validate; `tsc` green; no runtime reads the new fields yet.
- **Tests:** schema round-trip; a v1.2 report (no new fields) still validates.
- **Depends on:** —

### WP-2 — Methodology coverage engine
- **Goal:** `src/lib/analysis/methodology.ts` — the rule set (§5) + `computeMethodology(report): MethodologyResult`.
- **Interface:**
  ```ts
  export interface MethodologyCheck { id: string; tactic: string; label: string; applicable: boolean; done: boolean; hint: string; evidence_seq: number | null; }
  export interface MethodologyResult { coverage_pct: number; checks: MethodologyCheck[]; }
  export function computeMethodology(report: WatcherReport): MethodologyResult;
  ```
- **Algorithm:** build `ctx` from findings/episodes; evaluate each rule's `applies`/`done`; `coverage_pct = doneApplicable / applicable * 100` (0 when no check applies); `evidence_seq` = the finding/episode `source_seq` that triggered applicability.
- **Acceptance:** on the THM/HTB fixtures, produces sensible coverage; a synthetic report with a 445 finding and no SMB tooling yields an unmet `smb_enum` check with the right `evidence_seq`; deterministic (run twice → deepEqual).
- **Tests:** one per rule (applies/done truth table), a re-normalization case (no applicable checks → 0, not NaN), determinism.
- **Depends on:** WP-1.

### WP-3 — Focus discipline (anti-tunnel-vision)
- **Goal:** `src/lib/analysis/focus.ts` — `computeFocus(report): FocusResult`.
- **Interface:**
  ```ts
  export interface RabbitHole { start_seq: number; end_seq: number; binary: string; wasted_ms: number; }
  export interface FocusResult { discipline_pct: number; rabbit_holes: RabbitHole[]; }
  export function computeFocus(report: WatcherReport): FocusResult;
  ```
- **Algorithm:** scan running episodes for maximal runs of same-binary (or same-tactic) episodes that are low-yield (`alignment === "detour"` or `loop_of_seq != null` or LOW_YIELD digest) with no intervening objective-advancing/enumeration episode. A run of length ≥ 3 (tune via tests) is a `rabbit_hole`; `wasted_ms` = sum of its durations+gaps. `discipline_pct = clamp(100 - Σ rabbit_hole_wasted_ms / t_active_ms * 100)`. Reuse the existing `LOW_YIELD` regex (export it from `align.ts` if needed) — do not duplicate.
- **Acceptance:** a run with 4 consecutive failed sqlmap attempts is one rabbit hole; a run that pivots after 1 failure is none; deterministic.
- **Tests:** rabbit-hole detection threshold, pivot-resets-the-run, discipline math, determinism.
- **Depends on:** WP-1.

### WP-4 — Recovery signal
- **Goal:** `src/lib/analysis/recovery.ts` — `computeRecovery(report): RecoveryResult`.
- **Interface:**
  ```ts
  export interface Recovery { stuck_seq: number; recovered_seq: number; latency_ms: number; }
  export interface RecoveryResult { recoveries: Recovery[]; median_ms: number | null; }
  export function computeRecovery(report: WatcherReport): RecoveryResult;
  ```
- **Algorithm:** identify stuck/detour clusters (contiguous detour/loop/stuck episodes); a recovery is the transition from a cluster's end to the next episode that advances an objective (`alignment === "match"`/`"alternative"` that satisfies a golden objective) or produces a high-yield finding; `latency_ms` = time from cluster start to that episode; `median_ms` = median over recoveries (null if none).
- **Acceptance:** a stall-then-pivot yields one recovery with correct latency; a run with no stalls yields `[]`/null; deterministic.
- **Tests:** cluster→recovery mapping, no-stall case, median math, determinism.
- **Depends on:** WP-1.

### WP-5 — Wire signals into metrics (headline numbers only)
- **Goal:** `computeMetrics` calls the three engines and adds `methodology_coverage_pct`, `focus_discipline_pct`, `recovery_median_ms` to `ComputedMetrics`; `ingest.ts::assembleReport` writes them to `metrics`; stamp schema `"1.3"`.
- **Critical:** existing metrics fields byte-identical; `computeGrade` untouched (assert in a test that grade is unchanged for a fixture before/after).
- **Acceptance:** assembled reports carry the three fields; existing fixtures' grades and existing metrics unchanged.
- **Tests:** metrics wiring; a grade-stability test (same input → same `computeGrade` output as before this WP).
- **Depends on:** WP-2, WP-3, WP-4.

### WP-6 — Surface as coaching insights (Phase Audit)
- **Goal:** `audits.ts` emits new `AuditItem`s from the three engines: unmet applicable methodology checks (with `evidence_seq` deep-link + `hint`), the worst rabbit hole ("step back and enumerate"), a slow-recovery note. Rendered by the existing Phase Audit (no new components).
- **Placement:** methodology misses → the matching phase's `insights` (or `manual` when no evidence). Rabbit hole / slow recovery → the owning phase or `general`.
- **Acceptance:** the "found 445, didn't enumerate SMB" insight appears on a fixture engineered for it and deep-links to the finding's seq; no existing insight regresses; coaching text is redaction-safe.
- **Tests:** audit-item emission per signal; deep-link seq correctness; existing `audits.test.ts` still green.
- **Depends on:** WP-5.

### WP-7 — Docs + honest limits
- **Goal:** README/CAPTURE note the new signals; the spec's §7 deferral (grade does not yet include them) is stated in-product where the grade is explained (a one-line note near the grade rationale, not a redesign).
- **Acceptance:** docs accurate; no overclaim that methodology feeds the grade.
- **Depends on:** WP-6.

---

## 7. Deferred: folding signals into the grade (sub-project 2b)

Methodology coverage is arguably the most pedagogically important signal, and a future iteration may want it *in* the letter grade. That is a **product/weighting decision** (it retroactively changes every grade and changes what the tool rewards) and is explicitly **out of scope here**. When the user wants it: add a `methodology` rubric key, decide its weight, re-normalize the others, and version the grade. This spec deliberately ships the signal *visible but ungraded* so the data exists to calibrate a weight later.

---

## 8. Dependency graph

```
WP-1 ─┬─▶ WP-2 ─┐
      ├─▶ WP-3 ─┼─▶ WP-5 ─▶ WP-6 ─▶ WP-7
      └─▶ WP-4 ─┘
```
Linear order for one executor: WP-1 → WP-2 → WP-3 → WP-4 → WP-5 → WP-6 → WP-7. (2/3/4 are independent after WP-1.)

## 9. Risks & mitigations
- **Grade drift.** *Mitigation:* WP-5 grade-stability test; rubric frozen.
- **Noisy methodology false-positives** (penalizing a check that wasn't truly relevant). *Mitigation:* `applies` gates strictly on findings/context; conservative starter rule set; each rule has a truth-table test.
- **Rabbit-hole threshold too sensitive.** *Mitigation:* threshold (≥3) is test-pinned and tunable; only *sustained* low-yield runs count.
- **Schema bloat.** *Mitigation:* detail rides existing `AuditItem`/coaching, not a new top-level object (default no `analysis` field).
