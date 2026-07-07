# Real-Content In-App Demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single fictional "Forge" demo with a registry of real-content demos (HTB Abducted + THM RootMe), each launchable in-app, with per-platform avatars fetched at runtime.

**Architecture:** Generalize the one hardcoded `DEMO_*` export into a `DemoDef` registry. Each demo is a transcribed `Step[]` (real command path from a public write-up) built into `RawCommand[]` by a shared builder, graded through the existing `assembleReport`. The store streams `startLiveDemo(id)` from the registry; History renders a card per demo. Avatars populate the existing `emblem.avatar` slot via a `resolveAvatar` seam (HTB API token / THM `og:image` / `hue` fallback), never committing third-party images.

**Tech Stack:** TypeScript, React (Vite), Vitest, the existing `src/lib/demo` + `src/lib/pipeline` + `src/lib/platform`.

## Global Constraints

- **Additive & backward-compatible:** the single-demo path becomes one registry entry; `?demo=live`, the History card, and live streaming keep working throughout.
- **Real content, not fabricated:** HTB Abducted is transcribed from `https://0xdf.gitlab.io/2026/07/07/htb-abducted.html`; THM RootMe from a public RootMe write-up (fetched during Task 4). Commands are the real path; outputs reconstructed from the write-up.
- **Redaction (`public_safe`):** committed demo fixtures must contain no real flag hash, no credential string, and no live IP. A redaction test enforces it per fixture.
- **No third-party assets committed:** zero platform logos/avatars in the repo. Avatars are fetched at runtime under the user's own credentials; absent that, the generated `hue` emblem renders.
- **Green gate (every task):** `npm test`, `npm run typecheck`, `npm run build` pass; output pristine.

---

## File Structure

- `src/lib/demo/build.ts` — `Step`, `buildRaw(steps, startMs)`, `DemoDef`, `makeDemo(...)` (the shared builder; the one place Step→RawCommand→report lives).
- `src/lib/demo/registry.ts` — `DEMOS: DemoDef[]`, `demoById(id)`, `isDemoId(id)`, `LEGACY_DEMO_ID` (first demo).
- `src/lib/demo/abducted.ts` — the HTB Abducted `Step[]` + golden (real content).
- `src/lib/demo/rootme.ts` — the THM RootMe `Step[]` + golden (real content, transcribed in Task 4).
- `src/lib/demo/playthrough.ts` — **deleted** in Task 3 (fictional Forge retired).
- `src/store/report.ts` — `startLiveDemo(id)`, register every demo report, `demo` flag from `isDemoId`.
- `src/components/DemoDriver.tsx` — launch on `?demo=<id>` (and legacy `?demo=live`).
- `src/components/History.tsx` — one demo card per `DEMOS` entry.
- `src/lib/platform/avatar.ts` — `resolveAvatar(target, creds)` (HTB token / THM og:image / hue fallback).

---

## Task 1: Demo builder + registry (system stays green with the current demo)

**Files:**
- Create: `src/lib/demo/build.ts`, `src/lib/demo/registry.ts`
- Modify: `src/lib/demo/playthrough.ts` (re-express its content through the builder)
- Test: `src/lib/demo/registry.test.ts`

**Interfaces:**
- Produces:
  - `interface Step { cmd: string; gap: number; dur: number; out: string; lines: number; volume?: number }`
  - `function buildRaw(steps: Step[], startMs: number): RawCommand[]`
  - `interface DemoDef { id: string; platform: "htb"|"thm"|"immersive"; target: string; session: Session; golden: GoldenObjective[]; raw: RawCommand[]; report: WatcherReport }`
  - `function makeDemo(args: { platform: DemoDef["platform"]; session: Session; steps: Step[]; golden: GoldenObjective[]; startMs: number }): DemoDef` (id = `${platform}:${session.uuid}`; raw = buildRaw; report = assembleReport)
  - `registry.ts`: `DEMOS: DemoDef[]`, `demoById(id: string): DemoDef | undefined`, `isDemoId(id: string): boolean`, `LEGACY_DEMO_ID = DEMOS[0].id`
- Consumed by: Tasks 2–5.

