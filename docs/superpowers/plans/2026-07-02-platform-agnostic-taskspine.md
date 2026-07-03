# Platform-Agnostic Capture + Task-Tree/Findings Spine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple Watcher from Hack The Box and, in the same pass, upgrade its core data model to an attributed Objective Tree + first-class Findings ledger with claimed-vs-proven verification — proven end-to-end by adding TryHackMe as a second platform.

**Architecture:** A `PlatformAdapter` seam (`src/lib/platform/`) resolves neutral target identity, native intended-paths, and calibration; it touches only ingest/identity/calibration and leaves the deterministic pipeline (`segment → mitre → frameworks → align`) platform-blind. A new deterministic `extractFindings` stage produces a Findings ledger; `align.ts` gains objective `status` + proof rules. All schema/type changes are additive (schema v1.2) so v1.0/v1.1 reports keep loading.

**Tech Stack:** TypeScript, React 18, Zustand, Tailwind, Vitest, Vite, JSON Schema (2020-12) via the existing `tests/schema.test.ts`, Rust (capture crate, minor).

## Global Constraints

Copied verbatim from the design spec (`docs/superpowers/specs/2026-07-02-platform-agnostic-taskspine-design.md`). Every task's requirements implicitly include these:

- **TDD** — write the failing test first, then the minimal implementation.
- **Green gate between tasks** — before a task is done, all four pass: `npm test`, `npm run typecheck`, `npm run build`, and the schema round-trip in `tests/schema.test.ts`.
- **Additive & backward-compatible** — every schema/type change is optional; a `schema_version: "1.1"` report must still load, validate, and render unchanged. Never delete or repurpose an existing field.
- **Determinism is sacred** — new pipeline stages are pure functions of their input; re-running the same input yields byte-identical output. Models may enrich narrative text only, never a metric.
- **Redaction before persistence** — any field that can hold a secret (cred/hash/flag/live IP) respects `redaction_profile: "public_safe"` before being written.
- **No scope creep** — report visual redesign, the strategy/action/observation grade rubric, longitudinal/cohort views are later sub-projects. This plan lays down data + minimal surfacing only (Task 10).
- **`additionalProperties: false`** everywhere in the schema — every new field must be declared in the schema before any producer writes it, or fixtures fail validation.
- **Test runner commands:** whole suite `npm test`; single file `npx vitest run <path>`; single test `npx vitest run <path> -t "<name>"`; types `npm run typecheck`; bundle `npm run build`.

---

## File Structure

**New — platform seam (`src/lib/platform/`):**
- `types.ts` — `PlatformAdapter`, `DetectContext`, `NativePathInput` interfaces.
- `detect.ts` — CIDR table, IP helpers, confidence scoring.
- `index.ts` — `ADAPTERS` registry, `resolveAdapter()`, `targetOf()`.
- `htb.ts` — Hack The Box adapter (reproduces today's identity exactly).
- `thm.ts` — TryHackMe adapter (native task-tree intended path).
- `offsec.ts`, `immersive.ts` — detection + identity + write-up fallback only.
- `local.ts` — floor adapter (bare local/CTF host).
- `conformance.ts` — adapter conformance checks.

**New — pipeline stage:**
- `src/lib/pipeline/findings.ts` — deterministic findings extraction.

**Modified:**
- `schema/watcher-report.schema.json`, `src/types/report.ts` — schema v1.2 additive types.
- `src/lib/pipeline/{index,align,ingest}.ts` — wire findings + objective status.
- `src/lib/metrics.ts` — (only if a new proven metric is added).
- `src/lib/machine.ts` — `machineOf` becomes a delegating shim over `targetOf`.
- `src/store/report.ts` — `SessionCard` gains `target`; platform-derived live-session id prefix.
- `src/components/{IdentityBar,MachineAvatar,WriteupControl,WriteupGate,LiveBridge,History,SessionFacts,PathComparison,PhaseAudit}.tsx`, `src/App.tsx` — identity cutover + minimal surfacing.
- `crates/capture/src/main.rs` — `--platform`/`--target` flags.
- `tests/schema.test.ts`, `README.md`, `crates/capture/CAPTURE.md`, `scripts/conformance.tsx`.

**New fixtures:**
- `fixtures/session-thm-example.json` — a `schema_version: "1.2"` fixture exercising `session.target`, objective status, and findings.

---

## Task 1: Baseline & backward-compat harness (WP-0)

**Files:**
- Modify: `tests/schema.test.ts`
- Inspect: `fixtures/session-*.json`

**Interfaces:**
- Consumes: nothing.
- Produces: a proven-green baseline and a guardrail test asserting a minimal v1.1 report loads through `computeMetrics`/`derive`.

- [ ] **Step 1: Record the green baseline**

Run each and confirm all pass (this is the reference point every later task must return to):
```bash
npm test
npm run typecheck
npm run build
```
Expected: all pass. If any fail on a clean checkout, STOP and report — do not build on a red baseline.

- [ ] **Step 2: Confirm the schema test validates ALL fixtures**

Read `tests/schema.test.ts`. If it validates only one fixture, generalize it to loop over every fixture:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const schema = JSON.parse(readFileSync("schema/watcher-report.schema.json", "utf8"));
const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const validate = ajv.compile(schema);

describe("watcher-report schema", () => {
  const dir = "fixtures";
  const files = readdirSync(dir).filter((f) => /^session-.*\.json$/.test(f));
  it("has fixtures to validate", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(`validates ${f}`, () => {
      const doc = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const ok = validate(doc);
      if (!ok) console.error(f, validate.errors);
      expect(ok).toBe(true);
    });
  }
});
```
(Adapt imports to the file's existing Ajv setup — do not add new deps if it already imports Ajv differently.)

- [ ] **Step 3: Write the backward-compat guardrail test**

Create `src/lib/migrate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeMetrics } from "./metrics";
import type { WatcherReport } from "../types/report";

