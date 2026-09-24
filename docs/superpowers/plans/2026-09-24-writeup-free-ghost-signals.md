# Write-up-free Ghost signals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ghost's "you vs. the optimal line" counterfactual work on runs with no write-up/`golden_dag`, by emitting signal items only when the run's own captured facts prove the opportunity.

**Architecture:** A new `src/lib/ghost/signals.ts` holds three pure detectors that turn proven run facts into `GhostDiffItem`s reusing the existing `skipped`/`late_pivot` verdicts. `computeGhost` stops returning `null` on an empty golden path: it computes golden items as today, always appends the signal items, de-duplicates them against the golden set, and recomputes `time_lost_ms`/`human_wins` over the merged list. No schema change; all downstream Ghost consumers keep working.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-writeup-free-ghost-signals-design.md`

## Global Constraints

- Deterministic; coaching only — signals NEVER feed the letter grade (same invariant as the golden Ghost and privesc).
- Signal-based only: emit an item **only** when the run's facts prove the opportunity. Absence of proof emits nothing. No synthetic full path.
- No schema change: `schema_version` stays `"1.4"`; no change to the `GhostItem`/`Ghost` shape in `src/types/report.ts`.
- No new Ghost verdicts. Signals reuse `skipped` and `late_pivot` only.
- Do **not** use `Finding.used_by_seq` for the credential detector — it is unreliable under the default `full` redaction profile (values are masked, so a used cred still shows `[]`).
- No new dependencies. No copied GPL/unlicensed source.
- `src/lib/pipeline/ingest.ts` is unchanged — the partial `{ golden_dag, episodes, findings }` it already passes to `computeGhost` satisfies every detector (including `analyzePrivesc`, which reads only `report.episodes` and `report.findings`).
- Signal detector functions return `GhostDiffItem[]` (the interface exported from `src/lib/ghost/ghost.ts:3`), imported type-only to avoid a runtime cycle.
- Run tests with `npx vitest run <path>` from the repo root `C:\Users\Tiago Peter\Claude\Projects\Watcher`.

---

### Task 1: Signals module + credential-found-never-used detector

**Files:**
- Create: `src/lib/ghost/signals.ts`
- Test: `src/lib/ghost/signals.test.ts`

**Interfaces:**
- Consumes: `GhostDiffItem` (type) from `./ghost` (`{ objective: string; verdict: GhostVerdict; unlock_seq: number | null; actual_seq: number | null; lag_ms: number; note: string }`); `WatcherReport`, `Episode` from `../../types/report`.
- Produces:
  - `export const SIGNAL_TACTIC: Record<string, string>` — signal slug → MITRE tactic.
  - `export function elapsedBySeq(episodes: Episode[]): Map<number, number>` — cumulative (gap+duration) ms by seq.
  - `export function detectCredNotReused(report: WatcherReport): GhostDiffItem[]`
  - `export function computeSignalGhost(report: WatcherReport): GhostDiffItem[]` — flat-maps the detector list.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ghost/signals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectCredNotReused, computeSignalGhost } from "./signals";
import type { WatcherReport, Episode, Finding } from "../../types/report";

function ep(seq: number, binary: string, cmd: string, extra: Partial<Episode> = {}): Episode {
  return { seq, binary, cmd, duration_ms: 0, gap_before_ms: 0, actor: "human_active", tactic: "TA0007", ...extra };
}
function cred(source_seq: number): Finding {
  return { id: `cred:${source_seq}`, kind: "cred", value: "password: [redacted]", source_seq, used_by_seq: [] };
}
function report(episodes: Episode[], findings: Finding[]): WatcherReport {
  return { episodes, findings } as WatcherReport;
}

describe("detectCredNotReused", () => {
  it("fires when a cred is found and no later episode attempts authentication", () => {
    const r = report([ep(5, "cat", "cat rclone.conf"), ep(6, "ls", "ls -la")], [cred(5)]);
    const items = detectCredNotReused(r);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ objective: "reuse_found_cred", verdict: "skipped", unlock_seq: 5, actual_seq: null, lag_ms: 0 });
  });

  it("stays silent when a later episode attempts authentication (ssh)", () => {
    const r = report([ep(5, "cat", "cat rclone.conf"), ep(7, "ssh", "ssh user@host")], [cred(5)]);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("stays silent when smbclient -U is used after the cred", () => {
    const r = report([ep(5, "cat", "cat creds"), ep(8, "smbclient", "smbclient //h/share -U scott")], [cred(5)]);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("emits nothing when there are no cred findings", () => {
    const r = report([ep(1, "nmap", "nmap host")], []);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("computeSignalGhost includes the cred item", () => {
    const r = report([ep(5, "cat", "cat creds")], [cred(5)]);
    expect(computeSignalGhost(r).map((i) => i.objective)).toContain("reuse_found_cred");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ghost/signals.test.ts`