- [ ] **Step 1: Write the failing test** `src/lib/demo/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEMOS, demoById, isDemoId } from "./registry";

describe("demo registry", () => {
  it("holds at least one demo, each with a graded report and stable id", () => {
    expect(DEMOS.length).toBeGreaterThanOrEqual(1);
    for (const d of DEMOS) {
      expect(d.id).toContain(":");
      expect(d.raw.length).toBeGreaterThan(0);
      expect(d.report.episodes.length).toBeGreaterThan(0);
      expect(demoById(d.id)).toBe(d);
      expect(isDemoId(d.id)).toBe(true);
    }
    expect(isDemoId("not-a-demo")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/demo/registry.test.ts`
Expected: FAIL — cannot find module `./registry`.

- [ ] **Step 3: Create `build.ts`:**

```ts
import type { RawCommand } from "../pipeline/types";
import type { GoldenObjective, Session, WatcherReport } from "../../types/report";
import { assembleReport } from "../pipeline/ingest";

export interface Step { cmd: string; gap: number; dur: number; out: string; lines: number; volume?: number }

export interface DemoDef {
  id: string;
  platform: "htb" | "thm" | "immersive";
  target: string;
  session: Session;
  golden: GoldenObjective[];
  raw: RawCommand[];
  report: WatcherReport;
}

/** Cumulative-timestamp expansion of scripted steps into the RawCommand stream. */
export function buildRaw(steps: Step[], startMs: number): RawCommand[] {
  let t = startMs;
  return steps.map((s) => {
    t += s.gap;
    const started = t;
    t += s.dur;
    return {
      cmd: s.cmd,
      started_at_ms: started,
      ended_at_ms: t,
      exit_code: 0,
      output_line_count: s.lines,
      output_digest: s.out,
      context_path: "host",
      ...(s.volume ? { volume: s.volume } : {}),
    } satisfies RawCommand;
  });
}

export function makeDemo(args: {
  platform: DemoDef["platform"];
  session: Session;
  steps: Step[];
  golden: GoldenObjective[];
  startMs: number;
}): DemoDef {
  const raw = buildRaw(args.steps, args.startMs);
  const id = `${args.platform}:${args.session.uuid}`;
  const report = assembleReport(raw, { session: args.session, golden: args.golden });
  return { id, platform: args.platform, target: args.session.machine?.name ?? "target", session: args.session, golden: args.golden, raw, report };
}
```

- [ ] **Step 4: Re-express the existing demo through the builder.** In `src/lib/demo/playthrough.ts`, keep the existing `STEPS`, `DEMO_SESSION`, `DEMO_GOLDEN`, `START`, but replace the manual `DEMO_RAW`/`DEMO_REPORT` construction with `const FORGE = makeDemo({ platform: "htb", session: DEMO_SESSION, steps: STEPS, golden: DEMO_GOLDEN, startMs: START });` and re-export `DEMO_RAW = FORGE.raw`, `DEMO_REPORT = FORGE.report`, `DEMO_ID = FORGE.id` (keep the names so nothing else breaks yet). Export `FORGE`.

- [ ] **Step 5: Create `registry.ts`:**

```ts
import type { DemoDef } from "./build";
import { FORGE } from "./playthrough";

export const DEMOS: DemoDef[] = [FORGE];
export const LEGACY_DEMO_ID = DEMOS[0].id;

const BY_ID = new Map(DEMOS.map((d) => [d.id, d]));
export function demoById(id: string): DemoDef | undefined { return BY_ID.get(id); }
export function isDemoId(id: string): boolean { return BY_ID.has(id); }
```

- [ ] **Step 6: Run tests + gate**

Run: `npx vitest run src/lib/demo/registry.test.ts && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/demo/build.ts src/lib/demo/registry.ts src/lib/demo/playthrough.ts src/lib/demo/registry.test.ts
git commit -m "feat(demo): shared builder + N-demo registry (existing demo migrated in)"
```

---

## Task 2: Wire the store, driver, and History to the registry

**Files:**
- Modify: `src/store/report.ts` (`startLiveDemo(id)`, register all reports, `demo` flag)
- Modify: `src/components/DemoDriver.tsx` (`?demo=<id>` + legacy `?demo=live`)
- Modify: `src/components/History.tsx` (a card per demo)
- Test: `src/store/report.test.ts` (or the nearest store test) — a case per below