const minimalV11: WatcherReport = {
  schema_version: "1.1",
  session: { uuid: "00000000-0000-4000-8000-000000000000", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:10:00Z", target_scope: "HTB::Example (Easy)", shell: "bash", source: "local_pty" },
  episodes: [{ seq: 0, cmd: "nmap 10.129.1.1", binary: "nmap", duration_ms: 1000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007" }],
  phases: [],
  golden_dag: [],
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 1 },
  coaching: { skill_radar: { recon: 50, web: 50, exploit: 50, privesc: 50, opsec: 100 }, next_steps: [] },
  redaction_profile: "full",
};

describe("backward compat", () => {
  it("loads a minimal v1.1 report with no v1.2 fields through computeMetrics", () => {
    const m = computeMetrics(minimalV11);
    expect(m).toBeTruthy();
    expect(typeof m.efficiency_pct).toBe("number");
  });
});
```

- [ ] **Step 4: Run the new test, confirm green**

Run: `npx vitest run src/lib/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add tests/schema.test.ts src/lib/migrate.test.ts
git commit -m "test: schema validates all fixtures + v1.1 backward-compat guardrail"
```

---

## Task 2: Schema v1.2 additive types + fixture (WP-1)

**Files:**
- Modify: `schema/watcher-report.schema.json`
- Modify: `src/types/report.ts`
- Create: `fixtures/session-thm-example.json`
- Create: `src/types/report.test.ts` (compile/shape guard)

**Interfaces:**
- Produces (relied on by every later task):
  - `PlatformId = "htb" | "thm" | "offsec" | "immersive" | "local"`
  - `Target { platform: PlatformId; kind: string; name: string; slug?: string; os?: string; difficulty?: TargetDifficulty | null; emblem?: TargetEmblem; url?: string | null }`
  - `TargetDifficulty { level: 1|2|3|4|5; label: string }`, `TargetEmblem { avatar?: string | null; hue?: number | null }`
  - `Session.target?: Target`
  - `ObjectiveStatus = "untouched" | "attempted" | "reached" | "proven"`
  - `GoldenObjective.status?: ObjectiveStatus`, `.finding_refs?: string[]`, `.proven_by_seq?: number | null`
  - `FindingKind = "port"|"service"|"version"|"cred"|"url"|"path"|"host"|"hash"|"vuln"|"flag"`
  - `Finding { id: string; kind: FindingKind; value: string; masked?: boolean; source_seq: number; used_by_seq?: number[]; tactic?: string; proven?: boolean; confidence?: number }`
  - `WatcherReport.findings?: Finding[]`

- [ ] **Step 1: Add the schema properties**

In `schema/watcher-report.schema.json`, add to `session.properties` (sibling of `machine`):
```json
"target": {
  "type": "object",
  "description": "Neutral, platform-agnostic target identity (schema v1.2). Supersedes session.machine; machine is retained for back-compat.",
  "additionalProperties": false,
  "properties": {
    "platform": { "type": "string", "enum": ["htb", "thm", "offsec", "immersive", "local"] },
    "kind": { "type": "string" },
    "name": { "type": "string" },
    "slug": { "type": "string" },
    "os": { "type": "string" },
    "difficulty": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "properties": {
        "level": { "type": "integer", "minimum": 1, "maximum": 5 },
        "label": { "type": "string" }
      }
    },
    "emblem": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "avatar": { "type": ["string", "null"] },
        "hue": { "type": ["integer", "null"], "minimum": 0, "maximum": 360 }
      }
    },
    "url": { "type": ["string", "null"] }
  }
}
```
Add to `golden_dag.items.properties`:
```json
"status": { "type": "string", "enum": ["untouched", "attempted", "reached", "proven"] },
"finding_refs": { "type": "array", "items": { "type": "string" } },
"proven_by_seq": { "type": ["integer", "null"] }
```
Add as a new top-level property (NOT to `required`):
```json
"findings": {
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "kind", "value", "source_seq"],
    "additionalProperties": false,
    "properties": {
      "id": { "type": "string" },
      "kind": { "type": "string", "enum": ["port", "service", "version", "cred", "url", "path", "host", "hash", "vuln", "flag"] },
      "value": { "type": "string" },
      "masked": { "type": "boolean" },
      "source_seq": { "type": "integer", "minimum": 0 },
      "used_by_seq": { "type": "array", "items": { "type": "integer", "minimum": 0 } },
      "tactic": { "type": "string", "pattern": "^TA[0-9]{4}$" },
      "proven": { "type": "boolean" },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
    }
  }
}
```

- [ ] **Step 2: Mirror the types in `src/types/report.ts`**

Add near the top:
```ts
export type PlatformId = "htb" | "thm" | "offsec" | "immersive" | "local";
export interface TargetDifficulty { level: 1 | 2 | 3 | 4 | 5; label: string; }
export interface TargetEmblem { avatar?: string | null; hue?: number | null; }
export interface Target {
  platform: PlatformId;
  kind: string;
  name: string;
  slug?: string;
  os?: string;
  difficulty?: TargetDifficulty | null;
  emblem?: TargetEmblem;
  url?: string | null;
}
export type ObjectiveStatus = "untouched" | "attempted" | "reached" | "proven";
export type FindingKind = "port" | "service" | "version" | "cred" | "url" | "path" | "host" | "hash" | "vuln" | "flag";
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
```
Extend `Session` with `target?: Target;`. Extend `GoldenObjective` with `status?: ObjectiveStatus; finding_refs?: string[]; proven_by_seq?: number | null;`. Extend `WatcherReport` with `findings?: Finding[];`.

- [ ] **Step 3: Create the v1.2 fixture**

Create `fixtures/session-thm-example.json`:
```json
{
  "schema_version": "1.2",
  "session": {
    "uuid": "11111111-1111-4111-8111-111111111111",
    "started_at": "2026-06-01T12:00:00Z",
    "ended_at": "2026-06-01T12:40:00Z",
    "target_scope": "THM::Blue (Easy)",
    "context_path": "cloud:thm:openvpn",
    "shell": "bash",
    "source": "local_pty",
    "target": { "platform": "thm", "kind": "room", "name": "Blue", "os": "Windows", "difficulty": { "level": 1, "label": "Easy" }, "emblem": { "avatar": null, "hue": 210 }, "url": "https://tryhackme.com/room/blue" }
  },
  "episodes": [
    { "seq": 0, "cmd": "nmap -sV 10.10.1.5", "binary": "nmap", "duration_ms": 8000, "gap_before_ms": 0, "actor": "machine_bound", "tactic": "TA0007", "technique": "T1046", "output_digest": "445/tcp open microsoft-ds", "alignment": "match" },
    { "seq": 1, "cmd": "cat root.txt", "binary": "cat", "duration_ms": 200, "gap_before_ms": 60000, "actor": "machine_bound", "tactic": "TA0004", "output_digest": "THM{redacted}", "alignment": "match" }
  ],
  "phases": [],
  "golden_dag": [
    { "objective": "enumerate_services", "tactic": "TA0007", "satisfied_by": ["nmap"], "user_satisfied_by_seq": 0, "status": "reached", "finding_refs": ["port:445-tcp"] },
    { "objective": "capture_root", "tactic": "TA0004", "satisfied_by": ["read root flag"], "depends_on": ["enumerate_services"], "user_satisfied_by_seq": 1, "status": "proven", "proven_by_seq": 1, "finding_refs": ["flag:root"] }
  ],
  "metrics": { "efficiency_pct": 90, "time_waster": { "productive_ms": 8200, "detour_ms": 0, "stuck_ms": 0, "loop_ms": 0, "t_active_ms": 68200 }, "stealth_score": 88, "objective_coverage_pct": 100, "technique_breadth": 1 },
  "coaching": { "skill_radar": { "recon": 80, "web": 50, "exploit": 60, "privesc": 70, "opsec": 88 }, "next_steps": [] },
  "findings": [
    { "id": "port:445-tcp", "kind": "port", "value": "445/tcp", "source_seq": 0, "tactic": "TA0007" },
    { "id": "flag:root", "kind": "flag", "value": "THM{redacted}", "source_seq": 1, "proven": true }
  ],
  "redaction_profile": "public_safe"
}
```

- [ ] **Step 4: Write the type-shape guard test**

Create `src/types/report.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { Finding, Target } from "./report";

describe("v1.2 types", () => {
  it("Target and Finding are constructible", () => {
    const t: Target = { platform: "thm", kind: "room", name: "Blue" };
    const f: Finding = { id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 };
    expect(t.platform).toBe("thm");
    expect(f.kind).toBe("port");
  });
});
```

- [ ] **Step 5: Run schema + type tests**

Run: `npx vitest run tests/schema.test.ts src/types/report.test.ts`
Expected: PASS, including the new `session-thm-example.json`. Also run `npm run typecheck`.

- [ ] **Step 6: Confirm no runtime code reads the new fields yet**

Run: `git grep -nE "\.findings\b|\.target\b|proven_by_seq|finding_refs" -- src | grep -v ".test." | grep -v "types/report.ts"`
Expected: no matches in runtime source (types-only change so far).

- [ ] **Step 7: Commit**
```bash
git add schema/watcher-report.schema.json src/types/report.ts fixtures/session-thm-example.json src/types/report.test.ts
git commit -m "feat: schema v1.2 additive types (target, objective status, findings)"
```

---

## Task 3: Platform detection (WP-2, part 1)

**Files:**
- Create: `src/lib/platform/detect.ts`
- Create: `src/lib/platform/detect.test.ts`

**Interfaces:**
- Consumes: `PlatformId` (Task 2).
- Produces:
  - `DetectContext { targetScope?: string; contextPath?: string; targetIps?: string[]; platformHint?: PlatformId }`
  - `ipsInScope(scope?: string): string[]`
  - `ipInCidr(ip: string, cidr: string): boolean`
  - `cidrConfidence(ips: string[], id: PlatformId): number`
  - `CIDRS: Record<PlatformId, string[]>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/platform/detect.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ipInCidr, ipsInScope, cidrConfidence } from "./detect";

