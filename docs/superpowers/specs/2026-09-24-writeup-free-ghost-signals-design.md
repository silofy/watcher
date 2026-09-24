# Write-up-free Ghost signals — design

**Status:** approved for planning
**Date:** 2026-09-24
**Author:** silofy (with Claude)

## Problem

The Ghost is The Watcher's most distinctive feature: a deterministic "you vs. the
optimal line" counterfactual. Today it needs an authored intended path — a
`golden_dag` extracted from a write-up. `computeGhost` returns `null` the moment
`golden_dag` is empty (`src/lib/ghost/ghost.ts:17`), so a run without a write-up gets
no Ghost at all. In practice only the two shipped demos carry a golden path, so most
real runs never see the headline feature.

`src/lib/analysis/privesc.ts` already proves this is solvable for one phase: it reads
the enumeration the run itself captured and, when the run's own output proves an
opportunity existed, emits a coaching-only signal (`slow_line`: a confirmed local root
path was observable at step X, but the run rooted later by a slower route). No write-up
involved.

This design generalizes that pattern into the Ghost: a set of **signal detectors** that
each emit a Ghost item **only when the run's captured facts prove the opportunity
existed**, so the Ghost works on every run — with or without a write-up.

## Goals

- The Ghost is non-null and useful on runs with no `golden_dag`.
- Every signal item is backed by the run's own captured evidence — no fabricated
  "optimal line," no claim the run cannot substantiate.
- On runs that *do* have a `golden_dag`, the signals supplement it (they catch things a
  golden path rarely encodes), de-duplicated so no lesson appears twice.
- Coaching only. Like the golden Ghost and like privesc, signals never feed the grade.
- No schema change; the whole existing Ghost UI (card, timeline overlay, headline,
  one-lesson) keeps working unchanged.

## Non-goals

- No synthetic full "golden DAG" and no coverage-% / route-bar for write-up-free runs.
  A synthesized optimal line would assert steps the run never proved were possible on
  that box; we deliberately reject that (it risks unfair claims). Signals are discrete,
  each independently provable.
- No new Ghost verdicts. Signals reuse the existing `skipped` and `late_pivot`.
- No model dependency. Detectors are deterministic; the existing narration layer may
  refine an item's `note` afterward exactly as it does for golden items.

## Design overview

### Basis: signal-based items (not a synthetic path)

Each detector is a pure function `(report: WatcherReport) => GhostItem[]`. It inspects
`report.findings` and `report.episodes` (and, for two detectors, `analyzePrivesc` /
a curated CVE map) and returns zero or more items. An item is emitted **only** when the
run's data proves the opportunity; absence of proof emits nothing (the primary
false-positive guard).

### Coexistence: always run, merged

`computeGhost` changes from "golden or null" to:

1. Compute golden items as today when `golden_dag` is non-empty (unchanged logic).
2. Always compute signal items via `computeSignalGhost(report)`.
3. De-duplicate signal items against golden items (see below).
4. Concatenate; recompute `time_lost_ms` and `human_wins` over the merged set.
5. Return the merged `GhostResult` (never `null` when either source produced items;
   `null` only when both are empty).

Wiring in `src/lib/pipeline/ingest.ts:206` currently passes a partial
`{ golden_dag, episodes, findings }`. Two detectors need more (`metrics`, full episode
output), so this call is widened to pass the assembled report object. `report.ghost` is
still set at `ingest.ts:236` from the return value.

### The four detectors (v1)

Each maps onto an existing `GhostVerdict`, carries a synthetic `objective` slug, and
writes a deterministic `note`.

| Detector | slug | verdict | `unlock_seq` | `actual_seq` | Proof required (else: no item) |
|---|---|---|---|---|---|
| Privesc slow-line | `escalate_via_confirmed_path` | `late_pivot` | `slow_line.available_seq` | `slow_line.rooted_seq` | `analyzePrivesc(report).slow_line != null` |
| Credential not reused | `reuse_found_cred` | `skipped` | cred finding `source_seq` | `null` | a `cred` finding with empty/absent `used_by_seq` **and** a later episode existed where it could have been tried |
| Enumerated, never audited | `audit_smb_shares` | `skipped` | the listing episode `seq` | `null` | an anonymous/null SMB listing succeeded (episode + `service`/`share` finding) **and** no later share-permission-audit command ran |
| Known-vuln service | `investigate_vuln_service` | `skipped` | service/version finding `source_seq` | `null` | a `service`/`version` finding matches a curated CVE-map entry **and** no later search/investigation of it ran |

`lag_ms` is set only for the `late_pivot` slow-line item, computed the same way
`ghost.ts` computes late-pivot lag (elapsed at `actual_seq` minus elapsed at
`unlock_seq`). `skipped` items have `lag_ms = 0`.

Detector detail:

- **Privesc slow-line** — adapts the existing `analyzePrivesc(report)` result. When
  `slow_line` is present, emit one `late_pivot` item using `available_seq` /
  `rooted_seq`; the note names the confirmed vector from `slow_line.path.title`. No new
  privesc logic; this detector only translates an existing result into a `GhostItem`.
- **Credential not reused** — a `cred` finding whose `used_by_seq` is empty or missing.
  Guard: only emit if at least one episode after `source_seq` was a plausible
  authentication surface (an ssh/su/login/service-auth binary), so "found a flag-adjacent
  string on the last command" never fires. One item per unused cred, capped at the most
  recent N (N=2) to avoid noise.