Expected: FAIL — `signals.ts` / `detectCredNotReused` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/ghost/signals.ts`:

```ts
import type { WatcherReport, Episode } from "../../types/report";
import type { GhostDiffItem } from "./ghost";

/** Signal slug → MITRE tactic, used by de-duplication against golden objectives. */
export const SIGNAL_TACTIC: Record<string, string> = {
  reuse_found_cred: "TA0006",
  audit_smb_shares: "TA0007",
  escalate_via_confirmed_path: "TA0004",
};

/** Cumulative elapsed (gap+duration) ms by seq, over episodes in seq order. */
export function elapsedBySeq(episodes: Episode[]): Map<number, number> {
  const ordered = [...episodes].sort((a, b) => a.seq - b.seq);
  const elapsed = new Map<number, number>();
  let acc = 0;
  for (const e of ordered) {
    acc += (e.gap_before_ms ?? 0) + (e.duration_ms ?? 0);
    elapsed.set(e.seq, acc);
  }
  return elapsed;
}

// Binaries whose invocation is an authentication attempt. smbclient/curl/wget are auth only with
// the right flag, so they are handled specially in isAuthAttempt (bare smbclient -L is enumeration).
const AUTH_BINARIES = new Set([
  "ssh", "su", "sshpass", "evil-winrm", "crackmapexec", "netexec",
  "mysql", "psql", "ftp", "rdesktop", "xfreerdp", "winrm", "psexec.py", "wmiexec.py",
]);

function isAuthAttempt(ep: Episode): boolean {
  const b = ep.binary;
  if (AUTH_BINARIES.has(b)) return true;
  if (b === "smbclient" && /(^|\s)-U(\s|=)/.test(ep.cmd)) return true;
  if ((b === "curl" || b === "wget") && /(-u\s|--user)/.test(ep.cmd)) return true;
  return false;
}

/**
 * Credential found, never used: a cred finding exists and NO later episode attempts any
 * authentication. Deliberately conservative — it never consults used_by_seq (unreliable under
 * redaction) and stays silent whenever any pivot was attempted, so it fires only for the
 * unambiguous "dumped creds, never pivoted" case.
 */
export function detectCredNotReused(report: WatcherReport): GhostDiffItem[] {
  const findings = report.findings ?? [];
  const episodes = report.episodes ?? [];
  const creds = findings.filter((f) => f.kind === "cred").sort((a, b) => a.source_seq - b.source_seq);
  if (!creds.length) return [];
  const earliest = creds[0];
  const pivoted = episodes.some((e) => e.seq > earliest.source_seq && isAuthAttempt(e));
  if (pivoted) return [];
  return [{
    objective: "reuse_found_cred",
    verdict: "skipped",
    unlock_seq: earliest.source_seq,
    actual_seq: null,
    lag_ms: 0,
    note: `You surfaced credentials at step ${earliest.source_seq} but never attempted to authenticate with them.`,
  }];
}

const DETECTORS: ((report: WatcherReport) => GhostDiffItem[])[] = [
  detectCredNotReused,
];

