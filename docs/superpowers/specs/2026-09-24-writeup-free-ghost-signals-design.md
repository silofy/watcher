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
`{ golden_dag, episodes, findings }`. All three detectors — including `analyzePrivesc`,
which reads only `report.episodes` and `report.findings` — are satisfied by that partial,
so **no ingest change is needed**; `computeGhost` keeps its signature and `report.ghost`
is still set at `ingest.ts:236` from the return value.

### Data-model facts (discovered during planning)

Two facts about the pipeline shaped the detector rules below:

- **`used_by_seq` is unreliable under redaction.** `extractFindings`
  (`src/lib/pipeline/findings.ts`) links `used_by_seq` by matching a finding's *value* in
  later command text. Under the default `full` redaction profile a credential's value is
  masked, so a credential that *was* used still shows `used_by_seq: []`. A detector that
  keys on "empty `used_by_seq`" would false-positive on every redacted run. The cred
  detector therefore uses episode-level proof only (below), never `used_by_seq`.
- **No `service`/`version` findings exist.** `extractFindings` produces only `port`,
  `url`, `hash`, `cred`, `vuln`, `flag`. Service+version data lives only as free text in
  each episode's `output_digest`. This is why the known-vuln-service detector is deferred
  (see non-goals) — it needs digest parsing + a curated CVE map, which is its own spec.

### The three detectors (v1)

Each maps onto an existing `GhostVerdict`, carries a synthetic `objective` slug, and
writes a deterministic `note`.

| Detector | slug | verdict | `unlock_seq` | `actual_seq` | Proof required (else: no item) |
|---|---|---|---|---|---|
| Privesc slow-line | `escalate_via_confirmed_path` | `late_pivot` | `slow_line.available_seq` | `slow_line.rooted_seq` | `analyzePrivesc(report).slow_line != null` |
| Credential found, never used | `reuse_found_cred` | `skipped` | cred finding `source_seq` | `null` | a `cred` finding exists **and no** later episode (seq > source_seq) runs an authentication-surface binary — i.e. the run dumped creds and never attempted to pivot with them |
| Enumerated, never audited | `audit_smb_shares` | `skipped` | the listing episode `seq` | `null` | an anonymous/null SMB listing succeeded (an `smbclient -L -N` / null-session listing episode, exit 0) **and** no later share-permission-audit command (`smbmap`, `crackmapexec/netexec --shares`, `smbcacls`) ran |

`lag_ms` is set only for the `late_pivot` slow-line item, computed the same way
`ghost.ts` computes late-pivot lag (elapsed at `actual_seq` minus elapsed at
`unlock_seq`). `skipped` items have `lag_ms = 0`.

The credential detector is deliberately conservative: it stays silent whenever any
authentication was attempted after the credential was found, because under redaction the
run cannot prove *which* credential a later auth used. It fires only for the
unambiguous, provable case (creds found, no pivot attempted at all).

Detector detail:

- **Privesc slow-line** — adapts the existing `analyzePrivesc(report)` result. When
  `slow_line` is present, emit one `late_pivot` item using `available_seq` /
  `rooted_seq`; the note names the confirmed vector from `slow_line.path.title`. No new
  privesc logic; this detector only translates an existing result into a `GhostItem`.
