# Wiring the live HTB pickup

The extension detects HTB machine spawns against the **real v4 API** (`/api/v4/vm/spawn`,
`/api/v4/machine/play/{id}`, `/api/v4/vm/terminate`) and the identity endpoints
(`/api/v4/machine/active` / `…/profile`). Two steps need you (a browser action and confirming the
extension ID); everything else is done.

## 1. Build the daemon (once)

```powershell
$env:Path = "C:\Strawberry\perl\bin;C:\Strawberry\c\bin;$env:USERPROFILE\.cargo\bin;$env:LOCALAPPDATA\bin\NASM;$env:Path"
cargo build --manifest-path daemon/Cargo.toml
```

## 2. Load the extension (you)

`chrome://extensions` (or `edge://extensions`) → enable **Developer mode** → **Load unpacked** →
select the `extension/` folder. Copy the **extension ID** it shows.

## 3. Register the native-messaging host

```powershell
pwsh scripts/install-native-host.ps1 -ExtensionId <the-id-from-step-2>   # add -Browser Edge for Edge
```

This writes the launcher + host manifest (your extension as the only allowed origin) and the
registry key. Then reload the extension once.

## 4. Spawn a box — what you'll see

1. **Extension badge** flips to `REC` on spawn.
2. **Service-worker console** (`chrome://extensions` → the extension → *Inspect views: service
   worker*) logs:
   ```
   [Watcher] ▶ HTB spawn detected — machine_id=…
   [Watcher] machine identity: Optimum { name, avatar, os, difficulty, ip }
   ```
3. **Daemon log** — the host is launched by Chrome (its stderr is hidden), so it appends each
   message to a file you can tail:
   ```powershell
   Get-Content $env:TEMP\watcher-daemon.log -Wait
   # recv {"source":"browser_ext",…,"kind":"session_start",…}
   #   → Start { uuid: …, label: "Optimum", … }
   ```

## What this does and doesn't do (honest scope)

- **Does:** detect the spawn + full machine identity, open a session in the daemon, persist to the
  encrypted store.
- **Doesn't yet:** (a) auto-surface the new session in the report window — that's the daemon→UI live
  bridge, the next layer; for now regenerate with `npm run ingest`. (b) **Capture the commands** of a
  pixel-streamed Pwnbox — the browser can't see canvas pixels (brief §3.2). Command capture comes
  from where you actually work the box: SSH from a watched host terminal (host PTY shim, free),
  an in-browser **text** terminal (the WebSocket tap), or the in-VM agent inside the box.
