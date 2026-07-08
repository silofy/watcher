# Onboarding Wizard + `npm run capture` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Tauri desktop app a full-screen first-run onboarding wizard and a single cross-platform `npm run capture` command, and purge the confusing bare-`watcher-capture` instructions from every surface.

**Architecture:** A Node wrapper script builds-if-needed and execs the Rust capture agent. A pure decision helper + zustand store state drive a presentational full-screen wizard overlay in `App.tsx`, gated by a `localStorage` flag. The Install tab and docs are rewritten to point at `npm run capture`. Pure logic is unit-tested in the node vitest env; React pieces are verified by running the app (the repo has no component-test harness).

**Tech Stack:** Node (ESM `.mjs`), React 18 + Tailwind v4, zustand, vitest (node environment), Rust/Cargo (existing capture crate).

## Global Constraints

- Node ≥ 20; the wrapper and app must work on win32, darwin, and linux.
- Tests run in vitest's **node** environment — no jsdom, no `localStorage`/DOM. React components are NOT unit-tested; they are verified via `npm run dev` (matches every existing component in this repo). Only pure logic gets tests.
- Every user-facing setup surface (wizard, Install tab, README, CAPTURE.md) must show `npm run capture -- …` as the primary command. A bare `watcher-capture --attach --machine <name>` shell command must never be the headline instruction again.
- `localStorage` key is exactly `watcher.onboarded`; the "done" value is exactly `"1"`.
- The intro demo id passed to `startLiveDemo` is exactly `"abducted"`.
- Follow existing Tailwind token classes already used in `App.tsx`/`Install.tsx`: `bg-ink`, `border-edge`, `text-fg`, `text-muted`, `text-faint`, `label`, `font-display`, `signal`, `panel`, `mono`.

---

### Task 1: `npm run capture` wrapper

**Files:**
- Create: `scripts/capture.mjs`
- Modify: `package.json` (scripts block, after line `"doctor": "node scripts/doctor.mjs",`)
- Test: `tests/capture-wrapper.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: from `scripts/capture.mjs` — `MODE_FLAGS: string[]`, `withDefaultMode(args: string[]): string[]`, `binaryRelPath(platform: string): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/capture-wrapper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withDefaultMode, binaryRelPath, MODE_FLAGS } from "../scripts/capture.mjs";