/** All write-up-free signal items for a report (pre-dedupe). */
export function computeSignalGhost(report: WatcherReport): GhostDiffItem[] {
  return DETECTORS.flatMap((d) => d(report));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ghost/signals.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: clean (confirms the type-only `GhostDiffItem` import resolves).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ghost/signals.ts src/lib/ghost/signals.test.ts
git commit -m "feat(ghost): signals module + credential-found-never-used detector"
```

---

### Task 2: Enumerated-never-audited detector

**Files:**
- Modify: `src/lib/ghost/signals.ts`
- Test: `src/lib/ghost/signals.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `export function detectEnumNotAudited(report: WatcherReport): GhostDiffItem[]`, and appends it to the module's `DETECTORS` list.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ghost/signals.test.ts` (reuse the `ep`/`report` helpers from Task 1):

```ts
import { detectEnumNotAudited } from "./signals";

describe("detectEnumNotAudited", () => {
  it("fires on a null SMB listing with no later share audit", () => {
    const r = report([ep(4, "smbclient", "smbclient -L //host/ -N", { exit_code: 0 }), ep(5, "cat", "cat notes")], []);
    const items = detectEnumNotAudited(r);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ objective: "audit_smb_shares", verdict: "skipped", unlock_seq: 4, actual_seq: null });
  });

  it("stays silent when shares were later audited (smbmap)", () => {
    const r = report([ep(4, "smbclient", "smbclient -L //host/ -N", { exit_code: 0 }), ep(6, "smbmap", "smbmap -H host")], []);
    expect(detectEnumNotAudited(r)).toEqual([]);
  });

  it("stays silent when there was no null listing", () => {
    const r = report([ep(1, "nmap", "nmap -sCV host")], []);
    expect(detectEnumNotAudited(r)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ghost/signals.test.ts`
Expected: FAIL — `detectEnumNotAudited` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ghost/signals.ts`, add these helpers and the detector above the `DETECTORS` array:

```ts
function isNullSmbListing(ep: Episode): boolean {
  return ep.binary === "smbclient"
    && /(^|\s)-L(\s|$)/.test(ep.cmd)
    && (/(^|\s)-N(\s|$)/.test(ep.cmd) || /-U\s*(""|'')/.test(ep.cmd))
    && (ep.exit_code == null || ep.exit_code === 0);
}

function isShareAudit(ep: Episode): boolean {
  const b = ep.binary;
  if (b === "smbmap" || b === "smbcacls") return true;
  if ((b === "crackmapexec" || b === "netexec") && /--shares/.test(ep.cmd)) return true;
  return false;
}

/**
 * Enumerated, never audited: an anonymous/null SMB listing succeeded but the shares' permissions
 * were never audited. Mirrors the run's own "next step you skipped" coaching signal.
 */
export function detectEnumNotAudited(report: WatcherReport): GhostDiffItem[] {
  const episodes = report.episodes ?? [];
  const listing = episodes.find(isNullSmbListing);
  if (!listing) return [];
  const audited = episodes.some((e) => e.seq > listing.seq && isShareAudit(e));
  if (audited) return [];
  return [{
    objective: "audit_smb_shares",
    verdict: "skipped",
    unlock_seq: listing.seq,
    actual_seq: null,
    lag_ms: 0,
    note: `An anonymous SMB listing succeeded at step ${listing.seq}, but you never audited the shares' permissions (smbmap / crackmapexec --shares).`,
  }];
}
```

Then add it to the detector list:

```ts
const DETECTORS: ((report: WatcherReport) => GhostDiffItem[])[] = [
  detectCredNotReused,
  detectEnumNotAudited,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ghost/signals.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ghost/signals.ts src/lib/ghost/signals.test.ts
git commit -m "feat(ghost): enumerated-never-audited detector"
```

---

### Task 3: Privesc slow-line detector

**Files:**
- Modify: `src/lib/ghost/signals.ts`
- Test: `src/lib/ghost/signals.test.ts`

**Interfaces:**
- Consumes: `analyzePrivesc` and the type `PrivescResult` from `../analysis/privesc` (`analyzePrivesc(report: WatcherReport): PrivescResult`; `PrivescResult["slow_line"]` is `{ available_seq: number; rooted_seq: number; path: { title: string } } | null`); `elapsedBySeq` from Task 1.
- Produces:
  - `export function slowLineItem(slow: NonNullable<PrivescResult["slow_line"]>, episodes: Episode[]): GhostDiffItem` (pure translator).
  - `export function detectPrivescSlowLine(report: WatcherReport): GhostDiffItem[]`, appended to `DETECTORS`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ghost/signals.test.ts`:

```ts
import { slowLineItem, detectPrivescSlowLine } from "./signals";

describe("privesc slow-line", () => {
  it("slowLineItem translates a slow_line into a late_pivot with computed lag", () => {
    const episodes = [ep(11, "ls", "ls -la /etc"), ep(16, "cat", "cat root.txt", { gap_before_ms: 60000, duration_ms: 0 })];
    const item = slowLineItem({ available_seq: 11, rooted_seq: 16, path: { title: "writable systemd dir" } } as any, episodes);
    expect(item).toMatchObject({ objective: "escalate_via_confirmed_path", verdict: "late_pivot", unlock_seq: 11, actual_seq: 16 });
    expect(item.lag_ms).toBeGreaterThan(0);
    expect(item.note).toContain("writable systemd dir");
  });

  it("detectPrivescSlowLine emits nothing when there is no privesc signal", () => {
    const r = report([ep(1, "nmap", "nmap host")], []);
    expect(detectPrivescSlowLine(r)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ghost/signals.test.ts`
Expected: FAIL — `slowLineItem` / `detectPrivescSlowLine` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ghost/signals.ts`, add the import at the top:

```ts
import { analyzePrivesc } from "../analysis/privesc";
import type { PrivescResult } from "../analysis/privesc";
```

Add the translator and detector above `DETECTORS`:

```ts
/** Pure translator: a privesc slow_line + episodes → one late_pivot GhostDiffItem. */
export function slowLineItem(slow: NonNullable<PrivescResult["slow_line"]>, episodes: Episode[]): GhostDiffItem {
  const elapsed = elapsedBySeq(episodes);
  const lag = Math.max(0, (elapsed.get(slow.rooted_seq) ?? 0) - (elapsed.get(slow.available_seq) ?? 0));
  return {
    objective: "escalate_via_confirmed_path",
    verdict: "late_pivot",
    unlock_seq: slow.available_seq,
    actual_seq: slow.rooted_seq,
    lag_ms: lag,
    note: `A confirmed root path (${slow.path.title}) was observable at step ${slow.available_seq}; you rooted at step ${slow.rooted_seq} by a slower route.`,
  };
}

/** Privesc slow-line: adapts analyzePrivesc's slow_line signal into a Ghost item. */
export function detectPrivescSlowLine(report: WatcherReport): GhostDiffItem[] {
  const pr = analyzePrivesc(report);
  return pr.slow_line ? [slowLineItem(pr.slow_line, report.episodes ?? [])] : [];
}
```

Add it to the detector list:

```ts
const DETECTORS: ((report: WatcherReport) => GhostDiffItem[])[] = [
  detectCredNotReused,
  detectEnumNotAudited,
  detectPrivescSlowLine,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ghost/signals.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ghost/signals.ts src/lib/ghost/signals.test.ts
git commit -m "feat(ghost): privesc slow-line detector"
```

---

### Task 4: De-duplicate signals against the golden set

**Files:**
- Modify: `src/lib/ghost/signals.ts`
- Test: `src/lib/ghost/signals.test.ts`

**Interfaces:**
- Consumes: `SIGNAL_TACTIC` from Task 1; `GhostDiffItem` (type) from `./ghost`; `GoldenObjective`, `Episode` from `../../types/report`.
- Produces: `export function dedupeSignals(signals: GhostDiffItem[], goldenItems: GhostDiffItem[], golden: GoldenObjective[], episodes: Episode[]): GhostDiffItem[]`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ghost/signals.test.ts`:

```ts
import { dedupeSignals } from "./signals";
import type { GoldenObjective } from "../../types/report";
import type { GhostDiffItem } from "./ghost";

const sig = (objective: string, unlock_seq: number): GhostDiffItem =>
  ({ objective, verdict: "skipped", unlock_seq, actual_seq: null, lag_ms: 0, note: "" });

describe("dedupeSignals", () => {
  it("returns all signals when there are no golden items", () => {
    const s = [sig("audit_smb_shares", 4)];
    expect(dedupeSignals(s, [], [], [])).toEqual(s);
  });

  it("drops a signal that shares a golden objective's slug", () => {
    const golden: GoldenObjective[] = [{ objective: "audit_smb_shares", tactic: "TA0007", satisfied_by: [] }];
    const goldenItems = [sig("audit_smb_shares", 4)];
    expect(dedupeSignals([sig("audit_smb_shares", 4)], goldenItems, golden, [])).toEqual([]);
  });

  it("drops a signal with the same tactic and an adjacent unlock seq", () => {
    const golden: GoldenObjective[] = [{ objective: "audit_share_permissions", tactic: "TA0007", satisfied_by: [] }];
    const goldenItems = [sig("audit_share_permissions", 5)];
    const episodes = [ep(4, "smbclient", "smbclient -L //h/ -N"), ep(5, "x", "x")];
    // audit_smb_shares is TA0007; golden unlock 5 is adjacent to signal unlock 4 → dropped
    expect(dedupeSignals([sig("audit_smb_shares", 4)], goldenItems, golden, episodes)).toEqual([]);
  });

  it("keeps a signal when the golden objective is a different tactic / far away", () => {
    const golden: GoldenObjective[] = [{ objective: "capture_root_flag", tactic: "TA0004", satisfied_by: [] }];
    const goldenItems = [sig("capture_root_flag", 30)];
    const episodes = Array.from({ length: 30 }, (_, i) => ep(i + 1, "x", "x"));
    const s = [sig("audit_smb_shares", 4)];
    expect(dedupeSignals(s, goldenItems, golden, episodes)).toEqual(s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ghost/signals.test.ts`
Expected: FAIL — `dedupeSignals` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/ghost/signals.ts`, widen the type imports and add the function. Update the import lines:

```ts
import type { WatcherReport, Episode, GoldenObjective } from "../../types/report";
```

Add at the end of the file:

```ts
/**
 * Drop signal items that restate a golden objective. GhostDiffItem carries no tactic, so a signal's
 * tactic comes from SIGNAL_TACTIC and each golden item's tactic from its GoldenObjective (by slug).
 * Rules: same slug, or same tactic with an adjacent unlock (≤2 running episodes apart). Golden wins.
 */
export function dedupeSignals(
  signals: GhostDiffItem[],
  goldenItems: GhostDiffItem[],
  golden: GoldenObjective[],
  episodes: Episode[],
): GhostDiffItem[] {
  if (!goldenItems.length) return signals;
  const bySlug = new Map(golden.map((o) => [o.objective, o]));
  const running = [...episodes]
    .filter((e) => e.actor !== "think_pause" && e.actor !== "idle")
    .sort((a, b) => a.seq - b.seq);
  const runningBetween = (a: number, b: number) =>
    running.filter((e) => e.seq > Math.min(a, b) && e.seq < Math.max(a, b)).length;
  const goldenMeta = goldenItems.map((gi) => ({
    slug: gi.objective,
    tactic: bySlug.get(gi.objective)?.tactic,
    unlock: gi.unlock_seq ?? null,
  }));
  return signals.filter((s) => {
    const tactic = SIGNAL_TACTIC[s.objective];
    for (const g of goldenMeta) {
      if (g.slug === s.objective) return false;
      if (tactic && g.tactic === tactic && g.unlock != null && s.unlock_seq != null && runningBetween(g.unlock, s.unlock_seq) <= 2) {
        return false;
      }
    }
    return true;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ghost/signals.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ghost/signals.ts src/lib/ghost/signals.test.ts
git commit -m "feat(ghost): dedupe signals against the golden set"
```

---

### Task 5: Merge signals into computeGhost + labels + doc-comment

**Files:**
- Modify: `src/lib/ghost/ghost.ts:16-79` (the `computeGhost` body)
- Modify: `src/lib/audits.ts` (the `OBJECTIVE_LABELS` const near line 127)
- Modify: `src/types/report.ts` (the `GhostItem` doc-comment near line 218)
- Test: `src/lib/ghost/ghost.test.ts`

**Interfaces:**
- Consumes: `computeSignalGhost`, `dedupeSignals` (runtime) from `./signals`.
- Produces: `computeGhost` returns a non-null `GhostResult` whenever golden OR signal items exist; `null` only when both are empty. `time_lost_ms`/`human_wins` are computed over the merged item list.

- [ ] **Step 1: Write the failing test**

`src/lib/ghost/ghost.test.ts` **already** imports `computeGhost` and `{ WatcherReport, Episode, Finding, GoldenObjective }` from `../../types/report`, and already has a `rep(...)` helper and an object-arg `ep(...)` helper. Do **not** re-import those — that would be a duplicate-import error. Append only the `gEp` helper (a fresh name, positional args — the existing `ep` takes an object) and the new `describe` block:

```ts
function gEp(seq: number, binary: string, cmd: string, extra: Partial<Episode> = {}): Episode {
  return { seq, binary, cmd, duration_ms: 0, gap_before_ms: 0, actor: "human_active", tactic: "TA0007", ...extra };
}

describe("computeGhost with write-up-free signals", () => {
  it("returns a non-null Ghost from signals alone when there is no golden path", () => {
    const r = { golden_dag: [], episodes: [gEp(4, "smbclient", "smbclient -L //h/ -N", { exit_code: 0 })], findings: [] } as unknown as WatcherReport;
    const g = computeGhost(r);
    expect(g).not.toBeNull();
    expect(g!.items.map((i) => i.objective)).toContain("audit_smb_shares");
  });

  it("suppresses a signal that a golden objective already covers", () => {
    const golden: GoldenObjective[] = [{ objective: "audit_share_permissions", tactic: "TA0007", satisfied_by: [], user_satisfied_by_seq: 5 }];
    const r = { golden_dag: golden, episodes: [gEp(4, "smbclient", "smbclient -L //h/ -N", { exit_code: 0 }), gEp(5, "x", "x")], findings: [] } as unknown as WatcherReport;
    const g = computeGhost(r);
    expect(g!.items.map((i) => i.objective)).not.toContain("audit_smb_shares");
  });

  it("returns null when neither golden nor signals produce items", () => {
    const r = { golden_dag: [], episodes: [gEp(1, "nmap", "nmap host")], findings: [] } as unknown as WatcherReport;
    expect(computeGhost(r)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/ghost/ghost.test.ts`
Expected: FAIL — the no-golden case currently returns `null` (first new test fails).

- [ ] **Step 3: Rewrite computeGhost to merge**

In `src/lib/ghost/ghost.ts`, add the import near the top (after the existing type import):

```ts
import { computeSignalGhost, dedupeSignals } from "./signals";
```

Replace the body of `computeGhost` (lines 16-79) so it no longer early-returns on an empty golden path, collects golden items without inline accumulation, then merges. The exact new body:

```ts
export function computeGhost(report: WatcherReport): GhostResult | null {
  const golden = report.golden_dag ?? [];
  const episodes = report.episodes;
  const findings = report.findings ?? [];

  const goldenItems: GhostDiffItem[] = [];
  if (golden.length) {
    const running = episodes.filter((e) => e.actor !== "think_pause" && e.actor !== "idle");
    const startSeq = running.length ? running[0].seq : (episodes[0]?.seq ?? 0);

    const bySeq = new Map<number, Episode>(episodes.map((e) => [e.seq, e]));
    const ordered = [...episodes].sort((a, b) => a.seq - b.seq);
    const elapsed = new Map<number, number>();
    let acc = 0;
    for (const e of ordered) { acc += (e.gap_before_ms ?? 0) + (e.duration_ms ?? 0); elapsed.set(e.seq, acc); }
    const elapsedAt = (seq: number | null) => (seq == null ? 0 : elapsed.get(seq) ?? 0);
    const runningBetween = (a: number, b: number) => running.filter((e) => e.seq > a && e.seq < b).length;

    const enablingSeq = (tactic: string): number | null => {
      if (tactic === "TA0007") return startSeq;
      const kinds = ENABLING[tactic] ?? [];
      const seqs = findings.filter((f) => kinds.includes(f.kind)).map((f) => f.source_seq);
      return seqs.length ? Math.min(...seqs) : null;
    };

    const unlock = new Map<string, number | null>();
    const bySlug = new Map(golden.map((o) => [o.objective, o]));
    const unlockOf = (o: GoldenObjective, seen: Set<string>): number | null => {
      if (unlock.has(o.objective)) return unlock.get(o.objective)!;
      if (seen.has(o.objective)) return null;
      seen.add(o.objective);
      const depUnlocks = (o.depends_on ?? []).map((d) => { const dep = bySlug.get(d); return dep ? unlockOf(dep, seen) : null; }).filter((s): s is number => s != null);
      const en = enablingSeq(o.tactic);
      const candidates = [...depUnlocks, ...(en != null ? [en] : [])];
      const u = candidates.length ? Math.max(...candidates) : null;
      unlock.set(o.objective, u);
      return u;
    };

    for (const o of golden) {
      const u = unlockOf(o, new Set());
      const actual = o.user_satisfied_by_seq ?? null;
      const satAlign = actual != null ? bySeq.get(actual)?.alignment : undefined;
      let verdict: GhostVerdict;
      let lag = 0;
      if (actual != null && satAlign === "alternative") { verdict = "off_path_win"; }
      else if (actual != null && u != null && actual <= u) { verdict = "ahead"; }
      else if (actual == null && u != null) { verdict = "skipped"; }
      else if (actual != null && u != null && runningBetween(u, actual) > LATE_PIVOT_INTERVENING) { verdict = "late_pivot"; lag = Math.max(0, elapsedAt(actual) - elapsedAt(u)); }
      else { verdict = "on_time"; }
      const note = deterministicNote(o.objective, verdict, u, actual, lag);
      goldenItems.push({ objective: o.objective, verdict, unlock_seq: u, actual_seq: actual, lag_ms: lag, note });
    }
  }

  const signalItems = dedupeSignals(computeSignalGhost(report), goldenItems, golden, episodes);
  const items = [...goldenItems, ...signalItems];
  if (!items.length) return null;

  const timeLost = items.reduce((s, i) => s + (i.verdict === "late_pivot" ? i.lag_ms : 0), 0);
  const wins = items.filter((i) => i.verdict === "ahead" || i.verdict === "off_path_win").length;
  return { time_lost_ms: timeLost, human_wins: wins, items };
}
```

This preserves the golden-path numbers exactly (`wins` counts `ahead`/`off_path_win`; `timeLost` sums `late_pivot` lag — identical to the old inline accumulation) while adding the merged signals.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/ghost/ghost.test.ts`
Expected: PASS — new tests pass AND every pre-existing test in the file still passes (regression proof for the golden path).

- [ ] **Step 5: Add the humanizeObjective labels**

In `src/lib/audits.ts`, add three entries to the `OBJECTIVE_LABELS` object (near line 127), matching the existing capitalized style:

```ts
  reuse_found_cred: "Reuse a found credential",
  audit_smb_shares: "Audit the SMB shares",
  escalate_via_confirmed_path: "Escalate via the confirmed path",
```

- [ ] **Step 6: Relax the GhostItem doc-comment**

In `src/types/report.ts`, change the `GhostItem` doc-comment (near line 218) from:

```ts
/** Per-objective ghost diff entry (schema v1.4). */
```

to:

```ts
/** Per-objective ghost diff entry — a golden objective or a detected run signal (schema v1.4). */
```

- [ ] **Step 7: Full suite + typecheck**

Run: `npx vitest run` then `npx tsc -b --noEmit`
Expected: all tests pass (the prior 528 plus the new signal/ghost tests); typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/lib/ghost/ghost.ts src/lib/audits.ts src/types/report.ts src/lib/ghost/ghost.test.ts
git commit -m "feat(ghost): merge write-up-free signals into computeGhost"
```
