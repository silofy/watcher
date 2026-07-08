# Onboarding Activation Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the static onboarding panel with a stepped activation flow — one step per screen, a real action + live confirmation each, driving the user to their first captured run, with a resume nudge that never traps them.

**Architecture:** Pure step/nudge logic in `src/lib/onboarding.ts` (node-tested). Persisted step state in the zustand store. A rewritten stateful `Onboarding.tsx` step machine that reads store signals — `startLiveDemo`/`demo` (step ①), `sessionCards` non-demo detection (step ②), the `llm/runtime` + `llm/mode` helpers (step ③). A header nudge pill driven by `shouldShowNudge`.

**Tech Stack:** React 18 + Tailwind v4, zustand, vitest (node env), existing Tauri commands (no new backend).

## Global Constraints

- No new Tauri backend commands. Capture detection = `sessionCards.some(c => !c.demo)` (real captures are ingested by the existing `LiveBridge` poll; demos carry `demo:true`). AI uses `src/lib/llm/runtime.ts` (`llmStatus`,`startOllama`,`pullModel`,`DEFAULT_MODEL`) and `src/lib/llm/mode.ts` (`setCoachMode`; `CoachMode = "rules" | "local" | CloudName`).
- No fake progress bar — `pullModel` has no progress events; the AI download is an indeterminate "Downloading…" state.
- Tests run in vitest's **node** env (no jsdom). Only pure logic is unit-tested; React is verified by `npm run typecheck` + an SSR-render smoke run by the controller. Do NOT add jsdom/testing-library.
- Reuse the merged plumbing: `onboardingOpen`, the `watcher.onboarded` flag, `openOnboarding`/`closeOnboarding`, the App mount, header reopen. Do not duplicate them.
- Persisted onboarding progress uses a namespaced localStorage key `watcher.onboardingProgress`, read/written through guards (`typeof localStorage !== "undefined"` + try/catch) so the node test env never throws.
- Intro demo id is exactly `"abducted"`. Tailwind tokens must be ones already in `src/index.css` (e.g. `bg-ink`, `bg-panel`, `bg-panel-2`, `border-edge`, `text-fg`, `text-muted`, `text-faint`, `text-ink`, `bg-signal`, `signal`, `match`, `stuck`, `ring-edge`, `label`, `font-display`, `mono`).

---

### Task 1: Pure step + nudge logic

**Files:**
- Modify: `src/lib/onboarding.ts` (append; keep the existing `ONBOARDED_KEY`/`ONBOARDED_VALUE`/`shouldOpenOnboarding`)
- Test: `src/lib/onboarding.test.ts` (append a new describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `STEP_COUNT: number` (4); `clampStep(n: number): number`; `shouldShowNudge(input: { onboarded: boolean; hasRealCapture: boolean }): boolean`; `deriveChecklist(input: { demoDone: boolean; hasRealCapture: boolean; aiDone: boolean }): { key: "demo"|"capture"|"ai"; label: string; done: boolean }[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/onboarding.test.ts`:

```ts
import { STEP_COUNT, clampStep, shouldShowNudge, deriveChecklist } from "./onboarding";

describe("activation-flow step logic", () => {
  it("clamps step into [0, STEP_COUNT-1]", () => {
    expect(clampStep(-2)).toBe(0);
    expect(clampStep(0)).toBe(0);
    expect(clampStep(STEP_COUNT - 1)).toBe(STEP_COUNT - 1);
    expect(clampStep(STEP_COUNT + 5)).toBe(STEP_COUNT - 1);
  });

  it("nudges only when onboarded but no real capture yet", () => {
    expect(shouldShowNudge({ onboarded: true, hasRealCapture: false })).toBe(true);
    expect(shouldShowNudge({ onboarded: true, hasRealCapture: true })).toBe(false);
    expect(shouldShowNudge({ onboarded: false, hasRealCapture: false })).toBe(false);
  });

  it("derives a 3-item checklist reflecting completion", () => {
    const list = deriveChecklist({ demoDone: true, hasRealCapture: false, aiDone: true });
    expect(list.map((i) => i.key)).toEqual(["demo", "capture", "ai"]);
    expect(list.find((i) => i.key === "demo")!.done).toBe(true);
    expect(list.find((i) => i.key === "capture")!.done).toBe(false);
    expect(list.find((i) => i.key === "ai")!.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/onboarding.test.ts`
Expected: FAIL — `STEP_COUNT`/`clampStep`/`shouldShowNudge`/`deriveChecklist` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/onboarding.ts`:

```ts
/** Number of steps in the activation flow. */
export const STEP_COUNT = 4;

/** Keep a step index within the valid range. */
export function clampStep(n: number): number {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > STEP_COUNT - 1) return STEP_COUNT - 1;
  return Math.floor(n);
}