- **Credential found, never used** — a `cred` finding exists and **no** later episode
  (seq > the cred's `source_seq`) runs an authentication-surface binary. It does **not**
  consult `used_by_seq` (unreliable under redaction, above). One item, on the earliest
  such cred. The auth-surface set is broad on purpose (`ssh`, `su`, `smbclient` with
  `-U`, `evil-winrm`, `crackmapexec`, `netexec`, `mysql`, `psql`, `ftp`, `rdesktop`,
  `xfreerdp`, `winrm`, `psexec.py`, `wmiexec.py`), so any plausible pivot attempt keeps
  the detector silent — it fires only when nothing auth-like happened after creds surfaced.
- **Enumerated, never audited** — an anonymous/null SMB listing episode that succeeded
  (binary `smbclient` with `-L` and a null-session flag `-N`/`-U ""`, exit 0/undefined),
  with no later share-permission-audit command (`smbmap`, `crackmapexec`/`netexec` with
  `--shares`, or `smbcacls`). This mirrors the run's own already-computed "next step you
  skipped" coaching signal.

### De-duplication

A signal item is dropped when it restates a golden objective. Because `GhostItem`
carries no tactic or finding id (and the schema is unchanged), de-dup uses a
slug→tactic map internal to `signals.ts` (`SIGNAL_TACTIC`) plus the golden objectives'
own tactics (read from `report.golden_dag` by slug):

- **Same slug:** a golden objective whose `objective` equals the signal's slug ⇒ drop.
- **Same tactic + adjacent unlock:** a golden objective sharing the signal's tactic
  (`SIGNAL_TACTIC[slug]` vs the objective's `tactic`) whose `unlock_seq` is within ±2
  running episodes of the signal's `unlock_seq` ⇒ drop.

Golden always wins. Example: the Abducted fixture's golden path already contains
`audit_share_permissions` (tactic `TA0007`), so the `audit_smb_shares` signal
(`SIGNAL_TACTIC` = `TA0007`) at the adjacent listing seq is suppressed. With no golden
path, nothing is dropped.

### Downstream touch-points

- **`humanizeObjective` (`src/lib/audits.ts:144`)** — add explicit labels for the three
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
  three detectors, `SIGNAL_TACTIC`, and their deterministic notes. One clear
  responsibility: turn proven run facts into Ghost items.
- **Create** `src/lib/ghost/signals.test.ts`.
- **Modify** `src/lib/ghost/ghost.ts` — remove the `null`-on-empty-golden early return;
  add merge + de-dupe + recompute. (`ingest.ts` is unchanged — the partial it already
  passes satisfies every detector.)
- **Modify** `src/lib/audits.ts` — three labels in `humanizeObjective`.
- **Modify** `src/types/report.ts` — relax the `Ghost` doc-comment only.

## Testing (TDD)

- **Per detector, both directions.** Proof present → item emitted with the exact
  verdict/`unlock_seq`/`actual_seq`; proof absent → **no item** (the false-positive
  guard, the most important assertion). Specifically: a cred followed by an `ssh`/`su`
  attempt emits nothing (only creds-with-no-pivot fires); a null-session run where shares
  *were* audited emits nothing; a report with no `slow_line` emits nothing.
- **Merge/de-dup** — golden `audit_share_permissions` present ⇒ overlapping signal
  suppressed; absent ⇒ signal appears. Same-slug and same-tactic+adjacent rules each
  covered.
- **No-golden end-to-end** — the Abducted (or RootMe) fixture with `golden_dag` stripped,
  run through `computeGhost`: today returns `null`; now returns a non-null result whose
  items include the expected signals. Asserts `time_lost_ms`/`human_wins` recomputed over
  the merged set.
- **Regression** — existing `ghost.test.ts` golden-path assertions pass unchanged,
  proving the merge left the write-up path intact.

## Deferred to a follow-up

- **Known-vuln-service detector** (`investigate_vuln_service`). Highest-value, but it
  needs (a) parsing `<product> <version>` out of episode `output_digest` text, since no
  `service`/`version` findings exist, and (b) a curated, committed service→CVE map
  (`src/lib/analysis/service-cves.ts`, exact-version entries like vsftpd 2.3.4 /
  ProFTPD 1.3.5, public NVD facts). Both carry more false-positive risk than the three v1
  detectors and deserve their own spec+plan.

## Global constraints

- Deterministic; never feeds the letter grade (coaching only), same invariant as the
  golden Ghost and privesc.
- No copied GPL/unlicensed source (the deferred CVE map would re-express public NVD facts).
- No new dependencies.
- `schema_version` stays `"1.4"`; no `GhostItem`/`Ghost` shape change.
