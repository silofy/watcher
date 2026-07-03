# Design Spec — The Ghost: Counterfactual "You vs. the Optimal Agent"

**Date:** 2026-07-03
**Status:** Approved for implementation (sub-project 4)
**Executor model:** Claude Opus 4.8, one Work Package at a time
**Depends on:** sub-projects 1–3 (merged to `main`).

---

## 0. Working rules

Same as prior sub-projects: TDD; green gate (`npm test` + `typecheck` + `build` + schema round-trip); additive/backward-compatible (schema v1.4, all optional); **determinism is sacred**; redaction before persistence; no scope creep. Two Ghost-specific rules:

- **The Ghost's TRAJECTORY and DELTAS are deterministic** — computed purely from the objective tree + findings timeline + alignment. A model may only *narrate* the ghost's reasoning ("it would pivot to SMB here because you'd already found 445"), never change a step, a time, or a verdict. Same seam as today's coaching.
- **The Ghost never feeds the grade.** It's counterfactual coaching. (If a "vs-agent" score is ever wanted, that's a separate, gated decision.)

---

## 1. Thesis

The project's whole premise is compounding human judgment in an AI world. Every other surface *asserts* that matters; The Ghost *measures* it — and, crucially, surfaces where the human still wins. It answers the exact anxiety of practicing by hand next to capable AI: *where was I slower than the optimal line, where did I rabbit-hole, and where did my judgment actually beat the machine?*

