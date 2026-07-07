# Design Spec — Real-Content In-App Demos (HTB · THM · Immersive)

**Date:** 2026-07-07
**Status:** Approved for implementation (pending spec review)
**Depends on:** the demo driver (`src/lib/demo/playthrough.ts`, `src/components/DemoDriver.tsx`, `src/store/report.ts` `startLiveDemo`), the platform adapters (`src/lib/platform/*`), the `emblem: { avatar, hue }` slot (`src/types/report.ts`), and the report pipeline (`assembleReport`).

---

## 0. Working rules

1. **TDD** — failing test first for every unit that has logic.
2. **Green gate** — `npm test`, `npm run typecheck`, `npm run build` pass; output pristine.
3. **Additive & backward-compatible** — the single hardcoded demo becomes one entry in a registry; the current demo behavior (`?demo=live`, History card, live streaming) is preserved.
4. **Real content, not fabricated** — HTB and THM demos are transcribed from public write-ups (real command paths); the Immersive demo is a real capture the user provides. No invented boxes.
5. **Redaction** — every shipped demo runs through `public_safe`: IPs, flags, and credentials are masked before the fixture is committed.
6. **No third-party assets committed** — platform logos and machine avatars are the platforms' IP. The repo ships zero of their image files; avatars are fetched at runtime under the user's own credentials, else the neutral `hue` emblem shows.

---

## 1. Thesis

Today there is exactly one demo: a **fictional** "Forge" run hardcoded as `DEMO_RAW`. This replaces it with **three real-content demos** — one HTB machine, one THM room, one Immersive lab — launchable in-app, by generalizing the single-demo path into a small **demo registry** and populating the existing `emblem.avatar` slot per platform. The demos stream and grade exactly like a real capture; only their *source* differs (two transcribed from public write-ups, one captured by the user).

---

## 2. Goals / non-goals

**Goals**
- A demo registry holding N demos; each launchable from its own History card and via `?demo=<id>`.
- Three demos: **HTB Abducted** (medium, Ubuntu 24.04), **THM RootMe** (free room), **Immersive** (user-supplied capture).
- Per-platform avatar population into `emblem.avatar`, fetched at runtime, with the `hue` fallback.
- All shipped content redacted `public_safe`.

**Non-goals**
- Not fetching demo *content* live per run (demos are static fixtures).
- Not committing any platform logo or avatar image to the repo.
- Not auto-capturing Immersive (no public source; the user provides the NDJSON).
- Not changing the grading pipeline.

---

## 3. Demo registry

Replace the singular `DEMO_ID` / `DEMO_RAW` / `DEMO_REPORT` wiring with a list. Each demo is a descriptor:

```ts
interface DemoDef {
  id: string;                 // e.g. "htb-abducted", "thm-rootme", "immersive-<lab>"
  platform: "htb" | "thm" | "immersive";
  target: string;             // display name ("Forge")
  source: "transcript" | "capture";  // provenance, shown honestly in the card
  raw: RawCommand[];          // the streamed steps (from transcript or parsed NDJSON)
  golden: GoldenObjective[];  // the intended path
  session: Session;           // target/platform/started_at, avatar left to §5
}
```

- `src/lib/demo/registry.ts` exports `DEMOS: DemoDef[]` and helpers (`demoById`, `demoReport(id)` = memoized `assembleReport`).
- `store/report.ts`: `startLiveDemo(id)` (was arg-less) streams that demo's `raw`; History renders one card per `DEMOS` entry (each with `demo: true`, its platform emblem, and a small "transcribed" / "captured" provenance tag). `?demo=<id>` (and legacy `?demo=live` → the first/HTB demo) auto-launch.
- Fixtures live in `src/lib/demo/` (transcribed `.ts`) and `fixtures/` (the Immersive `.ndjson` the user drops in, parsed via the existing `parseEnvelopes`/`envelopesToRawCommands`).

## 4. Content sourcing

- **HTB Abducted & THM RootMe (transcript):** transcribed from their public write-ups into a `Step[]` list (command, think-gap, duration, output, line count), mirroring the existing `playthrough.ts` shape, plus authored `GoldenObjective[]` for the intended path. Commands are the real path; outputs are reconstructed from the write-up; **flags/creds/IPs are redacted**. Each fixture header cites its write-up source. HTB Abducted source: `https://0xdf.gitlab.io/2026/07/07/htb-abducted.html` — a ~24-command chain (SMB/rpcclient recon → Samba print-job command injection CVE-2026-4480 → `rclone reveal` creds to *scott* → Samba wide-links + force-user SSH-key injection to *marcus* → operators-group systemd `ExecStartPre` SetUID-bash to root). This real demo **replaces** the fictional Forge `playthrough.ts`.
- **Immersive (capture):** the user records the lab with `watcher-capture --attach --platform immersive --target "<lab>"`, producing a session NDJSON. That file is dropped into `fixtures/demo-immersive-<lab>.ndjson`, redacted `public_safe`, and loaded through the existing envelope→RawCommand path. Until the file exists, the Immersive slot is registered but marked unavailable (its card is hidden/disabled) so the build ships without it.

## 5. Avatars

The slot exists (`emblem: { avatar, hue }`, `Target.avatar`), currently `null` for everything but HTB's passthrough. Populate it **at runtime, per-user, never from committed files**:

- **HTB:** the machine-profile endpoint (reached with the user's existing HTB API token, already supported for write-up fetching) returns an `avatar` path resolved to its CDN URL, fetched and cached locally.
- **THM:** the room page's `og:image` (fetched via the existing `net`/writeup fetch path), cached locally.
- **Immersive:** no public API — the user may drop an avatar path alongside the fixture, else it stays on `hue`.
- **Fallback everywhere:** the generated `hue` emblem (already built) renders when no avatar is available, so the tool ships with no third-party imagery and works fully offline. A single `resolveAvatar(target, creds)` seam centralizes the per-platform logic; failures fall back silently to `hue`.

## 6. Testing

- Registry: `demoById`, `demoReport(id)` memoization, `?demo=<id>` resolution (+ legacy `?demo=live`).
- Each transcribed fixture: `assembleReport(raw)` produces a valid report; a redaction test asserts no flag/IP token remains in the committed fixture.
- Immersive loader: a small fixture NDJSON parses into a graded report; absent file → slot disabled, no crash.
- `resolveAvatar`: HTB token path returns a URL; missing token / fetch failure → `hue` fallback (mocked network).
- Green gate passes.

## 7. Deferred / dependencies

- **User dependency:** the Immersive NDJSON capture. The build ships the other two; the Immersive card activates when the file lands.
- **Deferred:** live per-run avatar fetching for real (non-demo) sessions can reuse `resolveAvatar` later; out of scope here.
