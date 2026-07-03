# Design Spec — Platform-Agnostic Capture + the Task-Tree / Findings Spine

**Date:** 2026-07-02
**Status:** Approved for implementation (sub-project 1 of 3)
**Executor model:** Claude Opus 4.8, one Work Package at a time
**Author:** Fable 5 (design), for delegation

---

## 0. How to use this document (read first, Opus)

This spec is written to be executed **one Work Package (WP) at a time**. Each WP is self-contained: it names the files it touches, the exact interfaces to add, the algorithm, and a checklist of **acceptance criteria** that must be green before the WP is "done." Work packages are ordered by dependency (see §9). Do not start a WP whose dependencies are not yet merged.

**Non-negotiable working rules for every WP:**

1. **TDD.** Write the failing test first (Vitest), then the implementation. Use `superpowers:test-driven-development`.
2. **Green gate between WPs.** Before declaring a WP complete, all four must pass:
   - `npm test` (Vitest — the whole suite, not just your new file)
   - `npm run typecheck` (`tsc -b --noEmit`)
   - `npm run build` (must compile and bundle)
   - the schema round-trip test (`tests/schema.test.ts`) validates **every** fixture, old and new.
3. **Additive, backward-compatible.** Every schema and type change in sub-project 1 is **additive**. An existing `schema_version: "1.1"` report must still load, validate, and render unchanged. New fields are optional. Never delete or repurpose an existing field in this sub-project.
4. **Determinism is sacred.** The numbers (grade, efficiency, coverage, stealth) are produced deterministically. Nothing you add may make a re-run of the same input produce a different report. Model calls may only *enrich narrative text*, never change a metric — the existing contract. New deterministic stages must be pure functions of their input.
5. **Redaction before persistence.** Any new field that can hold a secret (a credential, a flag string, a hash, a live IP) must pass through `redactText` / respect `redaction_profile: "public_safe"` before it is written to a report. See WP-4.
6. **No scope creep.** The report visual redesign, the strategy/action/observation grade rubric, longitudinal cross-run views, and cohort/enterprise roll-ups are **later sub-projects**. This spec lays down the *data* they will need, and nothing more. If a WP tempts you to redesign a component, stop at the minimal surfacing described in WP-7.

**When a WP is ambiguous:** prefer the choice that (a) keeps old reports valid, (b) keeps the pipeline deterministic, and (c) adds the smallest new surface. Leave a `// DESIGN:` comment noting the call so review can catch it.

---

## 1. Context and thesis

### 1.1 What Watcher is today

A local-first flight-data-recorder for offensive-security practice, **coupled to Hack The Box**. A Rust PTY agent (`crates/capture`) captures a shell; a deterministic TypeScript pipeline (`src/lib/pipeline`: `segment → mitre → frameworks → align`) tags each command with ATT&CK / UKC / CWE and diffs the run against a write-up-derived "golden DAG"; a React report renders a graded Lighthouse-style debrief with a live companion panel. The report document is `schema/watcher-report.schema.json` (mirrored by `src/types/report.ts`).

### 1.2 Where the HTB coupling actually lives

The pipeline and the report document are **already mostly platform-neutral**. The coupling is at three edges only:

- **Identity** — `session.machine` (avatar/difficulty/points/retired) and `src/lib/machine.ts::machineOf()` assume an HTB box; the store keys live sessions as `htb:<uuid>` (`src/store/report.ts:276`, `src/components/History.tsx:104`).
- **Intended-path sourcing** — `src/lib/net.ts` hardcodes 0xdf's sitemap, the HTB app token, and Pwnbox SCP; the golden DAG knows exactly **one** way in: fetch/paste a prose write-up (`src/lib/writeup/`).
- **Calibration** — noise baseline and difficulty colours are HTB-shaped.

### 1.3 The thesis (why this sub-project is shaped the way it is)