**Interfaces:**
- Consumes: `DEMOS`, `demoById`, `isDemoId`, `LEGACY_DEMO_ID` (Task 1).
- Produces: `startLiveDemo(id: string)` streams that demo; every demo report pre-registered; History shows N demo cards; `?demo=<id>` launches by id.

- [ ] **Step 1: Write the failing test** in `src/store/report.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEMOS } from "../lib/demo/registry";
import { useReport } from "./report";

describe("demo registry wired into the store", () => {
  it("pre-registers a session card for every demo", () => {
    const cards = useReport.getState().sessionCards;
    for (const d of DEMOS) {
      const card = cards.find((c) => c.id === d.id);
      expect(card, `card for ${d.id}`).toBeTruthy();
      expect(card!.demo).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/report.test.ts -t "demo registry wired"`
Expected: FAIL — only the single legacy demo card exists.

- [ ] **Step 3: Register every demo report + generalize the demo flag.** In `src/store/report.ts`:
- Replace `import { DEMO_RAW, DEMO_SESSION, DEMO_GOLDEN, DEMO_ID, DEMO_REPORT } from "../lib/demo/playthrough";` with `import { DEMOS, demoById, isDemoId, LEGACY_DEMO_ID } from "../lib/demo/registry";`.
- Replace `REPORTS[DEMO_ID] = DEMO_REPORT;` with `for (const d of DEMOS) REPORTS[d.id] = d.report;`.
- In `derive`, change `demo: id === DEMO_ID` to `demo: isDemoId(id)`.
- Anywhere `id === DEMO_ID` gated demo state, use `isDemoId(id)`.

- [ ] **Step 4: Generalize `startLiveDemo`** to take an id and stream from the registry:

```ts
  startLiveDemo: (id: string = LEGACY_DEMO_ID) => {
    const demo = demoById(id);
    if (!demo) return;
    if (demoTick) clearInterval(demoTick);
    if (demoGoldenTimer) clearTimeout(demoGoldenTimer);
    const total = demo.raw.length;
    let step = 0;
    const advance = () => {
      step += 1;
      const live = step < total;
      const session = { ...demo.session, ended_at: live ? new Date().toISOString() : demo.session.ended_at };
      const base = assembleReport(demo.raw.slice(0, step), { session, golden: [] });
      get().ingestLiveReport({ ...base, recording: live });
      if (step === 1) get().switchSession(demo.id);
      set({ demo: { phase: live ? "recording" : "resolved", n: step, total } });
      if (step >= total) {
        clearInterval(demoTick); demoTick = undefined;
        demoGoldenTimer = setTimeout(() => {
          get().applyGoldenDag(demo.golden, { source: demo.platform === "htb" ? "0xdf" : "writeup", confidence: 0.92 });
          set({ demo: { phase: "compared", n: total, total } });
        }, DEMO_GOLDEN_DELAY_MS);
      }
    };
    set({ view: "debrief", demo: { phase: "recording", n: 0, total } });
    demoTick = setInterval(advance, DEMO_TICK_MS);
    advance();
  },
```

Update the `startLiveDemo` type in the store interface to `(id?: string) => void`.

- [ ] **Step 5: History card per demo, and driver launches by id.** In `src/components/History.tsx`, the demo cards come from `sessionCards` (already `demo: true` per registry) — ensure the `▶ Watch live demo` click calls `startLiveDemo(c.id)` (pass the id): change `onOpen={() => (c.demo ? startLiveDemo() : switchSession(c.id))}` to `onOpen={() => (c.demo ? startLiveDemo(c.id) : switchSession(c.id))}`. In `src/components/DemoDriver.tsx`, replace the launch check:

```ts
    const p = new URLSearchParams(window.location.search).get("demo");
    if (p === "live") startLiveDemo();               // legacy → first demo
    else if (p && isDemoId(p)) startLiveDemo(p);      // ?demo=<id>
```

(import `isDemoId` from `../lib/demo/registry`; `startLiveDemo` from the store as before.)