**The buildable insight:** we do NOT need a live autonomous pentest agent. The **golden objective tree** (the intended/optimal path, from a write-up or a guided platform) plus the **findings ledger** (what you'd surfaced, and *when*, via `source_seq`/`used_by_seq` timing) plus **alignment** (match/detour/loop) already define an *optimal-from-your-state* trajectory. The Ghost is the deterministic diff between that optimal line and your actual line. The model is optional narration, exactly like the rest of the app.

---

## 2. Goals / non-goals

### Goals
- **G1.** A deterministic **Ghost trajectory**: for each golden objective, the *earliest moment you had enough findings to attempt it* (its "unlock time"), giving an optimal-order, optimal-timing path derived from YOUR surfaced state.
- **G2.** A deterministic **decision diff** classifying each objective's outcome vs. the ghost:
  - **on_time** — you attempted it near its unlock,
  - **late_pivot** — it was unlocked (findings present) well before you acted (you were rabbit-holing/enumerating elsewhere),
  - **skipped** — unlocked but never done (the ghost would have),
  - **ahead** — you did it *before* the ghost expected (you saw it without the prerequisite finding — a judgment win),
  - **off_path_win** — you reached an objective/flag not on the golden path, or via a faster alternative method (a judgment win the ghost's fixed line wouldn't have).
- **G3.** Aggregate metrics (schema v1.4, additive, **ungraded**): `ghost_time_lost_ms` (Σ late-pivot lag + skipped-objective cost), `human_wins` (count of ahead/off_path_win), and a compact `ghost` block with the per-objective diff.
- **G4.** A **Ghost overlay** in the existing attack-timeline / kill-chain view (a second "ghost" trajectory line + per-objective markers) and a "You vs. the Ghost" summary card — additive, reusing existing timeline components; **human-win moments are celebrated, not just gaps shown**.
- **G5.** Optional **model narration** per diff item (local Ollama or the existing opt-in redacted cloud path), strictly additive text; with no model, the deterministic labels + hints stand alone.

### Non-goals (deferred)
- A live autonomous agent actually re-attacking the box (future; the deterministic ghost is the shippable, honest core).
- Any "vs-agent" contribution to the letter grade.
- The debrief visual redesign (separate, user-directed).
- Real-time ghost during live capture (v1 is post-run; live is a follow-up).

---

## 3. Architecture

```
report (v1.3: objective tree + findings[source_seq,used_by_seq] + episodes[alignment,timing])
        │
        ├─ ghost.ts :: computeGhost(report) → GhostResult   (PURE, deterministic)
        │     • unlockTime(objective)  = earliest episode seq/time where its prerequisite findings exist
        │     • actualTime(objective)  = user_satisfied_by_seq's time (or null)
        │     • classify each → GhostDiffItem  (on_time | late_pivot | skipped | ahead | off_path_win)
        │     • aggregate → ghost_time_lost_ms, human_wins
        │
        ├─ (optional) ghost narration via LlmProvider — sharpens text only, never the diff
        ▼
  metrics (v1.4 additive: ghost block) + report.ghost
        ▼
  UI: GhostOverlay on AttackTimeline (2nd trajectory + markers) + "You vs. the Ghost" card
      (human wins highlighted; deep-links to the deciding episode/finding)
```

New pure module `src/lib/ghost/ghost.ts` (+ tests). Consumes a `WatcherReport`, returns plain data. `ingest.ts` calls it and writes `report.ghost`. UI is additive over the existing timeline.

**Invariant:** `computeGhost` never mutates the report, never calls a model, never feeds `computeGrade`. Narration is a separate optional pass (like `writeup/extract.ts`).

---

## 4. Data model — schema v1.4 (additive)

New optional top-level `ghost` + metrics fields. TS mirror in `src/types/report.ts`; bump `schema_version` enum + union to include `"1.4"`.

```jsonc
"ghost": {
  "type": "object",
  "description": "Counterfactual 'optimal-from-your-state' analysis (schema v1.4). Deterministic; never feeds the grade.",
  "additionalProperties": false,
  "properties": {
    "time_lost_ms": { "type": "integer", "minimum": 0, "description": "Total lag: Σ (late-pivot delay) + skipped-objective cost." },
    "human_wins": { "type": "integer", "minimum": 0, "description": "Count of ahead / off-path moments where the human beat the optimal line." },
    "items": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["objective", "verdict"],
        "additionalProperties": false,
        "properties": {
          "objective":   { "type": "string" },
          "verdict":     { "type": "string", "enum": ["on_time", "late_pivot", "skipped", "ahead", "off_path_win"] },
          "unlock_seq":  { "type": ["integer", "null"], "description": "Earliest episode seq where prerequisite findings existed." },
          "actual_seq":  { "type": ["integer", "null"], "description": "Episode seq that satisfied it, or null." },
          "lag_ms":      { "type": "integer", "minimum": 0, "description": "Time between unlock and your action (0 for on_time/ahead)." },
          "note":        { "type": "string", "description": "Optional model narration; deterministic hint when absent." }
        }
      }
    }
  }
}
```
Add to `metrics`: `ghost_time_lost_ms` (`["integer","null"]`) and `ghost_human_wins` (`["integer","null"]`) — mirror the `ghost` headline for the summary card and future trend use. Optional.

---

## 5. The deterministic algorithm (core of G1/G2)

For a report WITH a golden tree (no tree → `ghost` absent; the Ghost needs an intended path):

1. **Finding timeline.** For each finding, its `source_seq` (when surfaced). Build `firstFindingSeqByKindValue`.
2. **unlock_seq(objective).** The earliest episode seq at which the objective is "attemptable": the max over its `depends_on` unlock_seqs (recursively) and the seq at which the *enabling finding* for this objective exists. Heuristic mapping objective→enabling-finding-kind reuses the methodology `ctx` idea (e.g. `smb_enum`/exploit objectives unlock when the relevant port/url/cred finding appears; a foothold unlocks when creds/exploit-surface exist). Where no specific finding gates it, unlock_seq = max(depends_on unlocks) (pure ordering).
3. **actual_seq(objective)** = `user_satisfied_by_seq` (from alignment).
4. **Classify:**
   - `actual_seq == null && unlock_seq != null` → **skipped** (ghost would have; you didn't).
   - `actual_seq != null && unlock_seq != null && actual_seq` far after unlock (gap beyond a think-time threshold, e.g. > p75 gap or > N intervening running episodes) → **late_pivot**, `lag_ms` = time(actual) − time(unlock).
   - `actual_seq != null && (unlock_seq == null || actual_seq <= unlock_seq)` → **ahead** (you did it before its finding-prerequisite surfaced — judgment/prior-knowledge win).
   - otherwise `actual_seq != null` near unlock → **on_time**.
   - A satisfied objective whose satisfier episode is an `alternative` alignment, or a proven flag not on the golden path → **off_path_win**.
5. **Aggregate:** `time_lost_ms` = Σ lag_ms(late_pivot) + Σ skipped-cost (a fixed per-skipped penalty derived from median objective time, deterministic). `human_wins` = count(ahead) + count(off_path_win).

All pure, deterministic, tested with truth-table fixtures. `note` starts as a deterministic templated hint ("Unlocked at step {unlock} by {finding}; you acted at {actual} — {lag} later"); model narration overrides `note` only when a provider is present.

---

## 6. Work packages

- **WP-1 — Schema v1.4** (`ghost` block + 2 metrics fields; version bump). Additive; fixtures still validate. *Depends: —*
- **WP-2 — `computeGhost` engine** (`src/lib/ghost/ghost.ts` + tests): finding timeline, `unlock_seq`, classification truth table, aggregation. Pure/deterministic; determinism + per-verdict tests. *Depends: WP-1*
- **WP-3 — Wire into report** (`ingest.ts` writes `report.ghost` + the 2 metrics fields; stamp v1.4). Grade-stability test (ghost must not move the grade). *Depends: WP-2*
- **WP-4 — Ghost overlay + summary card**: read `AttackTimeline.tsx` / kill-chain components; add a 2nd "ghost" trajectory line + per-objective verdict markers, and a "You vs. the Ghost" card (time lost, human wins **celebrated**, per-item list deep-linking to `unlock_seq`/`actual_seq`). Additive; no debrief re-layout. Pure geometry helpers unit-tested. *Depends: WP-3*
- **WP-5 — Optional model narration** (`src/lib/ghost/narrate.ts`): given a provider, produce per-item `note`; NullProvider → deterministic hints stand. Redaction: narration input is objective ids + finding *kinds*/timings, never raw output_digest/creds. *Depends: WP-2*
- **WP-6 — Docs**: README "The Ghost" section; state it's deterministic counterfactual coaching, model-optional, never graded, post-run (live is future). *Depends: WP-4, WP-5*

### Dependency graph
```
WP-1 ─▶ WP-2 ─▶ WP-3 ─▶ WP-4 ─▶ WP-6
                 └▶ WP-5 ─────────┘
```

## 7. Risks & mitigations
- **Determinism (model in the loop).** *Mitigation:* trajectory/diff/metrics are pure and model-free; narration is a separate additive pass that only sets `note`; a determinism test asserts `computeGhost` is model-independent.
- **Grade drift.** *Mitigation:* WP-3 grade-stability test; ghost never referenced by `grade.ts`.
- **No golden tree → no ghost.** *Mitigation:* `computeGhost` returns null/absent when `golden_dag` is empty; UI hides the overlay; documented.
- **unlock heuristic false "late_pivot".** *Mitigation:* conservative threshold (only flag lag beyond a think-time baseline), per-verdict truth-table tests, and `note` explains the basis so a learner can judge it.
- **Demoralizing framing.** *Mitigation:* human-win verdicts (`ahead`/`off_path_win`) are first-class and highlighted; the card leads with wins, then gaps. This is a product requirement, not decoration.
- **Redaction in narration.** *Mitigation:* narration sees only ids/kinds/timings; WP-5 asserts no raw secret/output reaches the provider.