/** The header "finish setup" pill shows once onboarding is dismissed but no real run exists yet. */
export function shouldShowNudge(input: { onboarded: boolean; hasRealCapture: boolean }): boolean {
  return input.onboarded && !input.hasRealCapture;
}

/** The step ④ recap list. Capture completion is derived from app state, not stored. */
export function deriveChecklist(input: { demoDone: boolean; hasRealCapture: boolean; aiDone: boolean }): { key: "demo" | "capture" | "ai"; label: string; done: boolean }[] {
  return [
    { key: "demo", label: "Watched a demo run", done: input.demoDone },
    { key: "capture", label: "Captured your own run", done: input.hasRealCapture },
    { key: "ai", label: "Turned on AI coaching", done: input.aiDone },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/onboarding.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding.ts src/lib/onboarding.test.ts
git commit -m "feat(onboarding): pure step + nudge + checklist logic"
```

---

### Task 2: Persisted step state in the store

**Files:**
- Modify: `src/store/report.ts` (import from `../lib/onboarding`; `ReportState` interface; guarded reader/writer near the existing `readOnboardingOpen`; creator object)
- Test: `src/store/report.test.ts` (append)

**Interfaces:**
- Consumes: `clampStep` from Task 1.
- Produces: store state `onboardingStep: number`, `onboardingDone: { demo: boolean; ai: boolean }`; actions `setOnboardingStep(n: number): void`, `markOnboardingStep(key: "demo" | "ai"): void`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/report.test.ts`:

```ts
describe("onboarding activation-flow state", () => {
  it("exposes step + done state and setters", () => {
    const s = useReport.getState();
    expect(typeof s.onboardingStep).toBe("number");
    expect(s.onboardingDone).toEqual(expect.objectContaining({ demo: expect.any(Boolean), ai: expect.any(Boolean) }));
    expect(typeof s.setOnboardingStep).toBe("function");
    expect(typeof s.markOnboardingStep).toBe("function");
  });

  it("clamps step and marks completion", () => {
    useReport.getState().setOnboardingStep(99);
    expect(useReport.getState().onboardingStep).toBe(3);
    useReport.getState().setOnboardingStep(-5);
    expect(useReport.getState().onboardingStep).toBe(0);
    useReport.getState().markOnboardingStep("demo");
    expect(useReport.getState().onboardingDone.demo).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/report.test.ts`
Expected: FAIL — new members undefined.

- [ ] **Step 3: Extend the import**

In `src/store/report.ts`, change the onboarding import to include `clampStep`:

```ts
import { ONBOARDED_KEY, ONBOARDED_VALUE, shouldOpenOnboarding, clampStep } from "../lib/onboarding";
```

- [ ] **Step 4: Add guarded progress reader/writer**

Next to the existing `readOnboardingOpen`/`persistOnboarded` helpers, add:

```ts
const PROGRESS_KEY = "watcher.onboardingProgress";

function readOnboardingProgress(): { step: number; done: { demo: boolean; ai: boolean } } {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(PROGRESS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { step?: number; done?: { demo?: boolean; ai?: boolean } };
        return { step: clampStep(p.step ?? 0), done: { demo: !!p.done?.demo, ai: !!p.done?.ai } };
      }
    }
  } catch {
    /* SSR / node / private mode — fresh */
  }
  return { step: 0, done: { demo: false, ai: false } };
}

function persistOnboardingProgress(step: number, done: { demo: boolean; ai: boolean }): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, done }));
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 5: Extend the `ReportState` interface**

Add after the existing `onboardingOpen` member:

```ts
  /** Current step of the activation flow (0-based). Persisted. */
  onboardingStep: number;
  /** Completion of steps not derivable from app state (capture completion is derived, not stored). */
  onboardingDone: { demo: boolean; ai: boolean };
```

and after `closeOnboarding` in the actions section:

```ts
  /** Set the activation-flow step (clamped) and persist. */
  setOnboardingStep: (n: number) => void;
  /** Mark a non-derivable step complete and persist. */
  markOnboardingStep: (key: "demo" | "ai") => void;
```

- [ ] **Step 6: Wire the creator**

Add initial state after `onboardingOpen: readOnboardingOpen(),`:

```ts
  onboardingStep: readOnboardingProgress().step,
  onboardingDone: readOnboardingProgress().done,
```

and the actions after `closeOnboarding`:

```ts
  setOnboardingStep: (n) => {
    const step = clampStep(n);
    persistOnboardingProgress(step, get().onboardingDone);
    set({ onboardingStep: step });
  },
  markOnboardingStep: (key) => {
    const done = { ...get().onboardingDone, [key]: true };
    persistOnboardingProgress(get().onboardingStep, done);
    set({ onboardingDone: done });
  },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/store/report.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 8: Commit**

```bash
git add src/store/report.ts src/store/report.test.ts
git commit -m "feat(onboarding): persisted activation-flow step state"
```

---

### Task 3: Rewrite Onboarding.tsx as the stepped activation flow

This task builds the UI. It is NOT verbatim transcription — build a polished, modern stepped
wizard that satisfies the contracts below. Use the design skill for craft. Match the app's
existing visual language (see `src/components/Install.tsx`, `src/components/ui.tsx`).

**Files:**
- Rewrite: `src/components/Onboarding.tsx`

**Interfaces (from store + libs — use exactly these):**
- Store (`useReport()`): `onboardingStep`, `setOnboardingStep(n)`, `onboardingDone`, `markOnboardingStep("demo"|"ai")`, `closeOnboarding()`, `startLiveDemo(id?)`, `demo` (`{ phase: "recording"|"resolved"|"compared"; n; total } | null`), `sessionCards` (array; real captures have `demo === false`), `switchSession(id)`.
- Pure logic: `STEP_COUNT`, `deriveChecklist` from `../lib/onboarding`.
- LLM: `llmStatus`, `pullModel`, `DEFAULT_MODEL` from `../lib/llm/runtime`; `setCoachMode` from `../lib/llm/mode`.
- Icons: from `./icons` (e.g. `ScanEye`, `ArrowUpRight`, plus any existing check/spinner icons — verify names in `icons.tsx`, do not invent).

**Behavior contract (must hold):**
1. Full-screen opaque overlay (`fixed inset-0 z-50 bg-ink`, scrollable), same as today.
2. A progress rail showing `STEP_COUNT` dots with the current index active and completed steps filled, plus `Step {n+1} of {STEP_COUNT}`.
3. Chrome per step: `Back` (hidden on step 0), a `Skip` that calls `closeOnboarding()`, and a primary `Next →` that calls `setOnboardingStep(onboardingStep + 1)` (the last step's primary is `Enter the Watcher →` → `closeOnboarding()`).
4. **Step ① Meet the Watcher:** `▶ Play a 60-second demo` → `startLiveDemo("abducted")`. Show a live readout from `demo`: while non-null, `▶ streaming… {demo.n}/{demo.total}`; when `demo.phase === "compared"` show a ✓ line and call `markOnboardingStep("demo")` (once). Copy: what the Watcher is (recorder → graded debrief; ATT&CK · Kill Chain · CWE; all local).
5. **Step ② Capture your first run (hero):** show `npm run capture -- --machine <box>` with a copy button. Compute `hasRealCapture = sessionCards.some(c => !c.demo)`. While false: `◦ waiting for a session…` + `Skip for now — I'll capture later` (→ `setOnboardingStep(step+1)`). When true: `✓ Captured "<name>" — <commands> commands` (pull name/command-count from the newest non-demo card if available; otherwise a generic "your run") + `Open my debrief →` (`switchSession(thatCard.id)` then `closeOnboarding()`). If not running in Tauri (`"__TAURI_INTERNALS__" in window` is false), show a one-line note that live detection runs in the desktop app — still skippable. Also show `--platform thm --target <name>` for other platforms.
6. **Step ③ Sharpen your coaching:** on mount, `await llmStatus()` (guard for non-desktop → just offer Skip/cloud). If a local model is present, show `✓ Local AI ready` and a `Use local AI` button (`setCoachMode("local")`, `markOnboardingStep("ai")`). If missing, `⬇ Download local model (~2 GB)` → set a local `downloading` state, `await pullModel(DEFAULT_MODEL)`; on `true` → `setCoachMode("local")`, `markOnboardingStep("ai")`, show ✓; on failure → inline error + retry. Always a `Paste a cloud key` affordance (link to the existing top-bar AI menu is acceptable — do not rebuild the cloud-key form) and `Skip — rules-based coaching is solid` (`setCoachMode("rules")` optional, then advance). Indeterminate spinner only — no percentage.
7. **Step ④ You're set:** render `deriveChecklist({ demoDone: onboardingDone.demo, hasRealCapture, aiDone: onboardingDone.ai })` as a ✓/○ list, plus a pointer line "Load a write-up to unlock the comparison" (a plain informational line or a link that closes the wizard — do not build new reference-path UI). Primary `Enter the Watcher →` → `closeOnboarding()`.
8. No thrown errors during SSR render (no top-level `navigator`/`window` access at module load; guard clipboard writes in a try/catch; run `llmStatus()` inside an effect, not during render).

- [ ] **Step 1: Confirm available icons**

Run: `grep -nE "export function" src/components/icons.tsx` and use only names that exist (e.g. a check/tick, spinner, copy). If a needed glyph is absent, use a text glyph (✓, ◦, ⧉) rather than inventing an import.

- [ ] **Step 2: Build `src/components/Onboarding.tsx`**

Implement the full stepped component per the behavior contract above. Keep sub-components (`ProgressRail`, `StepShell`, one component per step) in this one file for cohesion. Match existing Tailwind tokens and the chip/card styling used in `Install.tsx`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. Fix any token/import/type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Onboarding.tsx
git commit -m "feat(onboarding): stepped activation-flow wizard (demo, capture, AI, recap)"
```

---

### Task 4: Header nudge pill + wiring

**Files:**
- Modify: `src/App.tsx` (header right-cluster; imports; `useReport` destructure)

**Interfaces:**
- Consumes: `shouldShowNudge` from `../lib/onboarding`; store `onboardingOpen`, `openOnboarding`, `setOnboardingStep`, `sessionCards`; the merged `watcher.onboarded` flag is reflected by `onboardingOpen === false` after first dismissal — use `!onboardingOpen` as the "onboarded/there-this-session" signal combined with the persisted flag already gating first run.
- Produces: nothing downstream.

- [ ] **Step 1: Add the nudge pill**

In `src/App.tsx`, pull the needed state into the existing `useReport()` destructure: add `openOnboarding, setOnboardingStep, sessionCards` (in addition to `onboardingOpen` already there from #2).

Compute near the top of `App()`:

```tsx
  const hasRealCapture = sessionCards.some((c) => !c.demo);
  const showNudge = !onboardingOpen && shouldShowNudge({ onboarded: true, hasRealCapture });
```

(Justification: the wizard only reaches the app after first-run dismissal or when already onboarded, so within `App` `!onboardingOpen` implies the flag was set. `shouldShowNudge` then hides it once a real capture exists.)

Import at top: `import { shouldShowNudge } from "./lib/onboarding";`

In the header right-cluster, replace the existing static "Setup guide" button with the conditional nudge plus the always-available reopen:

```tsx
              {showNudge ? (
                <button
                  type="button"
                  onClick={() => { setOnboardingStep(1); openOnboarding(); }}
                  className="label inline-flex items-center gap-1 rounded-full border border-signal/50 bg-signal/10 px-2.5 py-1 text-signal transition-colors hover:bg-signal/15"
                  title="Finish setup — capture your first run"
                >
                  ⚡ Finish setup <ArrowUpRight size={12} />
                </button>
              ) : (
                <button type="button" onClick={openOnboarding} className="label text-faint hover:text-muted">
                  Setup guide
                </button>
              )}
```

Ensure `ArrowUpRight` is imported in `App.tsx` (it already imports from `./components/icons`; add it to that import if missing).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(onboarding): header finish-setup nudge until first real capture"
```

---

### Task 5: Full-suite gate

- [ ] **Step 1: Run everything**

Run: `npm test` then `npm run typecheck`
Expected: full vitest suite green; typecheck exit 0.

- [ ] **Step 2: Controller SSR smoke (no commit)**

The controller renders each step of `<Onboarding />` via `vite-node` to confirm every step mounts (setting `onboardingStep` 0..3) with expected copy, then deletes the scratch script. Not committed.

- [ ] **Step 3: Commit (only if step 1 required a fix)**

Otherwise nothing to commit — the suite gate is verification, not a change.

---

## Self-Review

**Spec coverage:** activation flow shape (Tasks 3); one action + live confirm per step (Task 3 contract 4–7); skippable + resume nudge (Tasks 1 `shouldShowNudge`, 4); capture detection via non-demo `sessionCards` (Tasks 3–4); AI via runtime/mode, indeterminate download (Task 3 contract 6); persisted step state (Task 2); reuse of merged plumbing (all); no new backend (constraints). ✓

**Placeholder scan:** none — Tasks 1/2/4 carry complete code; Task 3 is an explicit design-brief task (UI built with latitude) with a hard behavior contract and verification, which is the correct granularity for a polished component in a repo with no component-test harness. ✓

**Type consistency:** `onboardingStep`/`onboardingDone`/`setOnboardingStep`/`markOnboardingStep` identical across Tasks 2–4; `shouldShowNudge`/`clampStep`/`deriveChecklist`/`STEP_COUNT` identical across Tasks 1–4; `setCoachMode`/`pullModel`/`llmStatus`/`DEFAULT_MODEL` match the pinned lib exports; capture signal `sessionCards.some(c => !c.demo)` identical in Tasks 3 and 4. ✓
