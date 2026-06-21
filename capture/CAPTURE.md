# Capturing an HTB engagement

The Watcher records the **commands** you run against a box. Machine *identity* (name, OS,
difficulty, avatar) is supplied automatically by the browser extension the moment you spawn the box
on HTB — see `extension/INSTALL.md`. This document covers the two ways to capture the commands,
matching the two ways people play HTB content.

In both cases the rendezvous is the same: a session report JSON in `~/.watcher/sessions/`, which the
desktop app polls and renders. The extension opens it; a capture agent fills in the episodes.

---

## Path A — Play over the VPN, from your own terminal (macOS / Linux / Windows / WSL)

Best when you attack from a local Kali/WSL/PowerShell over HTB's OpenVPN. Fully live. **No browser
extension required.**

1. Download the **OpenVPN** config ("Connect with OpenVPN") and connect: `sudo openvpn lab.ovpn`.
2. Start a watched shell, naming the box:

   ```
   watcher-capture --attach --machine Forge
   ```

   On Windows: `& "…\capture\target\debug\watcher-capture.exe" --attach --machine Forge` (one line).
3. Hack as normal — `nmap`, `evil-winrm`, etc. Each completed command appears in the debrief within
   ~1–4 s. Type `exit` to stop.

`--attach` first looks for the newest still-recording session in `~/.watcher/sessions/` (the one the
browser extension opens, which carries the box's identity). If there is none, it **self-starts a
session** named by `--machine`, so live capture works with no extension at all. Either way it must run
on the **same machine** as the desktop app (it reads that local folder), and it closes the session it
started on `exit`.

Note: if you `ssh`/`openvpn` into the box and then run a *nested* shell, OSC-133 boundaries bracket
the **outer** shell — the nested session is one block. Run commands in the watched shell directly,
or use Path B inside the box for per-command boundaries.

---

## Path B — Play in Pwnbox (in-browser Parrot OS)

Pwnbox is delivered as a **VNC remote desktop** (`vnc.htb-cloud.com`), so the browser sees pixels,
not text — it cannot be tapped from the extension. Instead, run the agent **inside** Pwnbox and
import the result.

1. Get the agent into Pwnbox. A **prebuilt Linux x86_64 binary** is committed at
   `capture/dist/watcher-capture-linux-x86_64` — just transfer that file (HTB file transfer / scp),
   no building required:

   ```
   chmod +x watcher-capture-linux-x86_64
   ```

   To rebuild it from Windows (no WSL/Docker), run `capture/build-linux.ps1` — it cross-compiles via
   cargo-zigbuild. To build *inside* Pwnbox instead, `capture/build-in-pwnbox.sh` installs Rust and
   compiles from source.
2. Capture into the export dir the Watcher pulls from, tagging the machine you're on:

   ```
   ./watcher-capture --export ~/.watcher-exports/checkpoint.json --machine Checkpoint --os Windows --difficulty Medium
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
| `--attach` | stream into a live local session; self-starts one if the extension hasn't opened one (same machine) |
| `--export <file>` | standalone capture → write a complete report to `<file>` (for Pwnbox) |
| `--machine <name>` | name the box — identity for `--export` and for a self-started `--attach` (also `--os`, `--difficulty`) |
| `-i` / `--interactive` | raw capture to NDJSON on stdout (no session file) |
| `--forward <addr>` | ship envelopes to a daemon `--listen` socket instead of a file |