- [ ] **Step 6: Run tests + gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/report.ts src/components/DemoDriver.tsx src/components/History.tsx src/store/report.test.ts
git commit -m "feat(demo): drive N demos from the registry (startLiveDemo(id), a card each, ?demo=<id>)"
```

---

## Task 3: HTB Abducted demo (real content, replaces Forge)

**Files:**
- Create: `src/lib/demo/abducted.ts`
- Modify: `src/lib/demo/registry.ts` (swap Forge → Abducted), delete `src/lib/demo/playthrough.ts`
- Modify: `src/store/report.ts` (drop the now-removed `playthrough` re-exports if any remain)
- Test: `src/lib/demo/abducted.test.ts`

**Interfaces:**
- Consumes: `Step`, `makeDemo` (Task 1).
- Produces: `ABDUCTED: DemoDef` exported from `abducted.ts`, registered in `DEMOS`.

- [ ] **Step 1: Write the failing test** `src/lib/demo/abducted.test.ts` (validity + redaction):

```ts
import { describe, it, expect } from "vitest";
import { ABDUCTED } from "./abducted";

describe("HTB Abducted demo", () => {
  it("grades to a real multi-phase report", () => {
    expect(ABDUCTED.platform).toBe("htb");
    expect(ABDUCTED.report.episodes.length).toBeGreaterThan(10);
    // the chain reaches privilege escalation
    expect(ABDUCTED.report.phases.some((p) => p.mitre_tactic === "TA0004")).toBe(true);
  });
  it("is redacted: no flag hash, no known credential, no live IP in any step", () => {
    const blob = ABDUCTED.raw.map((r) => `${r.cmd} ${r.output_digest ?? ""}`).join("\n");
    expect(blob).not.toMatch(/\b[0-9a-f]{32}\b/i);        // 32-hex flag
    expect(blob).not.toContain("iXzvcib3SrpZ");           // the rclone-revealed password
    expect(blob).not.toMatch(/\b10\.129\.\d+\.\d+\b/);     // live lab IP
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/demo/abducted.test.ts`
Expected: FAIL — cannot find module `./abducted`.

- [ ] **Step 3: Author `abducted.ts`** — transcribe the real path from `https://0xdf.gitlab.io/2026/07/07/htb-abducted.html`, **redacted**. Use the real 24-command chain (recon via nmap/nmblookup/smbclient/rpcclient → Samba print-job command injection `CVE-2026-4480` for a `nobody` shell → `rclone reveal` creds to `scott` → Samba wide-links + force-user SSH-key injection to `marcus` → operators-group systemd `ExecStartPre` SetUID-bash to root). Mirror the `Step` shape (realistic `gap`/`dur`/`lines`; `out` reconstructed from the write-up). Mask the flag hashes (`[user flag]` / `[root flag]`), the `iXzvcib3SrpZ` password (`[redacted]`), and the lab IP (use the hostname `abducted.htb` or `x.x.x.x`, not `10.129.x.x`). Author `GoldenObjective[]` for the intended path (recon → SMB enum → print-injection foothold → cred-reuse to scott → wide-links to marcus → systemd-privesc to root), following the tactic/`satisfied_by`/`depends_on` shape in the old `DEMO_GOLDEN`. Build with:

```ts
import { makeDemo, type Step } from "./build";
import type { GoldenObjective, Session } from "../../types/report";

const START = Date.parse("2026-07-07T19:00:00Z");
const STEPS: Step[] = [ /* the 24 transcribed, redacted steps */ ];
const SESSION: Session = {
  uuid: "demo-abducted-0001-0001-000000000001",
  started_at: new Date(START).toISOString(),
  ended_at: new Date(START).toISOString(), // makeDemo/report recompute from raw end; set precisely if needed
  target_scope: "HTB :: Abducted",
  context_path: "host", shell: "bash", source: "local_pty",
  machine: { name: "Abducted", os: "Linux", difficulty: "Medium", retired: true },
};
const GOLDEN: GoldenObjective[] = [ /* the intended path */ ];

export const ABDUCTED = makeDemo({ platform: "htb", session: SESSION, steps: STEPS, golden: GOLDEN, startMs: START });
```

- [ ] **Step 4: Swap the registry and delete the fictional demo.** In `registry.ts`, `import { ABDUCTED } from "./abducted";` and set `export const DEMOS = [ABDUCTED];` (remove the `FORGE` import). Delete `src/lib/demo/playthrough.ts`. Remove any lingering `playthrough` imports (grep `playthrough` across `src/` and fix — the store already moved to the registry in Task 2).

- [ ] **Step 5: Run tests + gate**

Run: `npx vitest run src/lib/demo/abducted.test.ts && npm test && npm run typecheck && npm run build`
Expected: PASS (grep confirms no dangling `playthrough` import).

- [ ] **Step 6: Commit**

```bash
git add src/lib/demo/abducted.ts src/lib/demo/registry.ts src/lib/demo/abducted.test.ts && git rm src/lib/demo/playthrough.ts
git commit -m "feat(demo): real HTB Abducted demo (0xdf transcript, redacted); retire fictional Forge"
```

---

## Task 4: THM RootMe demo (real content)

**Files:**
- Create: `src/lib/demo/rootme.ts`
- Modify: `src/lib/demo/registry.ts` (add RootMe)
- Test: `src/lib/demo/rootme.test.ts`

**Interfaces:**
- Consumes: `Step`, `makeDemo`.
- Produces: `ROOTME: DemoDef`, registered in `DEMOS`.

- [ ] **Step 1: Write the failing test** `src/lib/demo/rootme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ROOTME } from "./rootme";

describe("THM RootMe demo", () => {
  it("grades to a real report on the thm platform", () => {
    expect(ROOTME.platform).toBe("thm");
    expect(ROOTME.report.episodes.length).toBeGreaterThan(5);
  });
  it("is redacted: no flag hash / THM{...} token", () => {
    const blob = ROOTME.raw.map((r) => `${r.cmd} ${r.output_digest ?? ""}`).join("\n");
    expect(blob).not.toMatch(/\b[0-9a-f]{32}\b/i);
    expect(blob).not.toMatch(/THM\{[^}]+\}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/demo/rootme.test.ts`
Expected: FAIL — cannot find module `./rootme`.

- [ ] **Step 3: Author `rootme.ts`** — fetch a public RootMe write-up (WebFetch a well-known one, e.g. search "TryHackMe RootMe walkthrough"), and transcribe its real path: recon (`nmap`), content discovery (`gobuster`), the `/panel` file-upload filter bypass (`.phtml`/`.php5`) to a `www-data` reverse shell, then the SUID `python` GTFOBins privesc to root. Mirror the `Step`/`Session`/`GoldenObjective` shape of `abducted.ts`. Mask both flags (`THM{...}` → `[flag]`, and any hash). `machine: { name: "RootMe", os: "Linux", difficulty: "Easy" }`, `target_scope: "TryHackMe :: RootMe"`, `platform: "thm"`. Register in `registry.ts`: `export const DEMOS = [ABDUCTED, ROOTME];`.

- [ ] **Step 4: Run tests + gate**

Run: `npx vitest run src/lib/demo/rootme.test.ts && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/demo/rootme.ts src/lib/demo/registry.ts src/lib/demo/rootme.test.ts
git commit -m "feat(demo): real THM RootMe demo (public writeup transcript, redacted)"
```

---

## Task 5: Runtime avatar resolution

**Files:**
- Create: `src/lib/platform/avatar.ts`
- Modify: the target/emblem render path (where `emblem.avatar` is consumed) to call `resolveAvatar` when `avatar` is null and creds exist
- Test: `src/lib/platform/avatar.test.ts`

**Interfaces:**
- Produces: `async function resolveAvatar(target: { platform: string; name: string; url?: string|null }, creds?: { htbToken?: string }): Promise<string | null>` — returns an image URL or `null` (→ caller keeps `hue`).

- [ ] **Step 1: Write the failing test** `src/lib/platform/avatar.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { resolveAvatar } from "./avatar";

describe("resolveAvatar", () => {
  it("returns null (hue fallback) with no creds and no fetch", async () => {
    expect(await resolveAvatar({ platform: "htb", name: "Abducted" })).toBeNull();
  });
  it("resolves an HTB avatar URL from the profile API when a token is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ info: { avatar: "/storage/avatars/x.png" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const url = await resolveAvatar({ platform: "htb", name: "Abducted" }, { htbToken: "t" });
    expect(url).toContain("/storage/avatars/x.png");
    vi.unstubAllGlobals();
  });
  it("returns null on fetch failure (never throws)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await resolveAvatar({ platform: "htb", name: "Abducted" }, { htbToken: "t" })).toBeNull();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/platform/avatar.test.ts`
Expected: FAIL — cannot find module `./avatar`.

- [ ] **Step 3: Implement `avatar.ts`:**

```ts
/** Resolve a platform avatar image URL at runtime, under the user's own credentials.
 *  Never bundles third-party assets; any failure returns null so the caller keeps the hue emblem. */
const HTB_CDN = "https://labs.hackthebox.com";

export async function resolveAvatar(
  target: { platform: string; name: string; url?: string | null },
  creds: { htbToken?: string } = {},
): Promise<string | null> {
  try {
    if (target.platform === "htb" && creds.htbToken) {
      const slug = target.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const res = await fetch(`https://labs.hackthebox.com/api/v4/machine/profile/${slug}`, {
        headers: { Authorization: `Bearer ${creds.htbToken}`, Accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const path = data?.info?.avatar ?? data?.avatar ?? null;
      return path ? (path.startsWith("http") ? path : `${HTB_CDN}${path}`) : null;
    }
    if (target.platform === "thm" && target.url) {
      const res = await fetch(target.url);
      if (!res.ok) return null;
      const html = await res.text();
      const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      return m ? m[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Wire it in.** At the target/emblem render site (find the component that reads `emblem.avatar` — grep `emblem` in `src/components`), when `emblem.avatar` is null, kick off `resolveAvatar(target, { htbToken })` (token from wherever the HTB write-up fetch already reads it), and use the result if non-null, else keep the `hue` emblem. Keep it non-blocking (a `useEffect` that sets local state) and never throw. If the render site already handles a null avatar with hue, this is a small enhancement; do not restructure it.

- [ ] **Step 5: Run tests + gate**

Run: `npx vitest run src/lib/platform/avatar.test.ts && npm test && npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/platform/avatar.ts src/lib/platform/avatar.test.ts src/components/
git commit -m "feat(platform): runtime avatar resolution (HTB token / THM og:image / hue fallback)"
```

---

## Task 6: Docs + observable verification

**Files:**
- Modify: `README.md` (the demo mention), `TESTING.md` (the demo mention)

- [ ] **Step 1:** Update the README's Install "Watch live demo" line and TESTING.md to say the app ships **two real demos** (HTB Abducted, THM RootMe) selectable from History, streamed live then graded. Keep it short; do not re-add em-dash-heavy prose (the README is unslop-clean).

- [ ] **Step 2: Observable check.** Run `npm run dev`, open History, confirm two demo cards (Abducted, RootMe) each play live via **▶ Watch live demo** and settle into a graded report; confirm `?demo=<id>` auto-plays each. Note the result in the commit message.

- [ ] **Step 3: Commit**

```bash
git add README.md TESTING.md
git commit -m "docs: two real in-app demos (HTB Abducted, THM RootMe)"
```

---

## Self-Review

**Spec coverage:**
- §3 registry (DemoDef, DEMOS, demoById, startLiveDemo(id), History cards, ?demo=<id>) → Tasks 1–2. ✓
- §4 content (HTB Abducted transcript + retire Forge; THM RootMe transcript; redaction) → Tasks 3–4. ✓
- §5 avatars (resolveAvatar, HTB token / THM og:image / hue fallback, no committed assets) → Task 5. ✓
- §6 testing (registry, per-fixture validity + redaction, resolveAvatar mocked) → Tasks 1,3,4,5. ✓
- §0.6 no committed assets → Task 5 fetches at runtime, never writes image files. ✓
- §7 deferred (Immersive/capture-sourced) → registry accepts `raw` from any source; no task, correct. ✓

**Placeholder scan:** The two content fixtures (Tasks 3–4) are guided transcriptions of cited real write-ups — the commands are specified (Abducted's 24-command chain is enumerated; RootMe's path is named), and per-step outputs/timings are authored from the source, which is inherent to "transcribe a write-up," not a TODO. Every code unit (build, registry, store wiring, avatar) has complete code.

**Type consistency:** `Step`, `DemoDef`, `makeDemo`, `buildRaw`, `demoById`, `isDemoId`, `DEMOS`, `LEGACY_DEMO_ID`, `resolveAvatar` are defined in Task 1/5 and used with the same signatures in Tasks 2–5. `startLiveDemo(id?: string)` is updated consistently in the store interface and both callers (History, DemoDriver).