describe("detect helpers", () => {
  it("matches an IP inside a CIDR and rejects one outside", () => {
    expect(ipInCidr("10.129.4.9", "10.129.0.0/16")).toBe(true);
    expect(ipInCidr("10.10.1.5", "10.10.0.0/16")).toBe(true);
    expect(ipInCidr("192.168.1.1", "10.129.0.0/16")).toBe(false);
  });
  it("extracts IPv4 addresses from a scope string", () => {
    expect(ipsInScope("THM::Blue 10.10.1.5")).toEqual(["10.10.1.5"]);
    expect(ipsInScope("no ips here")).toEqual([]);
  });
  it("scores CIDR confidence per platform", () => {
    expect(cidrConfidence(["10.129.4.9"], "htb")).toBeCloseTo(0.6);
    expect(cidrConfidence(["10.201.2.2"], "thm")).toBeCloseTo(0.6);
    expect(cidrConfidence(["192.168.1.1"], "htb")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/platform/detect.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `detect.ts`**

```ts
import type { PlatformId } from "../../types/report";

export interface DetectContext {
  targetScope?: string;
  contextPath?: string;
  targetIps?: string[];
  platformHint?: PlatformId;
}

/** Known VPN CIDR ranges. HTB 10.10.10.x overlaps retired THM space — CIDR alone is ambiguous there,
 *  broken by platformHint/contextPath in the adapters. */
export const CIDRS: Record<PlatformId, string[]> = {
  htb: ["10.10.10.0/24", "10.129.0.0/16"],
  thm: ["10.10.0.0/16", "10.201.0.0/16"],
  offsec: [],
  immersive: [],
  local: [],
};

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

export function ipsInScope(scope?: string): string[] {
  if (!scope) return [];
  return scope.match(IPV4) ?? [];
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + (Number(o) & 255), 0) >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask);
}

/** 0.6 if any provided IP falls in one of the platform's CIDRs, else 0. */
export function cidrConfidence(ips: string[], id: PlatformId): number {
  const ranges = CIDRS[id];
  if (!ranges.length) return 0;
  return ips.some((ip) => ranges.some((c) => ipInCidr(ip, c))) ? 0.6 : 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/platform/detect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/platform/detect.ts src/lib/platform/detect.test.ts
git commit -m "feat: platform detection helpers (CIDR + scope IP extraction)"
```

---

## Task 4: Adapter contract + HTB/local adapters + registry (WP-2, part 2)

**Files:**
- Create: `src/lib/platform/types.ts`
- Create: `src/lib/platform/htb.ts`
- Create: `src/lib/platform/local.ts`
- Create: `src/lib/platform/offsec.ts`, `src/lib/platform/immersive.ts`, `src/lib/platform/thm.ts` (detect+identify only; `intendedPath` filled later)
- Create: `src/lib/platform/index.ts`
- Create: `src/lib/platform/htb.test.ts`
- Reference: `src/lib/machine.ts` (port the identity logic), `src/lib/machine.ts::hueFor`, `DIFFICULTY_COLOR`

**Interfaces:**
- Consumes: `DetectContext`, `cidrConfidence`, `ipsInScope` (Task 3); `Machine`, `Target`, `GoldenObjective`, `NoiseBaseline`, `PlatformId` (Task 2).
- Produces:
  - `PlatformAdapter` interface (see spec §5)
  - `NativePathInput { target: Target; raw?: string }`
  - `ADAPTERS: PlatformAdapter[]`
  - `resolveAdapter(ctx: DetectContext): PlatformAdapter`
  - `htbAdapter`, `localAdapter`, `thmAdapter`, `offsecAdapter`, `immersiveAdapter`

- [ ] **Step 1: Write `types.ts`**

```ts
import type { Machine, Target, GoldenObjective, NoiseBaseline, PlatformId } from "../../types/report";
import type { DetectContext } from "./detect";

export interface NativePathInput {
  target: Target;
  /** Platform-native structure the adapter parses (e.g. a pasted THM task list). */
  raw?: string;
}

export interface PlatformAdapter {
  id: PlatformId;
  label: string;    // "Hack The Box", "TryHackMe", ...
  kindNoun: string; // "box", "room", "lab", "target", "host"
  /** 0..1 confidence this session belongs to this platform. Never throws. */
  detect(ctx: DetectContext): number;
  /** Neutral identity. Always returns a Target, never throws. */
  identify(machine: Machine | undefined, ctx: DetectContext): Target;
  /** Native intended path where the platform is structured; null → fall back to write-up extraction. */
  intendedPath?(input: NativePathInput): Promise<GoldenObjective[] | null>;
  calibration?: {
    noiseBaseline?: (target: Target) => NoiseBaseline | undefined;
    difficultyColor?: (label: string) => string | undefined;
  };
}

export type { DetectContext };
```

- [ ] **Step 2: Write the HTB adapter test (failing)**

Create `src/lib/platform/htb.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { htbAdapter } from "./htb";

describe("htbAdapter", () => {
  it("identifies an HTB box from machine metadata", () => {
    const t = htbAdapter.identify({ name: "Forge", os: "Linux", difficulty: "Medium", avatar: "https://cdn/forge.png" }, {});
    expect(t.platform).toBe("htb");
    expect(t.kind).toBe("box");
    expect(t.name).toBe("Forge");
    expect(t.os).toBe("Linux");
    expect(t.difficulty).toEqual({ level: 2, label: "Medium" });
    expect(t.emblem?.avatar).toBe("https://cdn/forge.png");
    expect(t.url).toContain("hackthebox.com");
  });
  it("falls back to parsing target_scope when machine is absent", () => {
    const t = htbAdapter.identify(undefined, { targetScope: "HTB::Forge (Medium)" });
    expect(t.name).toBe("Forge");
    expect(t.difficulty?.label).toBe("Medium");
  });
  it("detects HTB from a pwnbox context path", () => {
    expect(htbAdapter.detect({ contextPath: "cloud:htb:pwnbox" })).toBeGreaterThanOrEqual(0.9);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/lib/platform/htb.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `htb.ts`**

Port the parsing logic from `src/lib/machine.ts::machineOf` (scope-parse branch) and reuse `hueFor`.
```ts
import type { Machine, Target } from "../../types/report";
import { hueFor } from "../machine";
import type { PlatformAdapter } from "./types";
import { cidrConfidence, ipsInScope, type DetectContext } from "./detect";

const DIFF_LEVEL: Record<string, 1 | 2 | 3 | 4 | 5> = { Easy: 1, Medium: 2, Hard: 4, Insane: 5 };

function parseScope(scope?: string): { name: string; label?: string } {
  const ts = scope ?? "session";
  const name = (ts.includes("::") ? ts.split("::")[1] : ts).split("(")[0].split("—")[0].trim() || ts;
  const label = /\beasy\b/i.test(ts) ? "Easy" : /\bmedium\b/i.test(ts) ? "Medium" : /\bhard\b/i.test(ts) ? "Hard" : /\binsane\b/i.test(ts) ? "Insane" : undefined;
  return { name, label };
}

export const htbAdapter: PlatformAdapter = {
  id: "htb",
  label: "Hack The Box",
  kindNoun: "box",
  detect(ctx: DetectContext) {
    if (ctx.platformHint === "htb") return 1;
    if (/\bhtb|pwnbox|hackthebox\b/i.test(ctx.contextPath ?? "")) return 0.9;
    if (/^htb::/i.test(ctx.targetScope ?? "")) return 0.8;
    return cidrConfidence(ctx.targetIps ?? ipsInScope(ctx.targetScope), "htb");
  },
  identify(machine: Machine | undefined, ctx: DetectContext): Target {
    const scoped = parseScope(ctx.targetScope);
    const name = machine?.name ?? scoped.name;
    const label = machine?.difficulty ?? scoped.label;
    const difficulty = label && DIFF_LEVEL[label] ? { level: DIFF_LEVEL[label], label } : null;
    const slug = machine?.slug ?? name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return {
      platform: "htb",
      kind: "box",
      name,
      slug,
      os: machine?.os,
      difficulty,
      emblem: { avatar: machine?.avatar ?? null, hue: hueFor(name) },
      url: `https://app.hackthebox.com/machines/${slug}`,
    };
  },
  calibration: {
    difficultyColor: (label) => ({ Easy: "var(--color-match)", Medium: "var(--color-signal)", Hard: "var(--color-detour)", Insane: "var(--color-skipped)" }[label]),
  },
};
```

- [ ] **Step 5: Implement `local.ts` (the floor adapter)**

```ts
import type { Machine, Target } from "../../types/report";
import { hueFor } from "../machine";
import type { PlatformAdapter } from "./types";
import type { DetectContext } from "./detect";

export const localAdapter: PlatformAdapter = {
  id: "local",
  label: "Local / CTF",
  kindNoun: "host",
  detect: () => 0.1, // guaranteed floor so resolveAdapter always has a winner
  identify(machine: Machine | undefined, ctx: DetectContext): Target {
    const raw = ctx.targetScope ?? "session";
    const name = machine?.name ?? raw.replace(/\s*\(.*\)\s*/, "").trim() || "Local capture";
    return { platform: "local", kind: "host", name, os: machine?.os, difficulty: null, emblem: { avatar: null, hue: hueFor(name) }, url: null };
  },
};
```

- [ ] **Step 6: Implement stub `thm.ts`, `offsec.ts`, `immersive.ts` (detect + identify only)**

`src/lib/platform/thm.ts`:
```ts
import type { Machine, Target } from "../../types/report";
import { hueFor } from "../machine";
import type { PlatformAdapter } from "./types";
import { cidrConfidence, ipsInScope, type DetectContext } from "./detect";

const DIFF_LEVEL: Record<string, 1 | 2 | 3 | 4 | 5> = { Info: 1, Easy: 1, Medium: 3, Hard: 4, Insane: 5 };

export const thmAdapter: PlatformAdapter = {
  id: "thm",
  label: "TryHackMe",
  kindNoun: "room",
  detect(ctx: DetectContext) {
    if (ctx.platformHint === "thm") return 1;
    if (/\bthm|tryhackme\b/i.test(ctx.contextPath ?? "")) return 0.9;
    if (/^thm::/i.test(ctx.targetScope ?? "")) return 0.8;
    return cidrConfidence(ctx.targetIps ?? ipsInScope(ctx.targetScope), "thm");
  },
  identify(machine: Machine | undefined, ctx: DetectContext): Target {
    const ts = ctx.targetScope ?? "room";
    const name = machine?.name ?? (ts.includes("::") ? ts.split("::")[1] : ts).split("(")[0].trim() || ts;
    const label = machine?.difficulty;
    const difficulty = label && DIFF_LEVEL[label] ? { level: DIFF_LEVEL[label], label } : null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return { platform: "thm", kind: "room", name, slug, os: machine?.os, difficulty, emblem: { avatar: null, hue: hueFor(name) }, url: `https://tryhackme.com/room/${slug}` };
  },
  // intendedPath added in Task 8
};
```
`src/lib/platform/offsec.ts` and `immersive.ts` follow the same shape — `id: "offsec"`/`"immersive"`, `label: "OffSec"`/`"Immersive Labs"`, `kindNoun: "lab"`, `detect` matching `platformHint`/`contextPath`/`^offsec::`/`^immersive::` (no CIDRs), `identify` building a `Target` with `kind: "lab"`, `difficulty: null`, hue fallback, `url: null`. No `intendedPath`.

- [ ] **Step 7: Implement `index.ts` (registry + resolveAdapter)**

```ts
import type { PlatformAdapter } from "./types";
import { htbAdapter } from "./htb";
import { thmAdapter } from "./thm";
import { offsecAdapter } from "./offsec";
import { immersiveAdapter } from "./immersive";
import { localAdapter } from "./local";
import { ipsInScope, type DetectContext } from "./detect";

export * from "./types";
export * from "./detect";

// Order matters for ties: HTB before THM so the 10.10.10.x overlap resolves to HTB by default.
export const ADAPTERS: PlatformAdapter[] = [htbAdapter, thmAdapter, offsecAdapter, immersiveAdapter, localAdapter];

/** Highest detect() confidence wins; localAdapter's 0.1 floor guarantees a winner. */
export function resolveAdapter(ctx: DetectContext): PlatformAdapter {
  const enriched: DetectContext = { ...ctx, targetIps: ctx.targetIps ?? ipsInScope(ctx.targetScope) };
  let best = ADAPTERS[0];
  let bestScore = -1;
  for (const a of ADAPTERS) {
    const s = a.detect(enriched);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}
```

- [ ] **Step 8: Add a resolveAdapter test to `htb.test.ts`**

Append:
```ts
import { resolveAdapter } from "./index";

describe("resolveAdapter", () => {
  it("resolves HTB for a pwnbox context", () => {
    expect(resolveAdapter({ contextPath: "cloud:htb:pwnbox" }).id).toBe("htb");
  });
  it("resolves the 10.10.10.x overlap to HTB when contextPath says htb", () => {
    expect(resolveAdapter({ contextPath: "cloud:htb", targetScope: "box 10.10.10.5" }).id).toBe("htb");
  });
  it("resolves THM for a THM:: scope", () => {
    expect(resolveAdapter({ targetScope: "THM::Blue (Easy)" }).id).toBe("thm");
  });
  it("falls back to local for a bare scope", () => {
    expect(resolveAdapter({ targetScope: "just a hostname" }).id).toBe("local");
  });
});
```

- [ ] **Step 9: Run tests + typecheck**

Run: `npx vitest run src/lib/platform/htb.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**
```bash
git add src/lib/platform/
git commit -m "feat: PlatformAdapter seam with HTB/THM/local adapters and registry"
```

---

## Task 5: Neutral identity cutover — `targetOf` + `machineOf` shim (WP-3)

**Files:**
- Modify: `src/lib/platform/index.ts` (add `targetOf`)
- Modify: `src/lib/machine.ts` (reimplement `machineOf` as a shim; keep `hueFor`, `DIFFICULTY_COLOR`, `MachineMeta`)
- Modify: `src/store/report.ts` (`SessionCard.target`; platform-derived live id prefix)
- Modify: `src/components/{IdentityBar,MachineAvatar,WriteupGate}.tsx`
- Create: `src/lib/platform/target.test.ts`

**Interfaces:**
- Consumes: `resolveAdapter` (Task 4), `WatcherReport`, `Target` (Task 2).
- Produces: `targetOf(report: WatcherReport): Target`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/platform/target.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { targetOf } from "./index";
import type { WatcherReport } from "../../types/report";

const base = (over: Partial<WatcherReport["session"]>): WatcherReport => ({
  schema_version: "1.2",
  session: { uuid: "x", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:01:00Z", target_scope: "HTB::Forge (Medium)", shell: "bash", source: "local_pty", ...over },
  episodes: [], phases: [], golden_dag: [],
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] },
  redaction_profile: "full",
});

describe("targetOf", () => {
  it("prefers an explicit session.target when present", () => {
    const r = base({ target: { platform: "thm", kind: "room", name: "Blue" } });
    expect(targetOf(r).platform).toBe("thm");
  });
  it("resolves HTB identity from machine + scope", () => {
    const r = base({ machine: { name: "Forge", os: "Linux", difficulty: "Medium" } });
    const t = targetOf(r);
    expect(t.platform).toBe("htb");
    expect(t.name).toBe("Forge");
    expect(t.difficulty?.label).toBe("Medium");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/platform/target.test.ts`
Expected: FAIL (`targetOf` not exported).

- [ ] **Step 3: Implement `targetOf` in `index.ts`**

```ts
import type { WatcherReport, Target } from "../../types/report";

export function targetOf(report: WatcherReport): Target {
  if (report.session.target) return report.session.target;
  const s = report.session;
  const ctx: DetectContext = {
    targetScope: s.target_scope,
    contextPath: s.context_path,
    platformHint: s.machine ? "htb" : undefined, // a machine block is an HTB signal
  };
  return resolveAdapter(ctx).identify(s.machine, ctx);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/platform/target.test.ts`
Expected: PASS.

- [ ] **Step 5: Reimplement `machineOf` as a delegating shim**

In `src/lib/machine.ts`, keep `MachineMeta`, `hueFor`, `DIFFICULTY_COLOR`. Replace `machineOf`:
```ts
import { targetOf } from "./platform";

/** @deprecated use targetOf() from ../lib/platform. Retained so un-migrated callers keep working. */
export function machineOf(report: WatcherReport): MachineMeta {
  const t = targetOf(report);
  return {
    name: t.name,
    os: t.os,
    difficulty: t.difficulty?.label,
    avatar: t.emblem?.avatar ?? null,
    local: t.platform === "local",
  };
}
```
(Watch for an import cycle: `platform/local.ts` imports `hueFor` from `machine.ts`, and `machine.ts` now imports `targetOf` from `platform`. This is a function-level cycle resolved at call time, not module init — verify `npm run build` still succeeds; if the bundler complains, move `hueFor` into `platform/detect.ts` and re-export from `machine.ts`.)

- [ ] **Step 6: Migrate `IdentityBar`, `MachineAvatar`, `WriteupGate` to `Target`**

In `IdentityBar.tsx`: replace `machineOf(report)` with `targetOf(report)`; read `machine.difficulty` → `target.difficulty?.label`; use `target.emblem`. Use `resolveAdapter({...}).kindNoun` (or read `target.kind`) for the noun in copy where it says "box".
In `MachineAvatar.tsx`: change the prop type to accept `Target` (use `emblem.hue`/`emblem.avatar`, `difficulty?.label`). Keep the component name.
In `WriteupGate.tsx`: `machineOf` → `targetOf`; copy that says "this box" becomes `` `this ${target.kind}` ``.

- [ ] **Step 7: Update the store**

In `src/store/report.ts`: add `target: Target` to `SessionCard`; in `toCard`, set `target: targetOf(r)` (keep `machine: machineOf(r)` for now). Change the live-session id prefix from `htb:` to platform-derived:
```ts
const id = `${targetOf(finalized).platform}:${finalized.session.uuid}`;
```
In `History.tsx:104`, keep opening by the stored id (it now uses the platform prefix); do not hardcode `htb:`.

- [ ] **Step 8: Run the full suite + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. Visually confirm (`npm run dev`) the HTB Forge debrief hero is unchanged.

- [ ] **Step 9: Commit**
```bash
git add src/lib/platform/index.ts src/lib/machine.ts src/store/report.ts src/components/IdentityBar.tsx src/components/MachineAvatar.tsx src/components/WriteupGate.tsx src/lib/platform/target.test.ts
git commit -m "feat: neutral identity via targetOf; machineOf becomes a shim"
```

---

## Task 6: Deterministic findings extraction (WP-4)

**Files:**
- Create: `src/lib/pipeline/findings.ts`
- Create: `src/lib/pipeline/findings.test.ts`
- Modify: `src/lib/pipeline/index.ts` (call the stage), `src/lib/pipeline/ingest.ts` (write `findings`, stamp `schema_version: "1.2"`)
- Reference: `src/lib/redact.ts` (`redactText`)

**Interfaces:**
- Consumes: `Episode`, `Finding`, `FindingKind`, `RedactionProfile` (Task 2).
- Produces: `extractFindings(episodes: Episode[], profile: RedactionProfile): Finding[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/pipeline/findings.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { extractFindings } from "./findings";
import type { Episode } from "../../types/report";

const ep = (over: Partial<Episode> & { seq: number }): Episode => ({ cmd: "", binary: "", duration_ms: 0, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", ...over });

describe("extractFindings", () => {
  const eps: Episode[] = [
    ep({ seq: 0, cmd: "nmap -sV 10.129.1.1", binary: "nmap", tactic: "TA0007", output_digest: "80/tcp open http Apache 2.4\n445/tcp open microsoft-ds" }),
    ep({ seq: 1, cmd: "curl http://10.129.1.1:80/admin", binary: "curl", tactic: "TA0007", output_digest: "200 OK" }),
    ep({ seq: 2, cmd: "cat root.txt", binary: "cat", tactic: "TA0004", output_digest: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" }),
  ];

  it("extracts ports with source_seq", () => {
    const f = extractFindings(eps, "full");
    const port = f.find((x) => x.id === "port:80-tcp");
    expect(port).toMatchObject({ kind: "port", value: "80/tcp", source_seq: 0 });
  });
  it("links a finding to the later episode that consumed it (used_by_seq)", () => {
    const f = extractFindings(eps, "full");
    const port80 = f.find((x) => x.id === "port:80-tcp")!;
    expect(port80.used_by_seq).toContain(1); // curl ...:80 consumed it
  });
  it("marks an observed flag proven and masks it under public_safe", () => {
    const full = extractFindings(eps, "full").find((x) => x.kind === "flag");
    expect(full?.proven).toBe(true);
    const safe = extractFindings(eps, "public_safe").find((x) => x.kind === "flag");
    expect(safe?.masked).toBe(true);
    expect(safe?.value).not.toContain("a1b2c3d4");
  });
  it("is deterministic", () => {
    expect(extractFindings(eps, "full")).toEqual(extractFindings(eps, "full"));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/pipeline/findings.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `findings.ts`**

```ts
import type { Episode, Finding, FindingKind, RedactionProfile } from "../../types/report";

interface Detector {
  kind: FindingKind;
  re: RegExp;
  /** Build (id, value, extra) from a match; return null to skip. */
  make: (m: RegExpMatchArray) => { id: string; value: string; tactic?: string } | null;
}

function hash8(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const DETECTORS: Detector[] = [
  { kind: "port", re: /(\d{1,5})\/(tcp|udp)\s+open(?:\s+(\S+))?/g, make: (m) => ({ id: `port:${m[1]}-${m[2]}`, value: `${m[1]}/${m[2]}`, tactic: "TA0007" }) },
  { kind: "url", re: /https?:\/\/[^\s"'<>]+/g, make: (m) => ({ id: `url:${hash8(m[0])}`, value: m[0], tactic: "TA0007" }) },
  { kind: "hash", re: /\b[a-f0-9]{32,}\b|\$[0-9a-z]\$[^\s:]+/g, make: (m) => ({ id: `hash:${hash8(m[0])}`, value: m[0] }) },
  { kind: "cred", re: /(?:password|passwd|pwd|user(?:name)?)\s*[:=]\s*(\S+)/gi, make: (m) => ({ id: `cred:${hash8(m[0])}`, value: m[0], tactic: "TA0006" }) },
  { kind: "vuln", re: /CVE-\d{4}-\d{3,}/g, make: (m) => ({ id: `vuln:${m[0]}`, value: m[0], tactic: "TA0001" }) },
];

const FLAG_RE = /\b[a-f0-9]{32}\b|(?:HTB|THM|flag)\{[^}]*\}/gi;
const SECRET_KINDS = new Set<FindingKind>(["cred", "hash", "flag"]);

function mask(value: string): string {
  const tail = value.slice(-2);
  return `••••${tail}`;
}

/** Deterministic findings ledger. Iterates episodes in seq order; links used_by_seq by tokenised match. */
export function extractFindings(episodes: Episode[], profile: RedactionProfile): Finding[] {
  const byId = new Map<string, Finding>();

  const add = (f: Omit<Finding, "used_by_seq">) => {
    const existing = byId.get(f.id);
    if (existing) return; // first occurrence wins as source_seq
    byId.set(f.id, { ...f, used_by_seq: [] });
  };

  for (const ep of episodes) {
    const text = ep.output_digest ?? "";
    for (const d of DETECTORS) {
      d.re.lastIndex = 0;
      for (const m of text.matchAll(d.re)) {
        const built = d.make(m);
        if (!built) continue;
        add({ id: built.id, kind: d.kind, value: built.value, source_seq: ep.seq, tactic: built.tactic });
      }
    }
    // flags: a flag-shaped token in output is "proven" (observed). A bare `cat *.txt` with no token isn't.
    FLAG_RE.lastIndex = 0;
    const flagName = /(?:user|root|proof)\.txt/i.test(ep.cmd) ? (/root|proof/i.test(ep.cmd) ? "root" : "user") : null;
    const flagMatch = text.match(FLAG_RE);
    if (flagName || flagMatch) {
      const id = `flag:${flagName ?? hash8(flagMatch![0])}`;
      if (!byId.has(id)) {
        byId.set(id, { id, kind: "flag", value: flagMatch ? flagMatch[0] : `${flagName}.txt`, source_seq: ep.seq, proven: Boolean(flagMatch), used_by_seq: [] });
      }
    }
  }

  // Link used_by_seq: a later episode whose cmd contains the finding's value token consumed it.
  const findings = [...byId.values()];
  for (const f of findings) {
    const needle = f.kind === "port" ? f.value.split("/")[0] : f.value;
    for (const ep of episodes) {
      if (ep.seq <= f.source_seq) continue;
      if (ep.cmd.includes(needle)) f.used_by_seq!.push(ep.seq);
    }
  }

  // Redaction pass.
  if (profile === "public_safe") {
    for (const f of findings) {
      if (SECRET_KINDS.has(f.kind)) { f.value = mask(f.value); f.masked = true; }
    }
  }

  // Stable ordering: by source_seq, then id.
  findings.sort((a, b) => a.source_seq - b.source_seq || a.id.localeCompare(b.id));
  return findings;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/pipeline/findings.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the stage into the pipeline and report**

In `src/lib/pipeline/index.ts`, after episodes are classified (post-frameworks, pre-align), the runner returns episodes; keep findings out of the pure `runPipeline` return only if it complicates types. Simplest wiring: compute findings in `ingest.ts::assembleReport` where the profile is known. In `assembleReport`, after `runPipeline`, add:
```ts
import { extractFindings } from "./findings";
// ...
const profile = opts.redaction_profile ?? "full";
const findings = extractFindings(episodes, profile);
```
and add `findings` to the returned report object, and change `schema_version: "1.1"` → `schema_version: "1.2"`, and `redaction_profile: profile`.

- [ ] **Step 6: Run full suite + schema test**

Run: `npm test && npm run typecheck`
Expected: PASS. The schema test still validates all fixtures (findings is optional; produced reports now carry it and remain valid).

- [ ] **Step 7: Commit**
```bash
git add src/lib/pipeline/findings.ts src/lib/pipeline/findings.test.ts src/lib/pipeline/ingest.ts src/lib/pipeline/index.ts
git commit -m "feat: deterministic findings extraction stage (v1.2)"
```

---

## Task 7: Objective tree status + claimed-vs-proven (WP-5)

**Files:**
- Modify: `src/lib/pipeline/align.ts` (compute status/finding_refs/proven_by_seq)
- Modify: `src/lib/pipeline/align.test.ts`
- Modify: `src/lib/pipeline/ingest.ts` (pass findings into alignment) and `src/store/report.ts` (`applyGoldenDag` recomputes status)

**Interfaces:**
- Consumes: `Finding` (Task 2), `extractFindings` output (Task 6), existing `alignEpisodes`.
- Produces: `annotateObjectiveStatus(episodes: Episode[], golden: GoldenObjective[], findings: Finding[]): GoldenObjective[]` and updated `AlignResult`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/pipeline/align.test.ts`:
```ts
import { annotateObjectiveStatus } from "./align";
import type { Episode, Finding, GoldenObjective } from "../../types/report";

describe("annotateObjectiveStatus", () => {
  const eps: Episode[] = [
    { seq: 0, cmd: "nmap 10.129.1.1", binary: "nmap", duration_ms: 1, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", alignment: "match" },
    { seq: 1, cmd: "cat root.txt", binary: "cat", duration_ms: 1, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0004", output_digest: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", alignment: "match" },
  ];
  const findings: Finding[] = [
    { id: "port:80-tcp", kind: "port", value: "80/tcp", source_seq: 0 },
    { id: "flag:root", kind: "flag", value: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", source_seq: 1, proven: true },
  ];
  const golden: GoldenObjective[] = [
    { objective: "enumerate_services", tactic: "TA0007", satisfied_by: ["nmap"], user_satisfied_by_seq: 0 },
    { objective: "capture_root", tactic: "TA0004", satisfied_by: ["read root flag"], user_satisfied_by_seq: 1 },
  ];

  it("marks a flag-backed root objective proven and others reached", () => {
    const out = annotateObjectiveStatus(eps, golden, findings);
    expect(out[0].status).toBe("reached");
    expect(out[1].status).toBe("proven");
    expect(out[1].proven_by_seq).toBe(1);
  });
  it("marks an unsatisfied objective untouched", () => {
    const out = annotateObjectiveStatus(eps, [{ objective: "x", tactic: "TA0006", satisfied_by: ["hydra"], user_satisfied_by_seq: null }], findings);
    expect(out[0].status).toBe("untouched");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/pipeline/align.test.ts -t annotateObjectiveStatus`
Expected: FAIL (`annotateObjectiveStatus` not exported).

- [ ] **Step 3: Implement `annotateObjectiveStatus`**

Add to `src/lib/pipeline/align.ts`:
```ts
import type { Finding } from "../../types/report";

const ROOT_OBJ = /root|admin|system/i;

/** Deterministic objective status + proof marking (schema v1.2). */
export function annotateObjectiveStatus(episodes: Episode[], golden: GoldenObjective[], findings: Finding[]): GoldenObjective[] {
  const bySeq = new Map(episodes.map((e) => [e.seq, e]));
  return golden.map((o) => {
    const seq = o.user_satisfied_by_seq;
    // finding_refs: findings whose source or use touches the satisfier episode
    const refs = findings.filter((f) => f.source_seq === seq || f.used_by_seq?.includes(seq ?? -1)).map((f) => f.id);

    if (seq == null) {
      // attempted if any episode shared the tactic but didn't land it; else untouched
      const attempted = episodes.some((e) => e.tactic === o.tactic && (e.alignment === "detour" || e.loop_of_seq != null));
      return { ...o, status: attempted ? "attempted" : "untouched", finding_refs: refs, proven_by_seq: null };
    }

    // proof rules
    let proven_by_seq: number | null = null;
    const flagRef = findings.find((f) => f.kind === "flag" && f.proven && (f.source_seq === seq || refs.includes(f.id)));
    if (flagRef) proven_by_seq = flagRef.source_seq;
    else if (o.tactic === "TA0004" && ROOT_OBJ.test(o.objective)) {
      const proof = episodes.find((e) => e.seq >= seq && /uid=0|euid=0|\broot\b/.test(e.output_digest ?? ""));
      if (proof) proven_by_seq = proof.seq;
    }

    const status: GoldenObjective["status"] = proven_by_seq != null ? "proven" : "reached";
    return { ...o, status, finding_refs: refs, proven_by_seq };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/pipeline/align.test.ts -t annotateObjectiveStatus`
Expected: PASS.

- [ ] **Step 5: Call it after alignment in `ingest.ts`**

In `assembleReport`, after `runPipeline` and `extractFindings`:
```ts
import { annotateObjectiveStatus } from "./align";
// golden here is the aligned golden from runPipeline
const annotatedGolden = annotateObjectiveStatus(episodes, golden, findings);
```
Use `annotatedGolden` in the returned report's `golden_dag`.

- [ ] **Step 6: Recompute status in the store's `applyGoldenDag`**

In `src/store/report.ts::applyGoldenDag`, after `alignEpisodes`, annotate using the report's existing findings:
```ts
import { annotateObjectiveStatus } from "../lib/pipeline/align";
const aligned2 = annotateObjectiveStatus(episodes, aligned, r.findings ?? []);
// use aligned2 as golden_dag in `scoped`
```
Preserve the existing `objective_coverage_pct` semantics (reached-or-better / total) — do not change the denominator.

- [ ] **Step 7: Run full suite + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. Confirm existing fixtures' `objective_coverage_pct` values are unchanged (the annotation adds `status`, it doesn't move coverage).

- [ ] **Step 8: Commit**
```bash
git add src/lib/pipeline/align.ts src/lib/pipeline/align.test.ts src/lib/pipeline/ingest.ts src/store/report.ts
git commit -m "feat: objective status + claimed-vs-proven verification (v1.2)"
```

---

## Task 8: TryHackMe native intended path (WP-6, part 1)

**Files:**
- Modify: `src/lib/platform/thm.ts` (add `intendedPath`)
- Create: `src/lib/platform/thm.test.ts`
- Modify: `src/components/WriteupGate.tsx` / `WriteupControl.tsx` (offer "Paste THM tasks" when platform = thm)
- Reference: `src/lib/writeup/extract.ts` (`heuristicGoldenDag` for tactic inference)

**Interfaces:**
- Consumes: `NativePathInput` (Task 4), `GoldenObjective` (Task 2), `heuristicGoldenDag`/detectors (existing).
- Produces: `thmAdapter.intendedPath(input): Promise<GoldenObjective[] | null>`, plus a pure helper `parseThmTasks(raw: string): GoldenObjective[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/platform/thm.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseThmTasks, thmAdapter } from "./thm";

const ROOM = `Task 1  Recon
Scan the machine with nmap. What port is open?
Task 2  Gaining Access
Exploit the SMB service to get a shell.
Task 3  Privilege Escalation
Escalate to SYSTEM and read root.txt.`;

describe("parseThmTasks", () => {
  it("turns a THM task list into a linear objective tree", () => {
    const tree = parseThmTasks(ROOM);
    expect(tree.length).toBe(3);
    expect(tree[0].objective).toMatch(/recon/);
    expect(tree[1].depends_on).toEqual([tree[0].objective]);
    expect(tree[2].depends_on).toEqual([tree[1].objective]);
  });
  it("returns [] for text that isn't a THM task list", () => {
    expect(parseThmTasks("just some prose about hacking")).toEqual([]);
  });
});

describe("thmAdapter.intendedPath", () => {
  it("returns the parsed tree for THM task text", async () => {
    const tree = await thmAdapter.intendedPath!({ target: { platform: "thm", kind: "room", name: "Blue" }, raw: ROOM });
    expect(tree && tree.length).toBe(3);
  });
  it("returns null when there is no room structure to parse", async () => {
    expect(await thmAdapter.intendedPath!({ target: { platform: "thm", kind: "room", name: "Blue" }, raw: "prose" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/platform/thm.test.ts`
Expected: FAIL (`parseThmTasks` not exported).

- [ ] **Step 3: Implement `parseThmTasks` + `intendedPath` in `thm.ts`**

```ts
import type { GoldenObjective } from "../../types/report";

const TASK_RE = /^\s*Task\s+\d+\b[.:]?\s*(.*)$/gim;

// Reuse the existing keyword→tactic detectors from the write-up heuristic.
const TACTIC_HINTS: { re: RegExp; tactic: string; tool: string }[] = [
  { re: /\b(nmap|scan|enumerat|recon|port)\b/i, tactic: "TA0007", tool: "nmap" },
  { re: /\b(exploit|shell|access|foothold|smb|upload|rce)\b/i, tactic: "TA0002", tool: "exploit" },
  { re: /\b(cred|password|hash|brute)\b/i, tactic: "TA0006", tool: "credentials" },
  { re: /\b(privilege|privesc|escalat|root|system|suid|sudo)\b/i, tactic: "TA0004", tool: "privesc" },
];

function tacticFor(title: string, body: string): { tactic: string; tool: string } {
  const text = `${title} ${body}`;
  for (const h of TACTIC_HINTS) if (h.re.test(text)) return { tactic: h.tactic, tool: h.tool };
  return { tactic: "TA0002", tool: "manual" };
}

/** Parse a pasted THM room (Task N — Title, followed by body lines) into a linear objective tree. */
export function parseThmTasks(raw: string): GoldenObjective[] {
  const lines = raw.split(/\r?\n/);
  const tasks: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | null = null;
  for (const line of lines) {
    TASK_RE.lastIndex = 0;
    const m = /^\s*Task\s+\d+\b[.:]?\s*(.*)$/i.exec(line);
    if (m) {
      if (current) tasks.push(current);
      current = { title: m[1].trim(), body: "" };
    } else if (current) {
      current.body += " " + line.trim();
    }
  }
  if (current) tasks.push(current);
  if (tasks.length < 2) return []; // not a task list

  const out: GoldenObjective[] = tasks.map((t, i) => {
    const { tactic, tool } = tacticFor(t.title, t.body);
    const objective = (t.title || `task_${i + 1}`).toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 40) || `task_${i + 1}`;
    return { objective, tactic, satisfied_by: [tool], depends_on: [] };
  });
  for (let i = 1; i < out.length; i++) out[i].depends_on = [out[i - 1].objective];
  return out;
}

// add to thmAdapter:
//   async intendedPath(input) { const tree = input.raw ? parseThmTasks(input.raw) : []; return tree.length ? tree : null; }
```
Add the `intendedPath` method to the exported `thmAdapter` object.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/platform/thm.test.ts`
Expected: PASS.

- [ ] **Step 5: Offer "Paste THM tasks" in the write-up gate**

In `WriteupGate.tsx` (and/or `WriteupControl.tsx`), when `targetOf(report).platform === "thm"`, relabel the paste affordance to "Paste the room's tasks" and, on submit, route through `thmAdapter.intendedPath({ target, raw: pasted })` first; if it returns a tree, apply it via `applyGoldenDag(tree, { source: "thm-tasks", confidence: 0.7 })`; else fall back to the existing `goldenFromText`.

- [ ] **Step 6: Run full suite + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**
```bash
git add src/lib/platform/thm.ts src/lib/platform/thm.test.ts src/components/WriteupGate.tsx src/components/WriteupControl.tsx
git commit -m "feat: TryHackMe native task-tree intended path"
```

---

## Task 9: Capture `--platform` / `--target` flags (WP-6, part 2, Rust)

**Files:**
- Modify: `crates/capture/src/main.rs` (arg parsing + envelope provenance + base report)
- Reference: `machine_arg`, `build_base_report`, `arg_value` (existing)

**Interfaces:**
- Consumes: existing `arg_value(args, "--machine")` pattern.
- Produces: `--platform <id>` written to `provenance.platform` and a neutral `target_scope`; `--machine` remains an HTB alias.

- [ ] **Step 1: Read the existing arg + report builders**

Read `crates/capture/src/main.rs` around `machine_arg` (~line 459) and `build_base_report` (~line 475). Note how `--machine` flows into `session.machine` and how envelopes carry `provenance`.

- [ ] **Step 2: Add `--platform` and `--target` parsing**

Add a helper mirroring `machine_arg`:
```rust
/// Neutral platform id from --platform (htb|thm|offsec|immersive|local); defaults to "local".
fn platform_arg(args: &[String]) -> String {
    arg_value(args, "--platform").unwrap_or_else(|| "local".to_string())
}
```
In `build_base_report`, set `provenance`/`context_path` to include the platform token (e.g. `format!("cloud:{}:openvpn", platform)`) and use `--target` (fall back to `--machine`) for `target_scope`.

- [ ] **Step 3: Stamp `provenance.platform` on emitted envelopes**

Where telemetry envelopes are serialized, add `"platform": platform` under `provenance` (the TS `TelemetryEvent.provenance.platform` field already exists in `ingest.ts`).

- [ ] **Step 4: Build the crate**

Run:
```bash
cd crates/capture && cargo build --release
```
Expected: compiles. If the crate has tests (`cargo test`), run them.

- [ ] **Step 5: Manual smoke check**

Run a short capture with the new flag and confirm the written session JSON carries the platform in `context_path`/provenance:
```bash
./target/release/watcher-capture --attach --platform thm --target Blue
# run one command, exit; inspect the session json under ~/.watcher/sessions/
```
Expected: `target_scope` reflects "Blue"; provenance/context carries `thm`.

- [ ] **Step 6: Commit**
```bash
git add crates/capture/src/main.rs
git commit -m "feat(capture): --platform/--target flags with neutral provenance"
```

---

## Task 10: Minimal proven/findings surfacing (WP-7)

**Files:**
- Modify: `src/components/PathComparison.tsx` (proven vs reached affordance)
- Modify: `src/App.tsx` (a collapsed Findings panel in Details)
- Create: `src/components/Findings.tsx`
- Create: `src/components/Findings.test.tsx`

**Interfaces:**
- Consumes: `report.findings`, `golden_dag[].status`/`proven_by_seq`, store `reveal(seq)` (existing).
- Produces: `<Findings />` component listing findings grouped by kind with deep-links.

- [ ] **Step 1: Write the failing component test**

Create `src/components/Findings.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Findings } from "./Findings";

vi.mock("../store/report", () => ({
  useReport: (sel: any) => sel({
    report: { findings: [{ id: "port:80-tcp", kind: "port", value: "80/tcp", source_seq: 3 }] },
    reveal: mockReveal,
  }),
}));
const mockReveal = vi.fn();

describe("Findings", () => {
  it("lists a finding and deep-links to its source on click", () => {
    render(<Findings />);
    fireEvent.click(screen.getByText("80/tcp"));
    expect(mockReveal).toHaveBeenCalledWith(3);
  });
});
```
(Match the project's existing test setup — if components are tested without `@testing-library/react` elsewhere, mirror that pattern instead.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/Findings.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `Findings.tsx`**

```tsx
import { useReport } from "../store/report";
import type { Finding } from "../types/report";

export function Findings() {
  const findings = useReport((s) => s.report.findings ?? []);
  const reveal = useReport((s) => s.reveal);
  if (!findings.length) return null;
  const groups = findings.reduce<Record<string, Finding[]>>((acc, f) => ((acc[f.kind] ??= []).push(f), acc), {});
  return (
    <div className="flex flex-col gap-2">
      {Object.entries(groups).map(([kind, list]) => (
        <div key={kind}>
          <div className="label text-faint">{kind}</div>
          <div className="flex flex-wrap gap-1.5">
            {list.map((f) => (
              <button key={f.id} type="button" onClick={() => reveal(f.source_seq)} className="mono rounded border border-edge px-1.5 py-0.5 text-xs hover:border-signal" title={`from step #${f.source_seq}`}>
                {f.masked ? "••••" : f.value}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/components/Findings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the Findings panel to Details in `App.tsx`**

In the Details accordion block, add (reuse the existing `Collapse`):
```tsx
import { Findings } from "./components/Findings";
// inside the details column:
<Collapse name="debrief-details" title="Findings" subtitle="what the run surfaced — click to jump to the command">
  <Findings />
</Collapse>
```

- [ ] **Step 6: Add proven affordance in `PathComparison.tsx`**

Where objectives render, show a proven marker when `objective.status === "proven"`:
```tsx
{o.status === "proven" ? (
  <span className="text-match" title="Proven — backed by observable proof">✓ proven</span>
) : o.user_satisfied_by_seq != null ? (
  <span className="text-muted" title="Reached — satisfied, not proof-verified">• reached</span>
) : null}
```

- [ ] **Step 7: Run full suite + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. Visually confirm the Findings panel and the proven markers render on the Forge debrief.

- [ ] **Step 8: Commit**
```bash
git add src/components/Findings.tsx src/components/Findings.test.tsx src/App.tsx src/components/PathComparison.tsx
git commit -m "feat: minimal findings panel + proven objective affordance"
```

---

## Task 11: Adapter conformance kit + final wiring + docs (WP-8)

**Files:**
- Create: `src/lib/platform/conformance.ts`
- Create: `src/lib/platform/conformance.test.ts`
- Modify: `scripts/conformance.tsx` (run platform conformance too) or add `scripts/platform-conformance.tsx` + a `package.json` script
- Modify: `src/lib/pipeline/ingest.ts` (set `session.target` at assemble time via `targetOf`; try `adapter.intendedPath` before write-up)
- Modify: `README.md`, `crates/capture/CAPTURE.md`

**Interfaces:**
- Consumes: `ADAPTERS`, `PlatformAdapter` (Task 4), `targetOf` (Task 5).
- Produces: `checkAdapter(a: PlatformAdapter): string[]` (returns a list of failure messages; empty = pass).

- [ ] **Step 1: Write the failing test**

Create `src/lib/platform/conformance.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ADAPTERS } from "./index";
import { checkAdapter } from "./conformance";

describe("adapter conformance", () => {
  for (const a of ADAPTERS) {
    it(`${a.id} conforms`, () => {
      expect(checkAdapter(a)).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/platform/conformance.test.ts`
Expected: FAIL (`checkAdapter` not found).

- [ ] **Step 3: Implement `conformance.ts`**

```ts
import type { PlatformAdapter } from "./types";

/** Returns a list of conformance failures; empty array means the adapter passes. */
export function checkAdapter(a: PlatformAdapter): string[] {
  const errs: string[] = [];
  if (!a.id) errs.push("missing id");
  if (!a.label) errs.push("missing label");
  if (!a.kindNoun) errs.push("missing kindNoun");

  let score: number;
  try { score = a.detect({}); } catch (e) { errs.push(`detect threw: ${e}`); score = NaN; }
  if (!(score >= 0 && score <= 1)) errs.push(`detect() out of range: ${score}`);

  try {
    const t = a.identify(undefined, {});
    if (!t || t.platform !== a.id) errs.push("identify() must return a Target with platform === id");
    if (!t?.name) errs.push("identify() Target missing name");
    if (!t?.kind) errs.push("identify() Target missing kind");
  } catch (e) { errs.push(`identify threw: ${e}`); }

  return errs;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/platform/conformance.test.ts`
Expected: PASS for all five adapters.

- [ ] **Step 5: Set `session.target` at assemble time**

In `ingest.ts::assembleReport`, after building the report, populate `session.target`:
```ts
import { targetOf } from "../platform";
// after constructing the report object `rep`:
rep.session.target = targetOf(rep);
```
Ensure this runs before returning. (This makes every freshly assembled report carry neutral identity.)

- [ ] **Step 6: Route native intended-path before write-up in the gate flow**

Document + wire: when the write-up gate opens and `targetOf(report)` resolves to an adapter with `intendedPath`, prefer it. (For THM this is done in Task 8; here, generalize the call site so any future adapter with `intendedPath` is tried first, falling back to `goldenFromText`.)

- [ ] **Step 7: Add a conformance npm script**

In `package.json` scripts, add (or fold into the existing `conformance`):
```json
"platform:conformance": "vitest run src/lib/platform/conformance.test.ts"
```

- [ ] **Step 8: Update docs**

In `README.md`: change the HTB-centric framing to "any training platform (HTB, TryHackMe, OffSec, Immersive, local/CTF)"; note `--platform` capture flag. In `crates/capture/CAPTURE.md`: document `--platform <id> --target <name>`. Add a short "Adding a platform" section pointing at `src/lib/platform/` and the conformance test (one adapter file + pass `checkAdapter`).

- [ ] **Step 9: Run full suite + build + schema**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. Confirm a freshly assembled report (e.g. via `npm run ingest` on a fixture capture) carries `session.target`.

- [ ] **Step 10: Commit**
```bash
git add src/lib/platform/conformance.ts src/lib/platform/conformance.test.ts scripts/ package.json src/lib/pipeline/ingest.ts README.md crates/capture/CAPTURE.md
git commit -m "feat: adapter conformance kit, session.target wiring, docs"
```

---

## Self-Review (completed by planner)

**1. Spec coverage** — every spec section maps to a task:
- WP-0 → Task 1; WP-1 → Task 2; WP-2 → Tasks 3–4; WP-3 → Task 5; WP-4 → Task 6; WP-5 → Task 7; WP-6 → Tasks 8–9; WP-7 → Task 10; WP-8 → Task 11.
- Global constraints (TDD, green gate, additive, determinism, redaction, no scope creep) appear in the header and are exercised per task (determinism test in Task 6; backward-compat in Task 1; redaction in Task 6; schema-additive in Task 2).
- Research→design mapping (spec Appendix A) is realized: task tree (Task 7), findings (Task 6), claimed-vs-proven (Tasks 6–7), salient-state digest (Task 6).

**2. Placeholder scan** — no "TBD/TODO/handle edge cases"; every code step carries real code. The Rust task (9) gives concrete helpers and references exact existing functions; its "manual smoke check" is an explicit command, not a placeholder.

**3. Type consistency** — `Target`, `Finding`, `PlatformAdapter`, `DetectContext`, `annotateObjectiveStatus`, `extractFindings`, `parseThmTasks`, `resolveAdapter`, `targetOf`, `checkAdapter` are each defined once (Tasks 2/4/5/6/7/8/11) and referenced with matching signatures downstream. `difficulty.level` uses the `1|2|3|4|5` union consistently (HTB maps Easy/Medium/Hard/Insane → 1/2/4/5; THM Info/Easy/Medium/Hard/Insane → 1/1/3/4/5 — both documented in their adapters).

**Known follow-ups (out of scope, noted for later sub-projects):** proven-coverage as a distinct metric; OffSec/Immersive native intended-path; model-based findings enrichment; the report visual redesign.