Research into how strong offensive-security AI agents operate (PentestGPT's Pentesting Task Tree; CAI; HackingBuddyGPT; D-CIPHER; Google Big Sleep; XBOW) and into professional report standards (PTES, OSCP/PEN-200, PlexTrac) converges on a single conclusion:

> **The way a good offensive agent *thinks*, the way a good pentest *report* is organised, and the way a learner's *methodology* should be graded are the same object model:** an **attributed task tree** of objectives, hung with **first-class findings** (each linked to the enumeration that produced it and the action it enabled), where success is **execution-verified (proven), not self-asserted (claimed)**, every node tagged with **ATT&CK / CWE**.

PentestGPT calls it a *Pentesting Task Tree* and edits only leaf nodes so a hallucination can't corrupt strategy. The report standards call the same structure *findings schema + attack narrative*. Big Sleep and XBOW enforce *"perfect verification"* — a finding counts only when exploitation is observed — which is the OSCP grading rule "no proof, no points" arrived at from the offense side.

**Consequence for the design:** the single highest-leverage upgrade is to make that structure Watcher's core data model. And it happens to be *the same edit* as decoupling from HTB — because guided platforms (TryHackMe rooms, OffSec lab objectives) hand you the task tree natively, which forces the flat `golden_dag` to become an attributed tree. So sub-project 1 does both at once: **platform abstraction + the task-tree/findings spine.**

Full principle-to-design mapping is in Appendix A.

---

## 2. Goals and non-goals

### 2.1 Goals (this sub-project)

- **G1.** A `PlatformAdapter` seam so HTB, TryHackMe, OffSec, Immersive, and a bare local/CTF host all flow through one identity + intended-path + calibration abstraction, with **auto-detection** from environment.
- **G2.** A neutral identity model (`Target`) replacing HTB-specific `Machine` at the presentation layer, without breaking old reports.
- **G3.** The `golden_dag` generalised into an **attributed Objective Tree** (status + finding refs + proven marker), backward compatible (a flat list is a depth-1 tree).
- **G4.** A first-class **Findings ledger** — structured findings extracted deterministically from output, each linked `enumeration → finding → action`.
- **G5.** **Claimed-vs-proven** verification on objectives and flags, feeding coverage honestly.
- **G6.** **TryHackMe** working end-to-end as the proof that the seam generalises (native task-tree intended path + CIDR detect), with HTB behaviour unchanged.

### 2.2 Non-goals (explicitly deferred to later sub-projects)

- Report visual redesign / JTBD hierarchy re-layout (sub-project 3).
- Strategy/action/observation grade rubric, tunnel-vision & hypothesis-driven metrics (sub-project 2).
- Longitudinal cross-run "am I improving" view; cohort/team roll-ups (sub-project 3 + beyond).
- OffSec and Immersive *native* intended-path extraction — their adapters ship as **detection + identity + write-up fallback** only; native objective parsing is a follow-up.
- Model-based findings enrichment — WP-4 ships the **deterministic** extractor; the model-refinement layer is a later add (the seam is left open).

---

## 3. Architecture overview

```
capture (Rust PTY / Pwnbox / plugin)
        │  telemetry envelopes (NDJSON)  [+ provenance.platform, provenance.target]
        ▼
  ingest (src/lib/pipeline/ingest.ts)
        │  RawCommand[]
        ▼
  ┌─────────────── deterministic pipeline (src/lib/pipeline/index.ts) ───────────────┐
  │ segment → mitre → frameworks → EXTRACT_FINDINGS(new) → align(tree-aware) → metrics │
  └──────────────────────────────────────────────────────────────────────────────────┘
        │  WatcherReport { …, findings[], golden_dag: ObjectiveNode[] with status/proven }
        ▼
  store (src/store/report.ts) ── targetOf(report) ──▶ PlatformAdapter.identify()
        ▼
  report UI (unchanged layout; minimal proven/findings surfacing per WP-7)

  PlatformAdapter seam (src/lib/platform/*) sits at TWO points only:
    • ingest/identity: resolve neutral Target + native intended path
    • calibration: noise baseline / difficulty colour
  It is invisible to segment/mitre/frameworks/metrics.
```

**Design invariant:** the adapter influences **identity, intended-path source, and calibration** only. The scoring pipeline stays platform-blind — it operates on episodes and an Objective Tree regardless of where they came from.

---

## 4. Data model — schema v1.2 (additive)

All additions go into `schema/watcher-report.schema.json` (which already lists `"1.2"` in the `schema_version` enum) and its TS mirror `src/types/report.ts`. **All new fields are optional**; `additionalProperties: false` means each new field must be declared in the schema or fixtures fail validation.

### 4.1 Neutral target identity (`session.target`)

Add alongside the existing `session.machine` (which stays, untouched, for back-compat). `session.target` is the neutral hero identity; adapters populate it.

```jsonc
// under session.properties, new sibling of "machine"
"target": {
  "type": "object",
  "description": "Neutral, platform-agnostic target identity (schema v1.2). Supersedes session.machine; machine is retained for back-compat and HTB CDN avatars.",
  "additionalProperties": false,
  "properties": {
    "platform":   { "type": "string", "enum": ["htb", "thm", "offsec", "immersive", "local"] },
    "kind":       { "type": "string", "description": "Platform noun: box | room | lab | target | host." },
    "name":       { "type": "string" },
    "slug":       { "type": "string" },
    "os":         { "type": "string" },
    "difficulty": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "properties": {
        "level": { "type": "integer", "minimum": 1, "maximum": 5, "description": "Normalized 1-5 across platforms." },
        "label": { "type": "string", "description": "Native label, e.g. 'Easy', 'Info', 'CPTS-tier'." }
      }
    },
    "emblem": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "avatar": { "type": ["string", "null"], "description": "Optional avatar URL (e.g. HTB CDN)." },
        "hue":    { "type": ["integer", "null"], "minimum": 0, "maximum": 360, "description": "Generated fallback hue." }
      }
    },
    "url": { "type": ["string", "null"], "description": "Canonical platform URL for this target." }
  }
}
```

### 4.2 Objective Tree node attributes (extend `golden_dag` items)

Keep the field name `golden_dag` and its existing shape; **add** three optional properties to each item. A flat list with no `depends_on` is a valid depth-1 tree.

```jsonc
// add to golden_dag.items.properties (existing: objective, tactic, satisfied_by, depends_on, user_satisfied_by_seq)
"status": {
  "type": "string",
  "enum": ["untouched", "attempted", "reached", "proven"],
  "description": "Objective progress (schema v1.2). untouched = never approached; attempted = tried but low-yield/failed; reached = an episode satisfied it; proven = reaching it is backed by observable proof (a captured flag, uid=0, an established shell)."
},
"finding_refs": {
  "type": "array",
  "items": { "type": "string" },
  "description": "Finding ids (see report.findings) that evidence this objective (schema v1.2)."
},
"proven_by_seq": {
  "type": ["integer", "null"],
  "description": "Episode seq carrying observable proof this objective was truly achieved, or null (schema v1.2)."
}
```

### 4.3 Findings ledger (`report.findings`)

New top-level optional array. This is the enum→finding→action causal chain and the report's evidence spine.

```jsonc
// new top-level property (NOT added to "required")
"findings": {
  "type": "array",
  "description": "Structured findings extracted from output — the evidence ledger (schema v1.2). Deterministic; redaction-profile aware.",
  "items": {
    "type": "object",
    "required": ["id", "kind", "value", "source_seq"],
    "additionalProperties": false,
    "properties": {
      "id":         { "type": "string", "description": "Stable deterministic id, e.g. 'port:80-tcp', 'url:hash8'." },
      "kind":       { "type": "string", "enum": ["port", "service", "version", "cred", "url", "path", "host", "hash", "vuln", "flag"] },
      "value":      { "type": "string", "description": "Display value; masked when redaction_profile = public_safe and the kind is secret-bearing (cred/hash/flag)." },
      "masked":     { "type": "boolean", "description": "True if value was redacted/masked under the active profile." },
      "source_seq": { "type": "integer", "minimum": 0, "description": "Episode seq of the enumeration that surfaced this finding." },
      "used_by_seq":{ "type": "array", "items": { "type": "integer", "minimum": 0 }, "description": "Later episode seqs that consumed this finding (the causal chain)." },
      "tactic":     { "type": "string", "pattern": "^TA[0-9]{4}$" },
      "proven":     { "type": "boolean", "description": "For flags/shells: the value was observed, not merely claimed." },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
    }
  }
}
```

### 4.4 TypeScript mirror (`src/types/report.ts`)

```ts
export type PlatformId = "htb" | "thm" | "offsec" | "immersive" | "local";

export interface TargetDifficulty { level: 1 | 2 | 3 | 4 | 5; label: string; }
export interface TargetEmblem { avatar?: string | null; hue?: number | null; }
export interface Target {
  platform: PlatformId;
  kind: string;                 // "box" | "room" | "lab" | "target" | "host"
  name: string;
  slug?: string;
  os?: string;
  difficulty?: TargetDifficulty | null;
  emblem?: TargetEmblem;
  url?: string | null;
}
// Session gains:  target?: Target;

export type ObjectiveStatus = "untouched" | "attempted" | "reached" | "proven";
// GoldenObjective gains (all optional): status?, finding_refs?: string[], proven_by_seq?: number | null

export type FindingKind =
  | "port" | "service" | "version" | "cred" | "url" | "path" | "host" | "hash" | "vuln" | "flag";
export interface Finding {
  id: string;
  kind: FindingKind;
  value: string;
  masked?: boolean;
  source_seq: number;
  used_by_seq?: number[];
  tactic?: string;
  proven?: boolean;
  confidence?: number;
}
// WatcherReport gains:  findings?: Finding[];
```

### 4.5 Migration

Old `1.0`/`1.1` reports load as-is (all new fields absent → treated as `undefined`). A tiny lift function `liftReport(report): WatcherReport` (in `src/lib/finalize.ts` or a new `src/lib/migrate.ts`) upgrades `schema_version` to `"1.2"` and derives `session.target` from `session.machine` via the HTB adapter when a report is (re)processed — but **never** required at read time. `assembleReport` stamps `"1.2"` going forward.

---

## 5. The PlatformAdapter contract

New module tree: `src/lib/platform/`.

```ts
// src/lib/platform/types.ts
import type { Machine, Target, PlatformId, NoiseBaseline } from "../../types/report";
import type { GoldenObjective } from "../../types/report";

export interface DetectContext {
  targetScope?: string;    // session.target_scope, e.g. "HTB::Forge (Medium)"
  contextPath?: string;    // session.context_path, e.g. "cloud:htb:pwnbox"
  targetIps?: string[];    // IPs observed in target_scope / episodes
  platformHint?: PlatformId; // explicit from capture --platform, highest priority
}

export interface NativePathInput {
  target: Target;
  /** Raw platform-native structure the adapter knows how to parse (e.g. pasted THM task list). */
  raw?: string;
}

export interface PlatformAdapter {
  id: PlatformId;
  label: string;      // "Hack The Box", "TryHackMe", "OffSec", "Immersive Labs", "Local / CTF"
  kindNoun: string;   // "box", "room", "lab", "target", "host"

  /** 0..1 confidence that this session belongs to this platform. */
  detect(ctx: DetectContext): number;

  /** Resolve neutral identity. Must always return a Target (never throw). */
  identify(machine: Machine | undefined, ctx: DetectContext): Target;

  /** Native intended path where the platform is structured; return null to fall back to write-up extraction. */
  intendedPath?(input: NativePathInput): Promise<GoldenObjective[] | null>;

  /** Optional calibration overrides. */
  calibration?: {
    noiseBaseline?: (target: Target) => NoiseBaseline | undefined;
    difficultyColor?: (label: string) => string | undefined;
  };
}
```

```ts
// src/lib/platform/index.ts
export const ADAPTERS: PlatformAdapter[] = [htbAdapter, thmAdapter, offsecAdapter, immersiveAdapter, localAdapter];

/** Pick the adapter with the highest detect() confidence; localAdapter is the guaranteed floor. */
export function resolveAdapter(ctx: DetectContext): PlatformAdapter { /* WP-2 */ }

/** Neutral identity for a report, via the resolved adapter. Replaces machineOf() at call sites. */
export function targetOf(report: WatcherReport): Target { /* WP-3 */ }
```

### 5.1 Detection rules (WP-2)

Priority order inside each `detect()`:

1. `platformHint` exact match → **1.0** (explicit `--platform` from capture wins outright).
2. `contextPath` contains the platform token (`htb`, `thm`, `tryhackme`, `offsec`, `pwnbox`) → **0.9**.
3. `targetScope` prefix/format match (`HTB::`, `THM::`, room/box vocabulary) → **0.8**.
4. `targetIps` in the platform's known VPN CIDRs → **0.6**.
5. otherwise **0.0**, except `localAdapter` returns a constant floor **0.1** so there is always a winner.

Known CIDRs (document inline; note the HTB/THM overlap and resolve by hint/contextPath):
- **HTB:** `10.10.10.0/24` (retired), `10.129.0.0/16` (release/seasonal).
- **THM:** `10.10.0.0/16`, `10.201.0.0/16` (note `10.10.10.x` overlaps retired HTB — CIDR alone is ambiguous there; hint/contextPath breaks the tie).
- **OffSec / Immersive:** VPN ranges vary per user; rely on `platformHint` + `contextPath`, not CIDR.

---

## 6. Work packages

Each WP: **Goal · Why · Files · Interface/Change · Steps · Acceptance · Tests · Depends on.**

### WP-0 — Baseline & backward-compat harness
- **Goal:** Prove the suite is green before any change, and add the guardrail that keeps old reports valid.
- **Why:** Every later WP relies on "old fixtures still validate" as its safety net; establish it first.
- **Files:** `tests/schema.test.ts` (extend), `fixtures/` (inspect), no source changes.
- **Steps:**
  1. Run `npm test`, `npm run typecheck`, `npm run build`; record the green baseline.
  2. Ensure `tests/schema.test.ts` validates **every** `fixtures/session-*.json` against the schema (loop over the glob, not a single fixture). If it only checks one, generalise it.
  3. Add an explicit test: a hand-written minimal `schema_version: "1.1"` report object (no v1.2 fields) validates and loads through `derive()`/`computeMetrics()` without error.
- **Acceptance:** All four gates green. The v1.1-minimal test exists and passes.
- **Depends on:** —

### WP-1 — Schema v1.2 additive types
- **Goal:** Land the data model in §4 (schema JSON + TS mirror), with zero behaviour change.
- **Why:** Foundation for adapters (Target), tree (objective attrs), and findings.
- **Files:** `schema/watcher-report.schema.json`, `src/types/report.ts`.
- **Change:** Add `session.target`, the three `golden_dag` item attrs, and top-level `findings` (§4.1–4.4). None added to any `required`. Bump nothing that's already `1.2`-listed.
- **Steps:**
  1. Add schema properties exactly as §4 specifies. Keep `additionalProperties: false` everywhere.
  2. Mirror in `src/types/report.ts`: add `PlatformId`, `Target*`, `ObjectiveStatus`, `Finding*`; extend `Session`, `GoldenObjective`, `WatcherReport` with the optional fields.
  3. Add one **new** fixture `fixtures/session-thm-example.json` at `schema_version: "1.2"` exercising `session.target`, an objective with `status`/`proven_by_seq`, and 2–3 `findings`. (Content can be synthetic but realistic.)
- **Acceptance:** Schema test validates old fixtures **and** the new v1.2 fixture. `tsc` green. No runtime code reads the new fields yet (grep to confirm).
- **Tests:** Schema round-trip for the new fixture; a type-level test (or `tsc`) that `Finding`/`Target` compile.
- **Depends on:** WP-0.

### WP-2 — PlatformAdapter seam + HTB adapter + detection
- **Goal:** Introduce `src/lib/platform/` with the contract (§5), the registry, `resolveAdapter`, and a **HTB adapter that reproduces today's identity exactly**, plus `localAdapter` as the floor.
- **Why:** The seam everything else hangs on; HTB-first guarantees no regression.
- **Files (new):** `src/lib/platform/types.ts`, `src/lib/platform/index.ts`, `src/lib/platform/htb.ts`, `src/lib/platform/local.ts`, `src/lib/platform/detect.ts`, plus stubs `src/lib/platform/{thm,offsec,immersive}.ts` (detect + identify + write-up fallback only; `intendedPath` returns null for now except THM in WP-6).
- **Interface:** §5. `htbAdapter.identify()` must return the same `name/os/difficulty/avatar` that `machineOf()` produces today (port that logic, mapping HTB `Easy/Medium/Hard/Insane` → `difficulty.level` 1/2/3/5 and `label`).
- **Steps:**
  1. Implement `detect.ts` with the CIDR table + `ipsInScope(scope)` helper and the priority rules (§5.1).
  2. `htb.ts`: `identify` ports `machineOf` HTB branch; `kind: "box"`; `emblem.avatar` from `machine.avatar`, `emblem.hue` from `hueFor(name)`; `url` = `https://app.hackthebox.com/machines/<slug|name>`; `calibration.difficultyColor` from the existing `DIFFICULTY_COLOR`.
  3. `local.ts`: floor adapter, `kind: "host"`, name from `target_scope`, no avatar, hue fallback.
  4. `index.ts`: `ADAPTERS`, `resolveAdapter(ctx)` = max `detect`; ties broken by registry order with HTB before THM (documented). Do **not** wire into the store yet — that's WP-3.
- **Acceptance:** For every existing fixture, `htbAdapter.identify(machineOf-inputs)` yields a `Target` whose `name/os/difficulty.label` equal today's `machineOf()` output. `resolveAdapter` returns `htb` for an `HTB::`/`pwnbox` context and `local` for a bare scope.
- **Tests:** `platform/detect.test.ts` (CIDR + hint + contextPath cases, incl. the HTB/THM `10.10.10` overlap resolving to HTB via contextPath); `platform/htb.test.ts` (identity parity vs `machineOf`).
- **Depends on:** WP-1.

### WP-3 — Neutral identity migration (`targetOf`) + consumer cutover
- **Goal:** Route all identity through `targetOf(report)` (adapter-backed); keep `machineOf` as a thin deprecated shim so nothing breaks mid-migration.
- **Why:** Removes the HTB assumption from the presentation layer; gives components platform-correct vocabulary ("room"/"lab" not "box").
- **Files:** `src/lib/platform/index.ts` (`targetOf`), `src/lib/machine.ts` (keep `machineOf`, reimplement it to delegate to `targetOf` + map back to `MachineMeta` for callers not yet migrated), and consumers: `src/components/{IdentityBar,MachineAvatar,WriteupControl,WriteupGate,LiveBridge,History,SessionFacts}.tsx`, `src/store/report.ts` (`SessionCard.machine` → add `target`), `src/lib/llm/coach.ts`.
- **Steps:**
  1. Implement `targetOf(report)`: build `DetectContext` from `session`, `resolveAdapter`, `adapter.identify(session.machine, ctx)`; prefer an already-present `session.target` if set.
  2. Reimplement `machineOf` to call `targetOf` and down-map to the legacy `MachineMeta` shape (so un-migrated callers keep working). Mark `@deprecated`.
  3. Migrate `IdentityBar`, `MachineAvatar`, `WriteupGate` to consume `Target` directly; use `adapter.kindNoun` for the noun in copy (e.g. "This room", "This box"). `MachineAvatar` takes `Target` (accept `emblem.hue`/`avatar`).
  4. `store/report.ts`: `SessionCard` gains `target: Target`; `toCard` sets it via `targetOf`; keep `machine` for now. Replace the `htb:` live-session id prefix with a **platform-derived** prefix `${target.platform}:${uuid}` (update `History.tsx:104` and `store` `ingestLiveReport`). Keep reading old `htb:`-prefixed ids (don't hard-fail on prefix).
- **Acceptance:** App renders identically for every HTB fixture (visual parity — hero name, difficulty colour, avatar). A synthetic THM `session.target` renders "room" vocabulary. `machineOf` still compiles and returns correct values for any un-migrated caller. No component imports `machineOf` for *new* code.
- **Tests:** `platform/target.test.ts` (targetOf over htb + thm + local fixtures); update any snapshot/DOM tests touching identity copy.
- **Depends on:** WP-2.

### WP-4 — Deterministic findings extraction stage
- **Goal:** New pure pipeline stage that turns episodes into `Finding[]`, wired into `runPipeline` and surfaced on `report.findings`. Deterministic, redaction-aware.
- **Why:** G4 — the evidence ledger and the enum→finding→action causal chain; the salient-state digest the research calls for.
- **Files (new):** `src/lib/pipeline/findings.ts`, `src/lib/pipeline/findings.test.ts`. **Edit:** `src/lib/pipeline/index.ts` (call the stage), `src/lib/pipeline/ingest.ts` (`assembleReport` writes `findings`), `src/types/report.ts` (already has `Finding` from WP-1).
- **Interface:**
  ```ts
  export function extractFindings(episodes: Episode[], profile: RedactionProfile): Finding[];
  ```
- **Algorithm (deterministic, seq order):**
  1. For each episode, run kind detectors over `output_digest` (and `cmd` where noted). Detectors (extend as tests demand, but ship at least these):
     - **port** — `/(\d{1,5})\/(tcp|udp)\s+open(?:\s+(\S+))?/g` → id `port:<n>-<proto>`, value `"<n>/<proto>"`, `service` capture → also emit a **service** finding when present.
     - **version** — service/version banners on the same nmap line → `version` finding, `confidence` lower.
     - **url** — `/https?:\/\/[^\s"']+/g` → id `url:<8-hex hash of url>`.
     - **path** — interesting web paths from gobuster/ffuf `Status: 200/301` lines.
     - **host** — hostnames from `/etc/hosts` edits, vhosts, TLS CN.
     - **cred** — `key=value`, `user:pass`, `Authorization:` patterns → `cred`.
     - **hash** — `/\b[a-f0-9]{32,}\b/`, `$1$`/`$6$`/`$y$` shadow forms → `hash`.
     - **flag** — presence of `user.txt`/`root.txt`/`proof.txt` reads, or a 32-hex flag token in output → `flag`, `proven: true` **iff** the flag value actually appears in that episode's output (observed), else `proven: false`.
     - **vuln** — CVE tokens `/CVE-\d{4}-\d+/` or `searchsploit`/`msf` module names → `vuln`.
  2. **source_seq** = the episode the detector fired on.
  3. **used_by_seq** = later episodes whose `cmd` contains the finding's value token (equality on a tokenised match, mirroring `align.ts::firstWord` discipline to avoid substring false-hits).
  4. **Redaction:** if `profile === "public_safe"` and `kind ∈ {cred, hash, flag}`, replace `value` with a masked form (`••••` + last 2 chars, or `redactText`) and set `masked: true`. Under `"full"`, values are stored raw **but the episode output_digest was already redacted upstream** — never re-introduce a secret the digest didn't contain.
  5. **Dedup** by `id`; merge `used_by_seq`.
- **Steps:** Implement the stage as a pure function; call it in `runPipeline` after `frameworks`, before `align` (align will consume findings in WP-5). `assembleReport` sets `findings` on the report.
- **Acceptance:** Given a fixture with nmap + gobuster + a flag read, `extractFindings` returns the expected ports/urls/flag with correct `source_seq`/`used_by_seq`; the flag is `proven: true` only when observed. `public_safe` masks creds/hashes/flags. Re-running yields byte-identical output (determinism test). Existing metrics unchanged (findings don't feed metrics yet).
- **Tests:** `findings.test.ts` — one case per detector, a causal-chain case (`used_by_seq`), a redaction case, a determinism case (run twice, `deepEqual`).
- **Depends on:** WP-1.

### WP-5 — Objective-tree attributes: status + claimed-vs-proven
- **Goal:** Populate `status`, `finding_refs`, `proven_by_seq` on objectives during alignment; make coverage distinguish reached vs proven.
- **Why:** G3 + G5 — the PTT-style attributed tree and the "no proof, no points" rule.
- **Files:** `src/lib/pipeline/align.ts`, `src/lib/pipeline/align.test.ts`, `src/lib/metrics.ts` (coverage), `src/store/report.ts` (`applyGoldenDag` re-derives these), `src/lib/pipeline/ingest.ts` (`deriveCoaching` may reference proven).
- **Change to `alignEpisodes`:** after the existing three passes, compute per objective:
  - `status`:
    - `proven` if there is a `finding_ref` of kind `flag` with `proven: true`, **or** an observed shell/privilege proof for this objective's tactic (see proof rules below), **and** `user_satisfied_by_seq != null`.
    - else `reached` if `user_satisfied_by_seq != null`.
    - else `attempted` if some episode had an `equivalenceIndex >= 0` for this objective but was consumed by an earlier objective or was low-yield/failed (i.e. the learner tried the tactic here but didn't land it).
    - else `untouched`.
  - `finding_refs`: ids of findings whose `source_seq` or `used_by_seq` intersect the objective's satisfier (and dependency) episodes.
  - `proven_by_seq`: the seq carrying the proof, else null.
- **Proof rules (deterministic):**
  - **flag objectives** (`capture_root`, `capture_user`, `read *flag*`): proven iff a `flag` finding with `proven: true` is linked.
  - **privilege escalation to root** (`TA0004` + objective matches `/root|admin|system/i`): proven iff an episode after the satisfier shows `uid=0`/`euid=0`/`# ` root prompt / `whoami` → `root` in its `output_digest`.
  - **foothold/shell** (`TA0002`): proven iff a shell establishment is observed (a reverse-shell listener connect line, or a subsequent on-target `context_path` change indicating an interactive session).
  - Everything else: `reached` is the ceiling (can't be "proven" without observable proof).
- **Coverage:** add to `metrics` computation a `proven_coverage_pct` **only if** you also add it to schema/types (optional). *Minimal path:* keep `objective_coverage_pct` = reached-or-better / total (unchanged denominator, so old numbers don't move for reports without proof signals), and expose proven via the objective `status` for the UI. **Do not silently change existing coverage semantics** — if you add a proven metric, add a new field, don't repurpose the old one.
- **Acceptance:** For the demo Forge fixture, objectives that were satisfied get `status: "reached"`, and the root capture with an observed flag gets `status: "proven"` + `proven_by_seq` set. A run that "claims" root by editing a file but never reads the flag stays `reached`, not `proven`. `applyGoldenDag` in the store recomputes statuses when a write-up is applied. Existing `objective_coverage_pct` values for current fixtures are unchanged.
- **Tests:** `align.test.ts` additions — proven vs reached vs attempted vs untouched; finding_refs wiring; a "claimed-not-proven" case; determinism.
- **Depends on:** WP-1, WP-4.

### WP-6 — TryHackMe adapter (native intended path + detect) + capture `--platform`
- **Goal:** THM works end to end as the proof of the seam: CIDR/hint detection, `kind: "room"`, and a **native** Objective Tree parsed from THM's task structure (no prose write-up needed), with a graceful write-up fallback.
- **Why:** G6 — validates that guided platforms supply the tree natively, which is the whole thesis.
- **Files:** `src/lib/platform/thm.ts` (fill in `intendedPath`), `src/lib/platform/thm.test.ts`, `src/components/WriteupGate.tsx` / `WriteupControl.tsx` (offer "Paste THM tasks" when platform = thm), `src/lib/writeup/index.ts` (route native adapters before LLM extraction), and Rust: `crates/capture/src/main.rs` (`--platform`, `--target` flags → `provenance.platform`, `session.target_scope`).
- **`thmAdapter.intendedPath(input)`:** parse a pasted THM room task list (the platform structures rooms as `Task N — Title`, with numbered questions/answers) into `GoldenObjective[]`:
  - Each Task → one objective; `objective` = snake_case of the task title; `tactic` inferred from task keywords via the existing heuristic detectors in `writeup/extract.ts` (reuse them); `satisfied_by` from tool mentions in the task body; `depends_on` = previous task (linear spine, as THM tasks are ordered).
  - Return null if the paste doesn't look like THM tasks (fall back to `goldenFromText`).
- **Detection:** `detect` returns 0.9 on `contextPath`/`platformHint` `thm`/`tryhackme`; 0.8 on `THM::` scope; 0.6 on THM CIDRs (with the documented HTB overlap caveat).
- **Capture (Rust):** add `--platform <id>` and `--target <name>` args mirroring the existing `--machine` handling in `machine_arg`/`build_base_report`; write `provenance.platform` on envelopes and a neutral `target_scope`. Keep `--machine` working as an HTB alias.
- **Acceptance:** A pasted THM task list produces a linear Objective Tree without any LLM; the report renders with "room" vocabulary and THM identity; alignment/coverage work over it. `--platform thm --target <room>` capture produces a report that `resolveAdapter` classifies as THM. HTB path unchanged.
- **Tests:** `thm.test.ts` — task-list → tree parsing; detection cases; fallback-to-writeup when paste isn't tasks. A Rust unit test for the new flags if the crate has a test harness; otherwise a fixture-level assertion.
- **Depends on:** WP-2, WP-5.

### WP-7 — Minimal proven/findings surfacing (no redesign)
- **Goal:** Make `status: "proven"` and the findings ledger *visible* in the existing UI, with the smallest possible change. **No layout redesign.**
- **Why:** So the new data is usable now; the real redesign is sub-project 3.
- **Files:** `src/components/PathComparison.tsx` (proven check/badge on objectives), `src/components/PhaseAudit.tsx` (proven marker where objectives list), optionally a compact findings list in an existing Details accordion in `src/App.tsx` (reuse `Collapse`).
- **Change:** Add a small "✓ proven" vs "• reached" affordance on objectives (colour via existing tokens: `--color-match` for proven). Add a collapsed "Findings" panel listing `report.findings` grouped by kind, each row deep-linking to `source_seq` via the existing `reveal(seq)` store action. Respect `masked` (show `••••`).
- **Acceptance:** Proven objectives are visually distinct from merely-reached ones on the Forge debrief. The findings panel lists extracted findings and clicking one reveals the source command in the Command Log. No existing view moves or restyles beyond these additions.
- **Tests:** A component/DOM test that a proven objective renders the proven affordance and a reached one does not; a findings-row deep-link test (`reveal` called with the right seq).
- **Depends on:** WP-5 (and WP-4 for findings).

### WP-8 — Adapter conformance kit + wiring + docs
- **Goal:** A conformance harness that every `PlatformAdapter` must pass (mirroring the existing `plugins/` conformance kit and `npm run conformance`), plus final wiring in `assembleReport`/store to set `session.target` and choose native intended path, plus README/CAPTURE doc updates.
- **Why:** Makes "any other training platform" a matter of writing an adapter that passes the kit; closes the loop.
- **Files (new):** `src/lib/platform/conformance.ts`, `scripts/platform-conformance.tsx` (or extend `scripts/conformance.tsx`); **edit:** `src/lib/pipeline/ingest.ts` (set `session.target` via `targetOf` at assemble time; call `adapter.intendedPath` before falling back to write-up), `src/store/report.ts` (native-path route in the write-up gate flow), `README.md`, `crates/capture/CAPTURE.md`.
- **Conformance checks per adapter:** `detect` returns 0..1 and never throws; `identify` always returns a `Target` with required fields for `undefined` machine + empty context; `kindNoun`/`label` non-empty; `intendedPath` (if present) returns `null` or a valid topologically-ordered `GoldenObjective[]`; `calibration` outputs (if present) are well-formed.
- **Acceptance:** `npm run` conformance passes for all five adapters. `assembleReport` output now carries `session.target`. A fresh THM capture routes through `thmAdapter.intendedPath` before any write-up prompt. Docs describe adding a new platform in ≤1 page.
- **Tests:** conformance runner asserts all adapters pass; an ingest test that `session.target` is populated for htb + thm inputs.
- **Depends on:** WP-2, WP-3, WP-6.

---

## 7. Testing strategy (whole sub-project)

- **Unit (Vitest):** every new pure function (`detect`, `identify`, `extractFindings`, tree-status in `align`, THM task parsing) has direct tests. Determinism tests (`run twice → deepEqual`) for `extractFindings` and the align additions.
- **Schema round-trip:** `tests/schema.test.ts` validates all fixtures incl. the new v1.2 fixture, every WP.
- **Parity:** WP-2/WP-3 assert HTB identity is byte-for-byte what `machineOf` produced (no visual regression).
- **Backward-compat:** the v1.1-minimal report from WP-0 keeps loading through the whole sub-project.
- **Integration:** WP-6 THM path from capture flags → report; WP-8 conformance for all adapters.
- **Gate per WP:** `npm test && npm run typecheck && npm run build` all green before the WP is done.

---

## 8. Redaction & privacy (applies throughout)

- Findings values are subject to `redaction_profile`. Under `public_safe`, `cred`/`hash`/`flag` values are masked (`masked: true`). Under `full`, values are only ever as revealing as the already-redacted `output_digest` they came from — **never** re-derive a secret from raw bytes (the pipeline never sees raw bytes; `ingest.ts` redacts on the way in).
- No new outbound request is introduced. THM native-path parsing operates on text the user pasted (same privacy posture as the existing write-up path). Adapter `detect` uses only local session metadata.
- `session.target.url` is a *constructed* canonical URL (no fetch); opening it uses the existing `openExternal`.

---

## 9. Dependency graph & suggested order

```
WP-0  (baseline/guardrail)
  └─▶ WP-1  (schema v1.2 types)
        ├─▶ WP-2  (adapter seam + HTB + detect)
        │     ├─▶ WP-3  (targetOf + consumer cutover)
        │     └─▶ WP-6  (THM adapter + capture flags)   [also needs WP-5]
        └─▶ WP-4  (findings extraction)
              └─▶ WP-5  (objective tree status + proven)  [needs WP-1 + WP-4]
                    ├─▶ WP-6  (THM)                        [needs WP-2 + WP-5]
                    └─▶ WP-7  (minimal surfacing)          [needs WP-4 + WP-5]
WP-8  (conformance + wiring + docs)                        [needs WP-2 + WP-3 + WP-6]
```

**Recommended linear execution for a single executor:** WP-0 → WP-1 → WP-2 → WP-3 → WP-4 → WP-5 → WP-6 → WP-7 → WP-8. WP-3 and WP-4 are independent after WP-1/WP-2 and may be parallelised if two executors are available.

---

## 10. Risks & mitigations

- **HTB identity regression.** *Mitigation:* WP-2/WP-3 parity tests against `machineOf`; `machineOf` retained as a delegating shim.
- **CIDR ambiguity (HTB/THM `10.10.10`).** *Mitigation:* hint/contextPath outrank CIDR in `detect`; documented; `--platform` is the escape hatch.
- **Coverage semantics drift.** *Mitigation:* WP-5 keeps `objective_coverage_pct` denominator/semantics; proven is exposed via `status`, not by silently changing the number. Any proven metric is a *new* field.
- **Findings false positives polluting the ledger.** *Mitigation:* tokenised equality matching (not substring), `confidence` on weak detectors, deterministic dedup, and tests per detector.
- **Schema `additionalProperties: false` breakage.** *Mitigation:* every new field declared in the schema in WP-1 before any producer writes it; schema test runs every WP.
- **Scope creep into the redesign.** *Mitigation:* WP-7 is explicitly "minimal surfacing"; the redesign is a separate spec.

---

## Appendix A — Research principle → design mapping

| Principle (source) | Where it lands in this spec |
|---|---|
| Maintain an attributed **task tree**, not a flat log (PentestGPT PTT — arxiv 2308.06782) | WP-1 objective attrs + WP-5 status/tree |
| **Findings as first-class**, attribute-linked (PTT node attributes) | WP-4 findings ledger + WP-5 `finding_refs` |
| **Execution-grounded verification**, claimed≠proven (Big Sleep "perfect verification"; XBOW validation-only; OSCP "no proof, no points") | WP-4 `proven` on flags + WP-5 proof rules |
| **Digest noisy output into salient state** (PentestGPT Parsing; HackingBuddyGPT `analyze_cmd`) | WP-4 `extractFindings` |
| **Windowed live memory + full audit trace** (Cybench last-3; CAI tracing) | validates the live-vs-post split; data laid down here, surfaced in sub-project 3 |
| Separate **strategy / action / observation** (D-CIPHER) | deferred to sub-project 2 grade rubric; `status` (strategy) vs `findings` (observation) split prepares it |
| **Two-audience report**, kill-chain narrative spine (PTES / OSCP / PlexTrac) | deferred to sub-project 3; findings schema (WP-4) is the evidence spine it will consume |

## Appendix B — File-change index (quick reference)

- **Schema/types:** `schema/watcher-report.schema.json`, `src/types/report.ts` — WP-1.
- **Platform seam (new):** `src/lib/platform/{types,index,detect,htb,thm,offsec,immersive,local,conformance}.ts` — WP-2/6/8.
- **Identity consumers:** `src/lib/machine.ts`, `src/components/{IdentityBar,MachineAvatar,WriteupControl,WriteupGate,LiveBridge,History,SessionFacts}.tsx`, `src/store/report.ts`, `src/lib/llm/coach.ts` — WP-3.
- **Pipeline:** `src/lib/pipeline/{findings,index,align,ingest}.ts` — WP-4/5.
- **Metrics:** `src/lib/metrics.ts` — WP-5 (only if adding a new proven field).
- **UI surfacing:** `src/components/{PathComparison,PhaseAudit}.tsx`, `src/App.tsx` — WP-7.
- **Capture (Rust):** `crates/capture/src/main.rs` — WP-6.
- **Docs/scripts:** `README.md`, `crates/capture/CAPTURE.md`, `scripts/conformance.tsx` (or new) — WP-8.
- **Tests:** `tests/schema.test.ts`, `src/lib/platform/*.test.ts`, `src/lib/pipeline/{findings,align}.test.ts`, component tests — every WP.