- **Enumerated, never audited** — an anonymous/null listing episode that succeeded
  (detected from the episode's binary + the `service`/`share` findings it produced) with
  no later audit command against those shares. This mirrors the run's own
  already-computed "next step you skipped" coaching signal; where that coaching step
  exists it is the authority for whether the audit was skipped.
- **Known-vuln service** — a `service`/`version` finding matched against a **curated,
  committed** service→CVE map (`src/lib/analysis/service-cves.ts`), in the same spirit as
  privesc's kernel/sudo NVD ranges: public facts, re-expressed, each entry a
  `{ product, versionRange, cve, note }`. Emit only when no later episode searched or
  investigated that service. The map ships small (a handful of high-signal, unambiguous
  entries) precisely to keep false positives near zero; it grows like the privesc
  rulebook.

### De-duplication

A signal item is dropped when it restates a golden objective:

- **Same finding:** a golden objective whose `finding_refs` include the signal's source
  finding id ⇒ drop the signal.
- **Same tactic + adjacent unlock:** a golden objective sharing the signal's tactic with
  an `unlock_seq` within a small window (±2 running episodes) of the signal's
  `unlock_seq` ⇒ drop the signal.

Golden always wins. Example: the Abducted fixture's golden path already contains
`audit_share_permissions`, so the "enumerated, never audited" signal for that same share
is suppressed. With no golden path, nothing is dropped.

### Downstream touch-points

- **`humanizeObjective` (`src/lib/audits.ts:144`)** — add explicit labels for the four
  synthetic slugs (it already sentence-cases unknown slugs, but explicit labels read
  better: e.g. `reuse_found_cred` → "reuse a found credential"). This is the only edit
  needed for `one-lesson.ts` and `headline.ts` to render signal items well; both already
  consume standard `GhostItem` fields.
- **`one-lesson.ts`** — no change. It filters `verdict === "late_pivot"` by `lag_ms`, so
  the privesc slow-line becomes a first-class "one lesson" candidate on write-up-free
  runs automatically.
- **`headline.ts`, `ghost-view.ts`** — no change; `skipped`/`late_pivot` are already in
  `VERDICT_ORDER`, `verdictCounts`, `VERDICT_META`, and `connectorLabel`.
- **Notes** — each signal item's deterministic `note` is written in `signals.ts`. The
  narration layer refines it later exactly as for golden items (`refinedNotes` compares
  by `objective`, so synthetic slugs work unchanged).

### Schema

No type change. `GhostItem` / `Ghost` (`src/types/report.ts:216-241`) already carry
every field. `schema_version` stays `"1.4"`. The `Ghost` doc-comment ("golden objective")
is relaxed to "golden objective or a detected run signal."

## File structure

- **Create** `src/lib/ghost/signals.ts` — `computeSignalGhost(report): GhostItem[]`, the
  four detectors, and their deterministic notes. One clear responsibility: turn proven
  run facts into Ghost items.
- **Create** `src/lib/analysis/service-cves.ts` — the curated service→CVE map + a pure
  `matchServiceCve(product, version)` lookup. Isolated so the map grows without touching
  detector logic.
- **Create** `src/lib/ghost/signals.test.ts`, `src/lib/analysis/service-cves.test.ts`.
- **Modify** `src/lib/ghost/ghost.ts` — remove the `null`-on-empty-golden early return;
  add merge + de-dupe + recompute.
- **Modify** `src/lib/pipeline/ingest.ts:206` — pass the assembled report.
- **Modify** `src/lib/audits.ts` — four labels in `humanizeObjective`.
- **Modify** `src/types/report.ts` — relax the `Ghost` doc-comment only.

## Testing (TDD)

- **Per detector, both directions.** Proof present → item emitted with the exact
  verdict/`unlock_seq`/`actual_seq`; proof absent → **no item** (the false-positive
  guard, the most important assertion). Specifically: a `cred` with a non-empty
  `used_by_seq` emits nothing; a null-session run where shares *were* audited emits
  nothing; a service with no CVE-map match emits nothing; no `slow_line` emits nothing.
- **`service-cves.ts` unit** — in-range version matches its CVE, out-of-range and
  unknown products do not.
- **Merge/de-dup** — golden `audit_share_permissions` present ⇒ overlapping signal
  suppressed; absent ⇒ signal appears. Same-finding and same-tactic+adjacent rules each
  covered.
- **No-golden end-to-end** — the Abducted (or RootMe) fixture with `golden_dag` stripped,
  run through `computeGhost`: today returns `null`; now returns a non-null result whose
  items include the expected signals. Asserts `time_lost_ms`/`human_wins` recomputed over
  the merged set.
- **Regression** — existing `ghost.test.ts` golden-path assertions pass unchanged,
  proving the merge left the write-up path intact.

## Global constraints

- Deterministic; never feeds the letter grade (coaching only), same invariant as the
  golden Ghost and privesc.
- No copied GPL/unlicensed source. CVE-map facts are public (NVD), re-expressed in
  TypeScript, like the existing privesc rulebook.
- No new dependencies.
- `schema_version` stays `"1.4"`; no `GhostItem`/`Ghost` shape change.
