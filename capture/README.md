# watcher-capture — cross-platform PTY capture POC

A proof-of-concept for the Phase 2 capture daemon (brief §3.1), built to de-risk one
question: **does Windows need WSL/a VM, or can we capture natively?** Answer: **natively.**

It spawns the user's shell through a pseudo-terminal — **ConPTY on Windows, openpty on
Unix, one `portable-pty` API** — tees the output through a `vte` parser to clean text,
segments it per command, and emits the unified telemetry envelope (§3.3) as
newline-delimited JSON: the exact format the Phase 3 pipeline consumes and the §5.4 plugin
socket speaks.

This is the "look like tmux, not like a debugger" model: **userspace PTY only** — no eBPF,
ptrace, LD_PRELOAD, or keyloggers (the things that trip EDR).

## Run

```bash
cargo run --manifest-path capture/Cargo.toml             # runs the platform demo session
cargo run --manifest-path capture/Cargo.toml -- whoami "echo hi"   # custom commands
cargo test --manifest-path capture/Cargo.toml            # unit tests (cleaning + masking)
```

Verified on Windows 11 (ConPTY, Rust 1.96 MSVC). Sample output (one `command` + one
`output` envelope per step):

```json
{"source":"local_pty","session_uuid":"…","seq":1,"ts_utc_us":1781783082024729,"kind":"command","payload":{"cmd":"whoami"},"provenance":{"boundary_confidence":0.8,"redaction_method":"none","context_path":"host","platform":"conpty"}}
{"source":"local_pty","session_uuid":"…","seq":1,"ts_utc_us":1781783082147198,"kind":"output","payload":{"stream":"stdout","text":"desktop-d9n33i8\\tiago peter","line_count":1},"provenance":{"boundary_confidence":0.8,"redaction_method":"none","context_path":"host","platform":"conpty"}}
```

## The platform-abstraction seam

`portable-pty` hides the PTY mechanism. `ShellProfile` (`src/shell.rs`) captures what
genuinely differs per OS — there's a `WindowsShell` and a `UnixShell`:

| Concern | Unix | Windows |
|---|---|---|
| PTY allocation | `openpty` | ConPTY — both via `portable-pty` |
| Shell launched | `$SHELL` / bash | `powershell.exe` |
| Shell integration | bash `PROMPT_COMMAND`/`PS1` OSC 133 | PowerShell `prompt` OSC 133 |
| Password masking | termios ECHO bit (deterministic) + heuristic | heuristic + OSC 133 (ConPTY hides ECHO) |
| Command boundaries | OSC 133 (or preexec/precmd) | OSC 133 (Final Term markers) |

## Fidelity (implemented)

- **OSC 133 shell integration** (`src/terminal.rs`): the capture injects a prompt that emits
  Final Term markers (A/B/D;`<exit>`), so command boundaries are exact and **exit codes** are
  captured — `boundary_confidence` is **1.0**, not inferred. (VS Code injects the same markers.)
- **Line-committing model** for scrolling command output — handles ConPTY's cursor repaints
  (CR rewrites, erase-line) so multi-line output is reconstructed cleanly instead of garbled.
- **Cursor-addressable grid for full-screen TUIs** — on entering the alternate screen
  (`?1049h`, vim/htop/less), capture switches to a grid that honors absolute cursor addressing
  (CUP/CUU/…/EL/ED) and snapshots the screen on exit, without polluting the primary line log.
- **Capture → report**: `src/lib/pipeline/ingest.ts` clock-joins the envelopes into `RawCommand`s
  and runs the Phase 3 pipeline; `npm run export:capture` renders a captured session to HTML and
  it's selectable in `npm run dev` — capture → report, end to end.

### Modes

```bash
cargo run --manifest-path capture/Cargo.toml -- whoami "echo hi"   # scripted (testable headless)
cargo run --manifest-path capture/Cargo.toml -- --interactive      # live: raw-mode passthrough
```

Interactive mode tees real stdin↔PTY in raw mode, forwards terminal resizes to the PTY (the
cross-platform stand-in for SIGWINCH), and reconstructs the commands from the OSC 133 markers on
exit (`extract_sessions`). It needs a real TTY, so it's driven by hand, not in CI.

## In-VM daemon (§5.2) — capturing inside a pixel-streamed box

HTB Pwnbox / THM AttackBox in the browser are **pixel-streamed** (noVNC/Guacamole): no terminal text
in the DOM, so the browser extension is blind. The fallback is to run this same agent **inside** the
box and forward its telemetry to a host daemon:

```bash
# same binary, built for Linux, run inside the Pwnbox shell:
watcher-capture --forward <host:port> --source in_vm_daemon --context cloud:htb:pwnbox -- <commands>
```

`--forward` opens a TCP connection to a daemon's `--listen` socket (the cross-platform stand-in for
**virtio-vsock**; a local hypervisor VM would use vsock with no network config), presents a capability
handshake, and streams the §3.3 envelopes — tagged `source: in_vm_daemon` with the guest
`context_path`. Note the zero-install alternative: **SSH into the target from a watched host terminal**
and the host PTY shim captures it for free — the in-VM agent is only for when you can *only* work
inside the box.

## Remaining daemon work (out of POC scope)

- **Persistence**: handled by the sibling `store/` crate (SQLCipher) — the daemon wires capture → store.
- **Per-source clock-skew** normalization (browser/guest-VM agents) and the Unix **termios-ECHO**
  password trick (the heuristic masker is the cross-platform fallback).