describe("capture wrapper arg handling", () => {
  it("injects --attach when no mode flag is present", () => {
    expect(withDefaultMode(["--machine", "Blue"])).toEqual(["--attach", "--machine", "Blue"]);
  });

  it("leaves args untouched when a mode flag is present", () => {
    expect(withDefaultMode(["--export", "x.json", "--machine", "Blue"]))
      .toEqual(["--export", "x.json", "--machine", "Blue"]);
    expect(withDefaultMode(["--attach", "--machine", "Blue"]))
      .toEqual(["--attach", "--machine", "Blue"]);
  });

  it("treats every documented mode flag as a mode", () => {
    expect(MODE_FLAGS).toEqual(expect.arrayContaining(["--attach", "--export", "-i", "--interactive", "--forward"]));
  });

  it("resolves the platform binary path", () => {
    expect(binaryRelPath("win32")).toBe("crates/capture/target/release/watcher-capture.exe");
    expect(binaryRelPath("linux")).toBe("crates/capture/target/release/watcher-capture");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capture-wrapper.test.ts`
Expected: FAIL — cannot resolve `../scripts/capture.mjs`.

- [ ] **Step 3: Write the wrapper**

Create `scripts/capture.mjs`:

```js
#!/usr/bin/env node
// npm run capture -- --machine <box>
// Builds the Rust capture agent if needed, then execs it with your args forwarded.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Passing any of these means the user chose a capture mode; otherwise we default to --attach
// so the shortest happy path is `npm run capture -- --machine <box>`.
export const MODE_FLAGS = ["--attach", "--export", "-i", "--interactive", "--forward"];

export function withDefaultMode(args) {
  return args.some((a) => MODE_FLAGS.includes(a)) ? args : ["--attach", ...args];
}

export function binaryRelPath(platform) {
  const exe = platform === "win32" ? "watcher-capture.exe" : "watcher-capture";
  return `crates/capture/target/release/${exe}`;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const crateDir = join(repoRoot, "crates", "capture");
const manifest = join(crateDir, "Cargo.toml");
const binPath = join(repoRoot, binaryRelPath(process.platform));
const winShell = process.platform === "win32";

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    const m = entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}

function needsBuild() {
  if (!existsSync(binPath)) return true;
  try {
    return newestMtime(join(crateDir, "src")) > statSync(binPath).mtimeMs;
  } catch {
    return false;
  }
}

function ensureCargo() {
  const probe = spawnSync("cargo", ["--version"], { stdio: "ignore", shell: winShell });
  if (probe.error || probe.status !== 0) {
    console.error(
      "[capture] Rust's `cargo` isn't on your PATH, so the capture agent can't be built.\n" +
      "          Install the toolchain (https://rustup.rs), then check with:  npm run doctor",
    );
    process.exit(1);
  }
}

function main() {
  const forwarded = withDefaultMode(process.argv.slice(2));
  if (needsBuild()) {
    ensureCargo();
    console.error("[capture] building the capture agent (first run or sources changed)…");
    const build = spawnSync("cargo", ["build", "--release", "--manifest-path", manifest], {
      stdio: "inherit",
      shell: winShell,
    });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  // stdio inherited so the interactive PTY attach uses the real terminal.
  const child = spawn(binPath, forwarded, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

// Run only when invoked directly (`node scripts/capture.mjs`), not when imported by the test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/capture-wrapper.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the npm script**

In `package.json`, add to the `"scripts"` block immediately after the `"doctor"` line:

```json
    "capture": "node scripts/capture.mjs",
```

- [ ] **Step 6: Manual smoke check**

Run: `npm run capture -- --machine SmokeTest`
Expected: on a fresh checkout it prints the build line, compiles the crate once, then the agent starts a watched shell (or, in a non-TTY shell, runs its scripted session). Ctrl-C / `exit` to stop. If `cargo` is absent, it prints the guidance line and exits 1 — no stack trace.

- [ ] **Step 7: Commit**

```bash
git add scripts/capture.mjs tests/capture-wrapper.test.ts package.json
git commit -m "feat(capture): npm run capture wrapper — builds if needed, forwards args, defaults to --attach"
```

---

### Task 2: Onboarding decision helper

**Files:**
- Create: `src/lib/onboarding.ts`
- Test: `src/lib/onboarding.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ONBOARDED_KEY: "watcher.onboarded"`, `ONBOARDED_VALUE: "1"`, `shouldOpenOnboarding(input: { stored: string | null; force: boolean }): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/onboarding.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldOpenOnboarding, ONBOARDED_KEY, ONBOARDED_VALUE } from "./onboarding";

describe("shouldOpenOnboarding", () => {
  it("opens on a fresh install (no stored flag)", () => {
    expect(shouldOpenOnboarding({ stored: null, force: false })).toBe(true);
  });

  it("stays closed once onboarding is marked done", () => {
    expect(shouldOpenOnboarding({ stored: ONBOARDED_VALUE, force: false })).toBe(false);
  });

  it("force-opens regardless of the stored flag", () => {
    expect(shouldOpenOnboarding({ stored: ONBOARDED_VALUE, force: true })).toBe(true);
  });

  it("uses the agreed storage key and value", () => {
    expect(ONBOARDED_KEY).toBe("watcher.onboarded");
    expect(ONBOARDED_VALUE).toBe("1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/onboarding.test.ts`
Expected: FAIL — cannot resolve `./onboarding`.

- [ ] **Step 3: Write the helper**

Create `src/lib/onboarding.ts`:

```ts
/** First-run wizard gating. Pure so it's testable in the node vitest env; all DOM/localStorage
 *  access lives in the store's guarded reader. */
export const ONBOARDED_KEY = "watcher.onboarded";
export const ONBOARDED_VALUE = "1";

/** Should the first-run wizard be open on load? `force` is the ?onboarding=1 dev override. */
export function shouldOpenOnboarding(input: { stored: string | null; force: boolean }): boolean {
  if (input.force) return true;
  return input.stored !== ONBOARDED_VALUE;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/onboarding.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding.ts src/lib/onboarding.test.ts
git commit -m "feat(onboarding): pure first-run gating helper"
```

---

### Task 3: Store wiring for the wizard

**Files:**
- Modify: `src/store/report.ts` (imports near line 21; `ReportState` interface lines 147-200; creator object lines 212-234)
- Test: `src/store/report.test.ts`

**Interfaces:**
- Consumes: `shouldOpenOnboarding`, `ONBOARDED_KEY`, `ONBOARDED_VALUE` from Task 2; existing `startLiveDemo` from the store.
- Produces: store state `onboardingOpen: boolean` and actions `openOnboarding(): void`, `closeOnboarding(): void`.

- [ ] **Step 1: Write the failing test**

Add to `src/store/report.test.ts`:

```ts
import { ONBOARDED_KEY } from "../lib/onboarding";

describe("onboarding wizard state", () => {
  it("exposes onboardingOpen plus open/close actions", () => {
    const s = useReport.getState();
    expect(typeof s.onboardingOpen).toBe("boolean");
    expect(typeof s.openOnboarding).toBe("function");
    expect(typeof s.closeOnboarding).toBe("function");
  });

  it("closeOnboarding closes the wizard, openOnboarding reopens it", () => {
    useReport.getState().closeOnboarding();
    expect(useReport.getState().onboardingOpen).toBe(false);
    useReport.getState().openOnboarding();
    expect(useReport.getState().onboardingOpen).toBe(true);
  });

  it("keeps the agreed storage key available for the store to persist", () => {
    expect(ONBOARDED_KEY).toBe("watcher.onboarded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/report.test.ts`
Expected: FAIL — `onboardingOpen`/`openOnboarding`/`closeOnboarding` undefined.

- [ ] **Step 3: Add the import**

In `src/store/report.ts`, near the existing demo-registry import (line 21), add:

```ts
import { ONBOARDED_KEY, ONBOARDED_VALUE, shouldOpenOnboarding } from "../lib/onboarding";
```

- [ ] **Step 4: Add the guarded reader**

In `src/store/report.ts`, just above `export const useReport = create<ReportState>(...)` (line 212), add:

```ts
// DOM/localStorage access is guarded so the store still imports cleanly in the node test env
// (where both are undefined → treated as a fresh install → wizard open).
function readOnboardingOpen(): boolean {
  let stored: string | null = null;
  let force = false;
  try {
    if (typeof localStorage !== "undefined") stored = localStorage.getItem(ONBOARDED_KEY);
    if (typeof location !== "undefined") force = new URLSearchParams(location.search).has("onboarding");
  } catch {
    /* private-mode / SSR / node — fall through to first-run defaults */
  }
  return shouldOpenOnboarding({ stored, force });
}

function persistOnboarded(): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(ONBOARDED_KEY, ONBOARDED_VALUE);
  } catch {
    /* ignore — the wizard still closes for this session */
  }
}
```

- [ ] **Step 5: Extend the `ReportState` interface**

In `src/store/report.ts`, add these members to the `ReportState` interface (after the `demo:` state field near line 174, and after `setPlaying` near line 199):

```ts
  /** First-run wizard visibility; initialised from localStorage (or ?onboarding=1). */
  onboardingOpen: boolean;
```

```ts
  /** Open the setup wizard from the header "Setup guide"; does not clear the onboarded flag. */
  openOnboarding: () => void;
  /** Dismiss the wizard and persist that onboarding is done. */
  closeOnboarding: () => void;
```

- [ ] **Step 6: Add state + actions to the creator**

In the `create<ReportState>` object, add the initial state after `demo: null,` (line 231):

```ts
  onboardingOpen: readOnboardingOpen(),
```

and add the actions after `setGateDismissed` (line 234):

```ts
  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => {
    persistOnboarded();
    set({ onboardingOpen: false });
  },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/store/report.test.ts`
Expected: PASS (existing test + 3 new).

- [ ] **Step 8: Commit**

```bash
git add src/store/report.ts src/store/report.test.ts
git commit -m "feat(onboarding): store state + persisted open/close actions"
```

---

### Task 4: The wizard component

**Files:**
- Create: `src/components/Onboarding.tsx`

**Interfaces:**
- Consumes: `useReport` — `closeOnboarding`, `startLiveDemo`.
- Produces: `Onboarding` React component (default-closed via the store; renders its own full-screen overlay).

- [ ] **Step 1: Write the component**

Create `src/components/Onboarding.tsx`:

```tsx
import { useReport } from "../store/report";
import { ScanEye, ArrowUpRight } from "./icons";

const CAPTURE_CMD = "npm run capture -- --machine <box>";

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex gap-3.5">
      <span className="label flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel-2 text-sm text-muted ring-1 ring-edge">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-base font-semibold text-fg">{title}</h3>
        <div className="mt-1 space-y-2 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </section>
  );
}

export function Onboarding() {
  const { closeOnboarding, startLiveDemo } = useReport();

  const watchDemo = () => {
    closeOnboarding();
    startLiveDemo("abducted");
  };

  const copyCmd = () => {
    try {
      void navigator.clipboard?.writeText(CAPTURE_CMD);
    } catch {
      /* clipboard blocked — the command is visible to copy by hand */
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ink">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-7 px-6 py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-signal/15 text-signal">
              <ScanEye size={15} />
            </span>
            <span className="font-display text-lg font-semibold text-fg">Welcome to the Watcher</span>
          </div>
          <button type="button" onClick={closeOnboarding} className="label text-faint hover:text-muted">
            Skip
          </button>
        </header>

        <div className="space-y-6">
          <Step n="1" title="What it is">
            <p>
              A flight-data-recorder for your hacking practice. Record a run against any box, then get a
              graded debrief — read at once through <span className="text-fg">MITRE ATT&amp;CK</span>,{" "}
              <span className="text-fg">the Unified Kill Chain</span>, and <span className="text-fg">CWE</span>.
              Everything runs on your machine.
            </p>
          </Step>

          <Step n="2" title="See it work">
            <p>Watch a real run build command-by-command, then settle into the debrief.</p>
            <button
              type="button"
              onClick={watchDemo}
              className="label inline-flex items-center gap-1.5 rounded-md border border-signal/40 bg-signal/10 px-3 py-1.5 text-signal transition-colors hover:bg-signal/15"
            >
              ▶ Watch a demo (HTB Abducted)
            </button>
          </Step>

          <Step n="3" title="Capture your own run">
            <p>Record a box you're playing with one command, from the repo root:</p>
            <div className="mono flex items-center justify-between gap-3 overflow-x-auto rounded border border-edge bg-ink/60 px-2.5 py-1.5 text-xs text-fg">
              <span>{CAPTURE_CMD}</span>
              <button type="button" onClick={copyCmd} className="label shrink-0 text-faint hover:text-fg">
                copy
              </button>
            </div>
            <p className="text-faint">
              Other platforms: <code className="mono">--platform thm --target &lt;name&gt;</code>. Capture builds a
              small Rust agent the first time — run <code className="mono">npm run doctor</code> if you're unsure
              you're set up.
            </p>
          </Step>

          <Step n="4" title="Go further (optional)">
            <ul className="space-y-1.5">
              <li>
                <span className="text-fg">Reference path</span> — unlocks the write-up comparison and golden path.
              </li>
              <li>
                <span className="text-fg">AI coaching</span> — sharper wording, still local-first.
              </li>
              <li>
                <span className="text-fg">Web capture</span> (<code className="mono">--web</code> + Burp) — fold
                browser/HTTP attacks onto the same timeline; off by default, only for Burp workflows.
              </li>
            </ul>
            <p className="text-faint">Set these up anytime in the Install tab.</p>
          </Step>
        </div>

        <footer className="mt-auto flex items-center justify-end gap-4 border-t border-edge pt-5">
          <button type="button" onClick={closeOnboarding} className="label text-faint hover:text-muted">
            Skip
          </button>
          <button
            type="button"
            onClick={closeOnboarding}
            className="label inline-flex items-center gap-1 rounded-md bg-signal px-4 py-1.5 text-ink"
          >
            Done <ArrowUpRight size={12} />
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no type errors). If `bg-panel-2` or a token is unknown to your setup, confirm it against `src/index.css` and swap for the nearest existing token used in `Install.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Onboarding.tsx
git commit -m "feat(onboarding): full-screen first-run wizard component"
```

---

### Task 5: Mount the wizard + header reopen affordance

**Files:**
- Modify: `src/App.tsx` (import block lines 1-24; `useReport` destructure line 92; header right-cluster lines 141-144; overlay render inside root `div` at line 121)

**Interfaces:**
- Consumes: `Onboarding` (Task 4); store `onboardingOpen`, `openOnboarding` (Task 3).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Import the component**

In `src/App.tsx`, add with the other component imports (after line 21):

```tsx
import { Onboarding } from "./components/Onboarding";
```

- [ ] **Step 2: Pull the state**

Change the destructure on line 92 from:

```tsx
  const { report, view, gateDismissed, revealNonce } = useReport();
```

to:

```tsx
  const { report, view, gateDismissed, revealNonce, onboardingOpen, openOnboarding } = useReport();
```

- [ ] **Step 3: Render the overlay**

In `src/App.tsx`, immediately inside the root `<div className="min-h-full">` (line 121, before `<DemoDriver />`), add:

```tsx
      {onboardingOpen && <Onboarding />}
```

- [ ] **Step 4: Add the header "Setup guide" affordance**

In the header right-cluster (the `<div className="flex items-center gap-2.5 text-xs">` at line 141), add as the first child, before `<PwnboxSync />`:

```tsx
              <button type="button" onClick={openOnboarding} className="label text-faint hover:text-muted">
                Setup guide
              </button>
```

- [ ] **Step 5: Verify in the running app**

Run: `npm run dev`, open http://localhost:5173/?onboarding=1
Expected:
- The full-screen wizard covers the app.
- "▶ Watch a demo (HTB Abducted)" closes the wizard and streams the Abducted run live in Debrief.
- Reload plain http://localhost:5173/ — wizard is gone (flag persisted). Reload again — still gone.
- Click "Setup guide" in the header — the wizard reopens.
- In devtools, `localStorage.getItem("watcher.onboarded")` returns `"1"` after Skip/Done.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(onboarding): mount first-run wizard overlay + header reopen link"
```

---

### Task 6: Rewrite Install tab + docs to `npm run capture`

**Files:**
- Modify: `src/components/Install.tsx` (Tier A `Code` + steps, lines 53-58)
- Modify: `README.md` ("Capture your own runs", lines 178-185)
- Modify: `crates/capture/CAPTURE.md` (Path A, lines 17-23)
- Test: `tests/capture-docs.test.ts`

**Interfaces:**
- Consumes: the `npm run capture` command shape from Task 1.
- Produces: a regression guard asserting each surface documents `npm run capture`.

- [ ] **Step 1: Write the failing guard test**

Create `tests/capture-docs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const surfaces = ["README.md", "crates/capture/CAPTURE.md", "src/components/Install.tsx"];

describe("capture setup surfaces lead with npm run capture", () => {
  for (const rel of surfaces) {
    it(`${rel} documents the npm run capture command`, () => {
      const text = readFileSync(resolve(root, rel), "utf8");
      expect(text).toContain("npm run capture");
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/capture-docs.test.ts`
Expected: FAIL — none of the three files contain `npm run capture` yet.

- [ ] **Step 3: Rewrite Install tab Tier A**

In `src/components/Install.tsx`, replace the Tier A body (lines 54-57):

```tsx
          <Code>watcher-capture --attach --machine &lt;name&gt;</Code>
          <Step>Live — self-starts a session and streams each command as you run it. <code>exit</code> to stop. macOS / Linux / Windows.</Step>
          <Step>A second terminal running <code>watcher-capture --attach</code> on the same box asks whether to join the live session or start fresh — <code>--new</code> forces a new one.</Step>
          <Step>Pick the shell with <code>--shell bash</code> (or <code>pwsh</code>, <code>zsh</code>, …) — handy for git-bash / WSL on Windows; defaults to your login shell.</Step>
```

with:

```tsx
          <Code>npm run capture -- --machine &lt;name&gt;</Code>
          <Step>Run it from the repo root. It builds the capture agent the first time, then streams each command live as you run it. <code>exit</code> to stop. macOS / Linux / Windows.</Step>
          <Step>Other platforms name the target neutrally: <code>npm run capture -- --platform thm --target &lt;name&gt;</code>.</Step>
          <Step>A second terminal running <code>npm run capture</code> on the same box asks whether to join the live session or start fresh — add <code>-- --new</code> to force a new one. Pick a shell with <code>-- --shell bash</code> (or <code>pwsh</code>, <code>zsh</code>, …).</Step>
```

- [ ] **Step 4: Rewrite README "Capture your own runs"**

In `README.md`, replace the code block (lines 180-183):

````markdown
```sh
cd crates/capture && cargo build --release
./target/release/watcher-capture --attach --machine <box>
```
````

with:

````markdown
```sh
npm run capture -- --machine <box>
```

Run it from the repo root — it builds the capture agent the first time, then streams each command into the app live; type `exit` to stop. Pass `--platform <htb|thm|offsec|immersive|local> --target <name>` to name the target neutrally instead of `--machine`.

<details><summary>Advanced: run the binary directly (no Node)</summary>

```sh
cd crates/capture && cargo build --release
./target/release/watcher-capture --attach --machine <box>   # Windows: .\target\release\watcher-capture.exe
```

</details>
````

Then delete the now-duplicated sentence that followed the old block (the `Commands stream into the app live; type `exit` to stop. Pass `--platform …` line at line 185), keeping the remaining "The in-app **Install** tab walks through both capture paths … Full guide: …" text.

- [ ] **Step 5: Rewrite CAPTURE.md Path A**

In `crates/capture/CAPTURE.md`, replace lines 19-23:

````markdown
   ```
   watcher-capture --attach --machine Forge
   ```

   On Windows: `& "…\crates\capture\target\debug\watcher-capture.exe" --attach --machine Forge` (one line).
````

with:

````markdown
   ```
   npm run capture -- --machine Forge
   ```

   Run from the repo root (works the same on macOS, Linux, and Windows). It builds the agent the
   first time, then attaches. To run the compiled binary directly instead:
   `./crates/capture/target/release/watcher-capture --attach --machine Forge`
   (Windows: `.\crates\capture\target\release\watcher-capture.exe`).
````

- [ ] **Step 6: Run the guard test + full suite**

Run: `npx vitest run tests/capture-docs.test.ts`
Expected: PASS (3 tests).

Run: `npm test`
Expected: PASS — full suite green (existing + all new tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/Install.tsx README.md crates/capture/CAPTURE.md tests/capture-docs.test.ts
git commit -m "docs(capture): point Install tab, README, and CAPTURE.md at npm run capture"
```

---

## Self-Review

**Spec coverage:**
- Wrapper (spec §1) → Task 1. ✓ (build-if-needed, arg forward, default `--attach`, cargo-missing guidance)
- Wizard component + 4 steps + Abducted demo (spec §2) → Tasks 4. ✓
- First-run persistence + `?onboarding=1` + header reopen (spec §3) → Tasks 2, 3, 5. ✓
- Install tab rewrite + README + CAPTURE.md (spec §4) → Task 6. ✓
- `--web`/Burp as optional bullet, never gating (spec §2 step ④) → Task 4 step ④. ✓
- Testing plan (spec "Testing") → wrapper/helper/store/docs unit tests; React verified via `npm run dev` per Global Constraints. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `onboardingOpen`/`openOnboarding`/`closeOnboarding` named identically across Tasks 3, 4, 5. `withDefaultMode`/`binaryRelPath`/`MODE_FLAGS` identical across Task 1 script and test. `startLiveDemo("abducted")` matches the existing store signature and the registry slug. `ONBOARDED_KEY`/`ONBOARDED_VALUE`/`shouldOpenOnboarding` identical across Tasks 2 and 3. ✓

**Note for the implementer:** Task 4 references Tailwind token `bg-panel-2`; if your `src/index.css` doesn't define it, substitute the token `Install.tsx` uses for the same chip (it uses `bg-panel-2` at line 25 of the current file, so it exists). Verify at typecheck/`npm run dev`.
