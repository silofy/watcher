# Capturing an HTB engagement

The Watcher records the **commands** you run against a box. Machine *identity* (name, OS,
difficulty) comes from the `--machine` flag you pass when you start capturing. This document covers
the two ways to capture the commands, matching the two ways people play HTB content.

In both cases the rendezvous is the same: a session report JSON in `~/.watcher/sessions/`, which the
desktop app polls and renders. The capture agent opens it and fills in the episodes.

---

## Path A — Play over the VPN, from your own terminal (macOS / Linux / Windows / WSL)

Best when you attack from a local Kali/WSL/PowerShell over HTB's OpenVPN. Fully live.

1. Download the **OpenVPN** config ("Connect with OpenVPN") and connect: `sudo openvpn lab.ovpn`.
2. Start a watched shell, naming the box:

   ```
   npm run capture -- --machine Forge
   ```

   Run from the repo root (works the same on macOS, Linux, and Windows). It builds the agent the
   first time, then attaches. To run the compiled binary directly instead:
   `./crates/capture/target/release/watcher-capture --attach --machine Forge`
   (Windows: `.\crates\capture\target\release\watcher-capture.exe`).
3. Hack as normal — `nmap`, `evil-winrm`, etc. Each completed command appears in the debrief within
   ~1–4 s. Type `exit` to stop.

`--attach` first looks for a still-recording session in `~/.watcher/sessions/`. If one for the **same
box** is already live, it asks whether to join it as a second terminal or start a fresh engagement
(`--new` forces a new one, no prompt); if there is none, it **self-starts a session** named by
`--machine`. Either way it must run on the **same machine** as the desktop app (it reads that local
folder), and it closes the session it started on `exit`.

Pass `--shell bash` (or `pwsh`, `zsh`, …) to watch a specific shell rather than your login shell —
handy for git-bash / WSL on Windows. The shell's *family* picks the boundary markers, so `--shell bash`
on Windows still gets bash's shell-integration, not PowerShell's.

Note: if you `ssh`/`openvpn` into the box and then run a *nested* shell, OSC-133 boundaries bracket
the **outer** shell — the nested session is one block. Run commands in the watched shell directly,
or use Path B inside the box for per-command boundaries.

---

## Path B — Play in Pwnbox (in-browser Parrot OS)

Pwnbox is delivered as a **VNC remote desktop** (`vnc.htb-cloud.com`), so there's no local terminal
to watch. Instead, run the agent **inside** Pwnbox and import the result.

1. Install the agent inside Pwnbox. Pwnbox has internet, so it's one line: it downloads the static
   Linux binary from the latest release, verifies its checksum, and installs `watcher-capture`:

   ```
   curl -fsSL https://raw.githubusercontent.com/silofy/watcher/main/install.sh | sh
   ```

   Prefer to build it yourself? `crates/capture/build-in-pwnbox.sh` installs Rust and compiles from
   source inside Pwnbox, and `crates/capture/build-linux.ps1` cross-compiles the Linux binary from
   Windows via cargo-zigbuild.
2. Capture into the export dir the Watcher pulls from, tagging the machine you're on:

   ```
   watcher-capture --export ~/.watcher-exports/checkpoint.json --machine Checkpoint --os Windows --difficulty Medium
   ```

   Hack as normal; type `exit` to finish.
3. **Auto-pull (no manual copy).** Open **Pwnbox sync** in the Watcher's top bar, enter your
   Pwnbox SSH host / user / key (the same details HTB gives you for "Connect via SSH") and enable it.
   The Watcher `scp`-pulls `~/.watcher-exports/*.json` into `~/.watcher/sessions/` every 15s and they
   appear in History automatically. Direct PC↔Pwnbox over your SSH key — nothing through a third party.

   (Manual fallback: download the JSON yourself and drop it into `~/.watcher/sessions/`.)

---

## Flags

| flag | meaning |
|------|---------|
| `--attach` | stream into a live local session; self-starts one if none is recording (same machine) |
| `--new` | with `--attach`, skip the join-or-new prompt and force a fresh engagement |
| `--export <file>` | standalone capture → write a complete report to `<file>` (for Pwnbox) |
| `--machine <name>` | name the box (HTB alias) — identity for `--export` and for a self-started `--attach` (also `--os`, `--difficulty`) |
| `--platform <id>` | which training platform this run belongs to — `htb`, `thm`, `offsec`, `immersive`, or `local` (default: `local`); stamped onto the report's provenance so the UI resolves the right adapter |
| `--target <name>` | name the target neutrally — the platform-agnostic alias for `--machine`; if both are given, `--target` wins |
| `--shell <name>` | shell to watch, by family — `bash`/`zsh`/`sh` or `pwsh`/`powershell` (default: your login shell) |
| `-i` / `--interactive` | raw capture to NDJSON on stdout (no session file) |
| `--forward <addr>` | ship envelopes to a daemon `--listen` socket instead of a file |

This document walks the HTB paths specifically since that's the platform with the most capture
tooling (Pwnbox sync, HTB API write-up fetch), but the agent itself is platform-agnostic — the same
`--attach`/`--export` flow works unchanged against TryHackMe, OffSec, Immersive Labs, or a local/CTF
box; just pass `--platform <id> --target <name>` instead of `--machine <name>`.
