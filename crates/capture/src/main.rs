//! The Watcher — cross-platform PTY capture proof-of-concept.
//!
//! Spawns the user's shell through a pseudo-terminal (ConPTY on Windows, openpty on
//! Unix — one `portable-pty` API), parses output through a terminal model (line capture +
//! a grid for full-screen TUIs), uses OSC 133 shell-integration markers for exact command
//! boundaries and exit codes, and emits the unified telemetry envelope (§3.3) as NDJSON.
//!
//! Two modes:
//!   * scripted (default)        — drives a command list, testable headlessly
//!   * `--interactive` / `-i`    — raw-mode passthrough of the real terminal (live capture)
//!
//! "Look like tmux, not like a debugger": userspace PTY only, no eBPF / ptrace / LD_PRELOAD.

mod envelope;
mod shell;
mod terminal;

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use portable_pty::{native_pty_system, PtySize};
use uuid::Uuid;

use envelope::TelemetryEvent;
use watcher_core::{EndReason, SessionConfig, SessionController, SessionEvent};
use shell::{platform_profile, ShellProfile};
use terminal::{clean_lines, extract_sessions, Captured, Sink, Terminal};

fn lifecycle_envelope(ev: &SessionEvent, platform: &str) -> TelemetryEvent {
    match ev {
        SessionEvent::Start { uuid, label, at_us } => {
            TelemetryEvent::session("session_start", uuid, *at_us, label, platform)
        }
        SessionEvent::Flag { uuid, at_us } => {
            TelemetryEvent::session("session_flag", uuid, *at_us, "objective-complete nudge", platform)
        }
        SessionEvent::End { uuid, at_us, reason } => {
            TelemetryEvent::session("session_end", uuid, *at_us, reason.as_str(), platform)
        }
    }
}

/// Bracket a captured event stream with session lifecycle markers and inject flag nudges.
/// The session controller's full power (idle close, auto-start, multi-session) is unit-tested;
/// here it brackets one run and detects the "you rooted it" flag in any output.
fn add_session_lifecycle(events: Vec<TelemetryEvent>, session: &str, label: &str, platform: &str) -> Vec<TelemetryEvent> {
    let sid = session.to_string();
    let mut ctrl = SessionController::new(
        SessionConfig { auto_start: false, ..Default::default() },
        Box::new(move || sid.clone()),
    );
    let t0 = events.first().map(|e| e.ts_utc_us).unwrap_or_else(now_us);
    let mut out: Vec<TelemetryEvent> = Vec::new();
    for ev in ctrl.start(label, t0) {
        out.push(lifecycle_envelope(&ev, platform));
    }
    let mut last_ts = t0;
    for e in events {
        last_ts = e.ts_utc_us;
        let is_output = e.kind == "output" || e.kind == "stdin_masked";
        let text = e.payload.text.clone().unwrap_or_default();
        out.push(e);
        if is_output {
            for se in ctrl.observe(false, &text, label, last_ts) {
                out.push(lifecycle_envelope(&se, platform));
            }
        }
    }
    if let Some(end) = ctrl.stop(last_ts, EndReason::Manual) {
        for se in end {
            out.push(lifecycle_envelope(&se, platform));
        }
    }
    out
}

fn now_us() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_micros() as u64
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

/// Re-tag every envelope with the agent's source and guest context (e.g. in_vm_daemon /
/// cloud:htb:pwnbox) — the in-VM daemon runs the same capture but reports from inside the box.
fn retag(events: &mut [TelemetryEvent], source: &str, context: &str) {
    for e in events {
        e.source = source.to_string();
        e.provenance.context_path = context.to_string();
    }
}

/// The capability handshake this agent presents to the daemon socket (brief §5.4 / §5.2):
/// exact boundaries (OSC 133), client-side regex redaction, and the guest context template.
fn handshake_json(source: &str, context: &str) -> String {
    format!(
        r#"{{"watcher_handshake":"1.0","plugin":"{source}","class":"source","capabilities":{{"has_exit_codes":true,"has_stdin":true,"boundary_confidence":"exact","redaction":"regex"}},"context_template":"{context}"}}"#
    )
}

/// Ship the captured envelopes to a daemon's --listen socket (the cross-platform stand-in for
/// virtio-vsock). The same binary, run inside an HTB Pwnbox/VM, forwards to a reachable host daemon.
fn forward_events(addr: &str, source: &str, context: &str, events: &[TelemetryEvent]) -> Result<(), Box<dyn std::error::Error>> {
    let mut stream = TcpStream::connect(addr)?;
    writeln!(stream, "{}", handshake_json(source, context))?;
    for e in events {
        writeln!(stream, "{}", serde_json::to_string(e)?)?;
    }
    stream.flush()?;
    eprintln!("[watcher-capture] forwarded {} envelopes to {addr} (source={source}, context={context})", events.len());
    Ok(())
}

fn wait_until<F: Fn(&Terminal) -> bool>(term: &Arc<Mutex<Terminal>>, pred: F, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if pred(&term.lock().unwrap()) {
            return true;
        }
        if start.elapsed() > timeout {
            return false;
        }
        thread::sleep(Duration::from_millis(15));
    }
}

/// Scripted capture: drive a fixed command list, bracketing each by its OSC 133 markers.
fn run_scripted(
    profile: &dyn ShellProfile,
    commands: &[String],
    session: &str,
    platform: &str,
) -> Result<Vec<TelemetryEvent>, Box<dyn std::error::Error>> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize { rows: 50, cols: 200, pixel_width: 0, pixel_height: 0 })?;
    let mut child = pair.slave.spawn_command(profile.shell_command())?;
    drop(pair.slave);

    let term = Arc::new(Mutex::new(Terminal::new()));
    let mut reader = pair.master.try_clone_reader()?;
    let reader_term = term.clone();
    let _reader = thread::spawn(move || {
        let mut parser = vte::Parser::new();
        let mut chunk = [0u8; 8192];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    let mut t = reader_term.lock().unwrap();
                    let mut sink = Sink { t: &mut t };
                    for &b in &chunk[..n] {
                        parser.advance(&mut sink, b);
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut writer = pair.master.take_writer()?;
    thread::sleep(Duration::from_millis(900));
    write!(writer, "{}\r", profile.integration_command())?;
    writer.flush()?;
    if !wait_until(&term, |t| t.has_b(), Duration::from_secs(5)) {
        eprintln!("[watcher-capture] warning: OSC 133 markers not detected; boundaries degraded");
    }

    let mut events: Vec<TelemetryEvent> = Vec::new();
    for (i, cmd) in commands.iter().enumerate() {
        let seq = (i + 1) as u64;
        let start_line = term.lock().unwrap().last_b_line().unwrap_or(0);
        let d_before = term.lock().unwrap().d_count();
        let ts = now_us();

        write!(writer, "{cmd}\r")?;
        writer.flush()?;

        let got = wait_until(&term, |t| t.d_count() > d_before, Duration::from_secs(8));
        let (out_lines, exit) = {
            let t = term.lock().unwrap();
            let d_line = t.last_d().map(|b| b.line).unwrap_or(t.lines.len()).min(t.lines.len());
            (t.lines[start_line.min(d_line)..d_line].to_vec(), t.last_d().and_then(|b| b.exit))
        };
        let confidence = if got { 1.0 } else { 0.6 };
        let cleaned = clean_lines(&out_lines, cmd);
        let masked = profile.looks_like_password_prompt(&cleaned);

        events.push(TelemetryEvent::command(session, seq, ts, cmd, exit, confidence, platform));
        events.push(TelemetryEvent::output(session, seq, now_us(), &cleaned, masked, confidence, platform));
    }

    // Redaction runs before anything hits disk (the same invariant the attach path enforces): mask
    // IPs, flag hashes, and credential tokens so this debug transcript can't leak a live IP or a root
    // flag into a world-readable temp file.
    let dump = std::env::temp_dir().join("watcher-capture-transcript.txt");
    let transcript = watcher_core::redact(&term.lock().unwrap().lines.join("\n"));
    let _ = std::fs::write(&dump, transcript);
    eprintln!("[watcher-capture] transcript -> {}", dump.display());

    let _ = write!(writer, "exit\r");
    let _ = writer.flush();
    drop(writer);
    let _ = child.kill();
    let _ = child.wait();
    Ok(events)
}

/// Interactive capture: raw-mode passthrough of the real terminal. The shell behaves
/// normally for the user; we tee its I/O, capture via OSC 133, and on exit reconstruct
/// the commands. Requires a real TTY (fails cleanly when stdin is redirected).
fn run_interactive(
    profile: &dyn ShellProfile,
    session: &str,
    platform: &str,
) -> Result<Vec<TelemetryEvent>, Box<dyn std::error::Error>> {
    use crossterm::terminal::{disable_raw_mode, enable_raw_mode, size};

    let (cols, rows) = size().unwrap_or((120, 30));
    enable_raw_mode()?; // errors out if there is no console (e.g. redirected stdin)

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
    let mut child = pair.slave.spawn_command(profile.shell_command())?;
    drop(pair.slave);

    let term = Arc::new(Mutex::new(Terminal::new()));
    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;
    let master = Arc::new(Mutex::new(pair.master));
    let running = Arc::new(AtomicBool::new(true));

    // PTY output -> real stdout (so the user sees their shell) + terminal model (capture).
    let reader_term = term.clone();
    let reader_handle = thread::spawn(move || {
        let mut parser = vte::Parser::new();
        let mut chunk = [0u8; 8192];
        let mut out = std::io::stdout();
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = out.write_all(&chunk[..n]);
                    let _ = out.flush();
                    let mut t = reader_term.lock().unwrap();
                    let mut sink = Sink { t: &mut t };
                    for &b in &chunk[..n] {
                        parser.advance(&mut sink, b);
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Install OSC 133 integration, then hand the writer to the stdin pump.
    write!(writer, "{}\r", profile.integration_command())?;
    writer.flush()?;

    // Source the ssh() tap so interactive SSH sessions are captured per-command (POSIX only).
    if let Some(tap) = profile.ssh_tap_command(session) {
        install_ssh_tap();
        write!(writer, "{}\r", tap)?;
        writer.flush()?;
        eprintln!("[watcher-capture] SSH sessions in this shell will be captured per-command.");
    }

    // Real stdin -> PTY (forward the user's keystrokes).
    let stdin_running = running.clone();
    thread::spawn(move || {
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 1024];
        while stdin_running.load(Ordering::Relaxed) {
            match stdin.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if writer.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    let _ = writer.flush();
                }
                Err(_) => break,
            }
        }
    });

    // Forward terminal resizes to the PTY (the cross-platform stand-in for SIGWINCH).
    let resize_master = master.clone();
    let resize_running = running.clone();
    thread::spawn(move || {
        let mut last = (cols, rows);
        while resize_running.load(Ordering::Relaxed) {
            if let Ok(sz) = crossterm::terminal::size() {
                if sz != last {
                    let _ = resize_master.lock().unwrap().resize(PtySize {
                        rows: sz.1,
                        cols: sz.0,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                    last = sz;
                }
            }
            thread::sleep(Duration::from_millis(200));
        }
    });

    let _ = child.wait(); // blocks until the user exits the shell
    running.store(false, Ordering::Relaxed);
    let _ = disable_raw_mode();
    let _ = reader_handle.join();

    // Reconstruct commands from the OSC 133 markers.
    let t = term.lock().unwrap();
    let captured = extract_sessions(&t);
    let mut events = Vec::new();
    for (i, c) in captured.iter().enumerate() {
        let seq = (i + 1) as u64;
        let ts = now_us();
        let masked = profile.looks_like_password_prompt(&c.output);
        events.push(TelemetryEvent::command(session, seq, ts, &c.cmd, c.exit, 1.0, platform));
        events.push(TelemetryEvent::output(session, seq, ts, &c.output, masked, 1.0, platform));
    }
    Ok(events)
}

// ---- Attach mode: stream a local terminal into a live recording session ----
//
// A live session is a ~/.watcher/sessions/<uuid>.json file with the machine identity and
// recording:true. `--attach` finds the newest one (or self-starts it) and streams the commands you
// run in a watched shell straight into it as episodes, so your local hacking shows up in the
// report, correlated to the box, with no second session to reconcile. A second terminal can attach
// to a session this process already opened.

use serde_json::{json, Value};

fn watcher_sessions_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok()?;
    Some(std::path::Path::new(&home).join(".watcher").join("sessions"))
}

/// Write the bundled `ssh()` capture tap to ~/.watcher/watcher-ssh.sh so the watched shell can
/// source it. Best-effort — a failure just means SSH sessions fall back to one opaque block.
fn install_ssh_tap() {
    if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let dir = std::path::Path::new(&home).join(".watcher");
        if std::fs::create_dir_all(&dir).is_ok() {
            let _ = std::fs::write(dir.join("watcher-ssh.sh"), include_str!("../watcher-ssh.sh"));
        }
    }
}

/// The newest still-recording session file (a live engagement already open on this machine).
fn find_active_session() -> Option<(std::path::PathBuf, Value)> {
    let dir = watcher_sessions_dir()?;
    let mut best: Option<(std::path::PathBuf, Value, String)> = None;
    for e in std::fs::read_dir(&dir).ok()?.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let Ok(s) = std::fs::read_to_string(&p) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&s) else { continue };
        if v.get("recording").and_then(|r| r.as_bool()) != Some(true) {
            continue;
        }
        let started = v["session"]["started_at"].as_str().unwrap_or("").to_string();
        if best.as_ref().map(|(_, _, b)| started > *b).unwrap_or(true) {
            best = Some((p, v, started));
        }
    }
    best.map(|(p, v, _)| (p, v))
}

/// The bare command name, sans path and .exe (the report's `binary` field + tactic key).
fn binary_of(cmd: &str) -> String {
    let first = cmd.split_whitespace().next().unwrap_or("");
    let base = first.rsplit(['/', '\\']).next().unwrap_or(first);
    base.trim_end_matches(".exe").to_string()
}

/// A provisional ATT&CK tag by tool — enough to group + color the live view. The full pipeline
/// (segment/mitre/align) re-derives this properly when the session is finalized (Milestone 4).
fn tactic_for(bin: &str) -> (&'static str, &'static str) {
    match bin {
        "nmap" | "masscan" | "rustscan" | "autorecon" => ("TA0007", "T1046"),
        "gobuster" | "feroxbuster" | "ffuf" | "dirb" | "dirbuster" | "nikto" | "whatweb" | "wfuzz" => ("TA0007", "T1595"),
        "ssh" | "nc" | "ncat" | "netcat" | "socat" | "evil-winrm" => ("TA0008", "T1021"),
        "sqlmap" | "msfconsole" | "msfvenom" | "searchsploit" => ("TA0001", "T1190"),
        "hydra" | "john" | "hashcat" | "medusa" | "crackmapexec" | "cme" => ("TA0006", "T1110"),
        "sudo" | "id" | "whoami" | "uname" | "linpeas" | "winpeas" | "pspy" | "getcap" => ("TA0004", "T1068"),
        "curl" | "wget" => ("TA0011", "T1071"),
        _ => ("TA0002", "T1059"),
    }
}

/// Reconstruct the captured commands as report episodes (redacted defense-in-depth before they
/// ever touch disk — the daemon re-redacts too, but this file is written directly).
fn episodes_from_terminal(t: &Terminal) -> Vec<Value> {
    episodes_from_captured(&extract_sessions(t))
}

/// Shape captured commands into report episodes. Split from `episodes_from_terminal` so the
/// JSON contract (timing fields, provenance) is unit-testable without building a whole Terminal.
fn episodes_from_captured(caps: &[Captured]) -> Vec<Value> {
    let mut out = Vec::with_capacity(caps.len());
    let mut prev_end: Option<u64> = None;
    for (i, c) in caps.iter().enumerate() {
        let bin = binary_of(&c.cmd);
        let (tactic, technique) = tactic_for(&bin);
        let digest: String = watcher_core::redact(&c.output).chars().take(280).collect();
        let duration_ms = c.end_us.saturating_sub(c.start_us) / 1000;
        let gap_before_ms = prev_end.map(|p| c.start_us.saturating_sub(p) / 1000).unwrap_or(0);
        prev_end = Some(c.end_us);
        out.push(json!({
            "seq": (i as u64) + 1,
            "cmd": watcher_core::redact(&c.cmd),
            "binary": bin,
            "started_at_ms": c.start_us / 1000,
            "duration_ms": duration_ms,
            "gap_before_ms": gap_before_ms,
            "exit_code": c.exit,
            "actor": "machine_bound",
            "output_digest": digest,
            "tactic": tactic,
            "technique": technique,
            "confidence": 1.0,
            "context_path": "host"
        }));
    }
    out
}

/// Merge episodes into the session file (preserving its machine identity).
fn write_session_episodes(path: &std::path::Path, base: &Value, episodes: Vec<Value>) {
    let mut v = base.clone();
    let breadth = episodes
        .iter()
        .filter_map(|e| e.get("tactic").and_then(|t| t.as_str()))
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    v["episodes"] = Value::Array(episodes);
    v["recording"] = json!(true);
    v["metrics"]["technique_breadth"] = json!(breadth);
    v["session"]["ended_at"] = json!(iso_now()); // heartbeat — lets the UI tell a live capture from a dead one
    let _ = std::fs::write(path, serde_json::to_string_pretty(&v).unwrap_or_default());
}

fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Neutral platform id from --platform (htb|thm|offsec|immersive|local); defaults to "local".
/// Lets a capture declare which CTF/lab platform it belongs to without hardcoding HTB — used to
/// build the report's context_path/target_scope and stamped onto provenance.platform (§3.3).
fn platform_arg(args: &[String]) -> String {
    arg_value(args, "--platform").unwrap_or_else(|| "local".to_string())
}

/// Build the machine-identity block for a standalone export from CLI args (Pwnbox has no live
/// session to inherit it from). Null when --machine is omitted.
fn machine_arg(args: &[String]) -> Value {
    match arg_value(args, "--machine") {
        Some(name) => json!({
            "name": name,
            "os": arg_value(args, "--os"),
            "difficulty": arg_value(args, "--difficulty"),
            "avatar": Value::Null,
        }),
        None => Value::Null,
    }
}

/// A complete, schema-shaped report for an agent-owned capture (the in-Pwnbox `--export` agent, or a
/// self-started local `--attach`). Same shape the daemon writes for a live session, so the file can
/// be dropped straight into ~/.watcher/sessions/. `source` is the §3.3
/// provenance ("in_vm_daemon" for Pwnbox, "local_pty" for a local watched shell).
fn build_base_report(uuid: &str, machine: Value, target: &str, context: &str, source: &str) -> Value {
    let t = iso_now();
    let intro = if source == "in_vm_daemon" {
        "Captured inside Pwnbox. Download this file and drop it into ~/.watcher/sessions/ on your PC."
    } else {
        "Live local capture — commands stream into this report as you run them."
    };
    json!({
        "schema_version": "1.0",
        "session": { "uuid": uuid, "started_at": t, "ended_at": t, "target_scope": target,
                     "context_path": context, "shell": "", "source": source, "machine": machine },
        "episodes": [], "phases": [], "golden_dag": [],
        "metrics": { "efficiency_pct": 0, "objective_coverage_pct": 0, "stealth_score": 100, "technique_breadth": 0,
                     "time_waster": { "productive_ms": 0, "detour_ms": 0, "stuck_ms": 0, "loop_ms": 0, "t_active_ms": 0 } },
        "coaching": { "skill_radar": { "recon": 0, "web": 0, "exploit": 0, "privesc": 0, "opsec": 0 },
                      "next_steps": [{ "action": intro, "why": "", "category": "Recap", "evidence_seq": null }] },
        "redaction_profile": "full",
        "recording": true
    })
}

/// Flip a session report to archived (recording:false, ended now). Called when this agent OWNS the
/// session lifecycle — a standalone `--export`, or a self-started `--attach`. A session this process
/// did not open (one it merely attached to) is left alone; its opener owns the lifecycle.
fn mark_finished(path: &std::path::Path) {
    if let Ok(s) = std::fs::read_to_string(path) {
        if let Ok(mut v) = serde_json::from_str::<Value>(&s) {
            v["recording"] = json!(false);
            v["session"]["ended_at"] = json!(iso_now());
            let _ = std::fs::write(path, serde_json::to_string_pretty(&v).unwrap_or_default());
        }
    }
}

/// Interactive capture wired to an existing HTB session: same watched shell as `-i`, but every
/// completed command is streamed into `path` as an episode (polled ~every 0.8s → near-live).
fn run_attached(profile: &dyn ShellProfile, path: &std::path::Path, base: &Value) -> Result<(), Box<dyn std::error::Error>> {
    use crossterm::terminal::{disable_raw_mode, enable_raw_mode, size};

    let (cols, rows) = size().unwrap_or((120, 30));
    enable_raw_mode()?;

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })?;
    let mut child = pair.slave.spawn_command(profile.shell_command())?;
    drop(pair.slave);

    let term = Arc::new(Mutex::new(Terminal::new()));
    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;
    let master = Arc::new(Mutex::new(pair.master));
    let running = Arc::new(AtomicBool::new(true));

    // PTY output -> real stdout (user sees their shell) + terminal model (capture).
    let reader_term = term.clone();
    let reader_handle = thread::spawn(move || {
        let mut parser = vte::Parser::new();
        let mut chunk = [0u8; 8192];
        let mut out = std::io::stdout();
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = out.write_all(&chunk[..n]);
                    let _ = out.flush();
                    let mut t = reader_term.lock().unwrap();
                    let mut sink = Sink { t: &mut t };
                    for &b in &chunk[..n] {
                        parser.advance(&mut sink, b);
                    }
                }
                Err(_) => break,
            }
        }
    });

    write!(writer, "{}\r", profile.integration_command())?;
    writer.flush()?;

    // Source the ssh() capture tap so interactive SSH sessions are recorded per-command (POSIX only).
    let session_uuid = base["session"]["uuid"].as_str().unwrap_or("").to_string();
    if let Some(tap) = profile.ssh_tap_command(&session_uuid) {
        install_ssh_tap();
        write!(writer, "{}\r", tap)?;
        writer.flush()?;
        eprintln!("[watcher-capture] SSH sessions in this shell will be captured per-command.");
    }

    // Stream episodes into the session file as commands complete.
    let writer_term = term.clone();
    let writer_path = path.to_path_buf();
    let writer_base = base.clone();
    let writer_running = running.clone();
    let ep_handle = thread::spawn(move || {
        let mut last = usize::MAX;
        let mut last_write = Instant::now();
        loop {
            thread::sleep(Duration::from_millis(800));
            let eps = episodes_from_terminal(&writer_term.lock().unwrap());
            // write on new commands, or as a ~10s heartbeat so `ended_at` keeps proving liveness even
            // while you're thinking between commands (the UI's staleness guard reads that timestamp).
            if eps.len() != last || last_write.elapsed() >= Duration::from_secs(10) {
                last = eps.len();
                last_write = Instant::now();
                write_session_episodes(&writer_path, &writer_base, eps);
            }
            if !writer_running.load(Ordering::Relaxed) {
                break;
            }
        }
    });

    // Real stdin -> PTY.
    let stdin_running = running.clone();
    thread::spawn(move || {
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 1024];
        while stdin_running.load(Ordering::Relaxed) {
            match stdin.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if writer.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    let _ = writer.flush();
                }
                Err(_) => break,
            }
        }
    });

    // Forward resizes (cross-platform SIGWINCH).
    let resize_master = master.clone();
    let resize_running = running.clone();
    thread::spawn(move || {
        let mut last = (cols, rows);
        while resize_running.load(Ordering::Relaxed) {
            if let Ok(sz) = crossterm::terminal::size() {
                if sz != last {
                    let _ = resize_master.lock().unwrap().resize(PtySize { rows: sz.1, cols: sz.0, pixel_width: 0, pixel_height: 0 });
                    last = sz;
                }
            }
            thread::sleep(Duration::from_millis(200));
        }
    });

    let _ = child.wait();
    running.store(false, Ordering::Relaxed);
    let _ = disable_raw_mode();
    let _ = reader_handle.join();
    let _ = ep_handle.join();

    // Final flush (captures the last command after the poll loop ended).
    let eps = episodes_from_terminal(&term.lock().unwrap());
    let n = eps.len();
    write_session_episodes(path, base, eps);
    eprintln!("[watcher-capture] detached — {n} command(s) written to the session report.");
    Ok(())
}

/// A session's display label — the machine name, else the target scope.
fn session_label(base: &Value) -> String {
    base["session"]["machine"]["name"]
        .as_str()
        .or_else(|| base["session"]["target_scope"].as_str())
        .unwrap_or("session")
        .to_string()
}

#[derive(Debug, PartialEq)]
enum AttachChoice {
    /// Join the already-recording session as another lane.
    UseExisting,
    /// Open a fresh engagement instead.
    StartNew,
}

/// Decide what `--attach` should do when a session is already recording. Pure so the policy is
/// unit-testable; the interactive prompt only runs in the one case that actually needs a human.
/// Prompt fires only when the live session is the *same* box (re-attempt vs. new terminal is
/// genuinely ambiguous); a different box, `--new`, or no live session never asks.
fn resolve_attach(
    active_machine: Option<&str>,
    requested_machine: Option<&str>,
    force_new: bool,
    prompt: impl FnOnce() -> bool,
) -> AttachChoice {
    let Some(active) = active_machine else {
        return AttachChoice::StartNew; // nothing live to join
    };
    if force_new {
        return AttachChoice::StartNew;
    }
    // A different box already recording -> don't fold this work into its report; start fresh.
    let same_box = match requested_machine {
        Some(r) => active.eq_ignore_ascii_case(r),
        None => true, // no target named: assume the live session is the one meant
    };
    if !same_box {
        return AttachChoice::StartNew;
    }
    if prompt() {
        AttachChoice::StartNew
    } else {
        AttachChoice::UseExisting
    }
}

/// Ask, on a TTY, whether to start a fresh engagement instead of joining the live one. Piped/
/// non-interactive stdin keeps the historical behavior (attach to the existing session).
fn prompt_start_new(machine: &str) -> bool {
    use std::io::{IsTerminal, Write};
    if !std::io::stdin().is_terminal() {
        return false;
    }
    eprint!(
        "[watcher-capture] a live session for '{machine}' is already recording.\n  \
         Attach this terminal to it as a new lane, or start a new engagement? [A/n]: "
    );
    let _ = std::io::stderr().flush();
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line).is_err() {
        return false;
    }
    matches!(line.trim().to_ascii_lowercase().as_str(), "n" | "no" | "new")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();

    // `--shell <path>` picks the shell (and its marker scheme) by family; default = host shell.
    let profile = match arg_value(&args, "--shell") {
        Some(s) => shell::profile_for_shell(&s),
        None => platform_profile(),
    };
    let session = Uuid::new_v4().to_string();
    let surface = profile.platform_tag(); // conpty | unix-pty — PTY backend, used only for the startup log line
    let platform = platform_arg(&args); // htb | thm | offsec | immersive | local — neutral CTF/lab platform id

    // Standalone capture (the in-Pwnbox agent): record with our own identity, write a complete
    // report to a file the user downloads and imports.
    if let Some(out) = arg_value(&args, "--export") {
        // --target names the box neutrally; --machine (HTB) still works as its alias.
        let target = arg_value(&args, "--target")
            .or_else(|| arg_value(&args, "--machine"))
            .unwrap_or_else(|| "Pwnbox session".to_string());
        let context = arg_value(&args, "--context").unwrap_or_else(|| match arg_value(&args, "--platform") {
            Some(p) => format!("cloud:{p}:openvpn"),
            None => "cloud:htb:pwnbox".to_string(), // unchanged HTB default when --platform is omitted
        });
        let base = build_base_report(&session, machine_arg(&args), &target, &context, "in_vm_daemon");
        let path = std::path::PathBuf::from(&out);
        write_session_episodes(&path, &base, vec![]); // create it immediately so it's visible live
        eprintln!("[watcher-capture] exporting to {out} — hack as normal, type 'exit' to finish.");
        run_attached(profile.as_ref(), &path, &base)?;
        mark_finished(&path); // imports as an archived run, not a live recording
        eprintln!("[watcher-capture] done -> {out}. Download it and drop it into ~/.watcher/sessions/ on your PC.");
        return Ok(());
    }

    // Attach and stream local commands into a recording session. Prefer a live session already open
    // on this machine; if there is none, self-start one (cross-platform). `--machine <name>` names
    // the self-started session.
    if args.iter().any(|a| a == "--attach") {
        let force_new = args.iter().any(|a| a == "--new");
        let requested_machine = arg_value(&args, "--machine");
        let active = find_active_session();
        let active_label = active.as_ref().map(|(_, b)| session_label(b));

        // Same box already recording? Ask whether this is a second terminal or a fresh attempt.
        let choice = resolve_attach(
            active_label.as_deref(),
            requested_machine.as_deref(),
            force_new,
            || prompt_start_new(active_label.as_deref().unwrap_or("session")),
        );

        let (path, base, self_started) = match (choice, active) {
            (AttachChoice::UseExisting, Some((p, b))) => {
                eprintln!("[watcher-capture] joining the live session '{}' as a new lane.", session_label(&b));
                (p, b, false)
            }
            (_, prior) => {
                if prior.is_some() {
                    eprintln!("[watcher-capture] a session was already live — starting a new engagement.");
                }
                let target = arg_value(&args, "--target")
                    .or_else(|| requested_machine.clone())
                    .unwrap_or_else(|| "local session".to_string());
                let context = arg_value(&args, "--context").unwrap_or_else(|| match arg_value(&args, "--platform") {
                    Some(p) => format!("cloud:{p}:openvpn"),
                    None => "host".to_string(), // unchanged local default when --platform is omitted
                });
                let base = build_base_report(&session, machine_arg(&args), &target, &context, "local_pty");
                let dir = watcher_sessions_dir().ok_or("cannot resolve ~/.watcher/sessions")?;
                std::fs::create_dir_all(&dir)?;
                let path = dir.join(format!("{session}.json"));
                write_session_episodes(&path, &base, vec![]); // visible in The Watcher immediately
                if prior.is_none() {
                    eprintln!("[watcher-capture] no live session found — started a new one ('{target}').");
                }
                (path, base, true)
            }
        };
        let name = session_label(&base);
        eprintln!("[watcher-capture] attached to '{name}'. Your commands will appear in The Watcher live.");
        eprintln!("                  Hack as normal; type 'exit' to stop capturing.");
        run_attached(profile.as_ref(), &path, &base)?;
        if self_started {
            mark_finished(&path); // we own this session's lifecycle; close it on exit
        }
        return Ok(());
    }

    let interactive = args.iter().any(|a| a == "--interactive" || a == "-i");
    let label = args
        .iter()
        .position(|a| a == "--label")
        .and_then(|i| args.get(i + 1).cloned())
        .unwrap_or_else(|| "capture session".to_string());

    eprintln!("[watcher-capture] session {session} via {surface} ({}, platform={platform})", if interactive { "interactive" } else { "scripted" });

    let raw_events = if interactive {
        run_interactive(profile.as_ref(), &session, &platform)?
    } else {
        let commands: Vec<String> = match args.iter().position(|a| a == "--") {
            Some(i) if i + 1 < args.len() => args[i + 1..].to_vec(),
            _ => profile.demo_commands(),
        };
        run_scripted(profile.as_ref(), &commands, &session, &platform)?
    };
    let mut events = add_session_lifecycle(raw_events, &session, &label, &platform);

    // in-VM / agent identity: default to a local host PTY; override for a guest box.
    let source = arg_value(&args, "--source").unwrap_or_else(|| "local_pty".to_string());
    let context = arg_value(&args, "--context").unwrap_or_else(|| match arg_value(&args, "--platform") {
        Some(_) => format!("cloud:{platform}:openvpn"),
        None => "host".to_string(), // unchanged default when --platform is omitted
    });
    retag(&mut events, &source, &context);

    if let Some(addr) = arg_value(&args, "--forward") {
        forward_events(&addr, &source, &context, &events)?;
    } else {
        for e in &events {
            println!("{}", serde_json::to_string(e)?);
        }
        eprintln!("[watcher-capture] emitted {} envelopes", events.len());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_declares_exact_fidelity() {
        let h = handshake_json("in_vm_daemon", "cloud:htb:pwnbox");
        let v: serde_json::Value = serde_json::from_str(&h).unwrap();
        assert_eq!(v["plugin"], "in_vm_daemon");
        assert_eq!(v["class"], "source");
        assert_eq!(v["capabilities"]["boundary_confidence"], "exact");
        assert_eq!(v["context_template"], "cloud:htb:pwnbox");
    }

    #[test]
    fn episode_carries_absolute_start_timestamp() {
        // Absolute wall-clock is the linchpin for merge-sorting concurrent lanes into one report;
        // it must survive the Captured -> episode conversion (start_us in µs -> started_at_ms).
        let caps = vec![Captured {
            cmd: "nmap -sC 10.10.10.5".into(),
            output: "22/tcp open ssh".into(),
            exit: Some(0),
            start_us: 5_000_000, // 5.0s
            end_us: 8_000_000,   // 8.0s
        }];
        let eps = episodes_from_captured(&caps);
        assert_eq!(eps[0]["started_at_ms"], json!(5_000));
        // duration still spans the same window
        assert_eq!(eps[0]["duration_ms"], json!(3_000));
    }

    #[test]
    fn attach_starts_new_when_no_active_session() {
        let c = resolve_attach(None, Some("Knife"), false, || panic!("should not prompt"));
        assert_eq!(c, AttachChoice::StartNew);
    }

    #[test]
    fn attach_same_machine_prompts_and_respects_choice() {
        assert_eq!(resolve_attach(Some("Knife"), Some("Knife"), false, || false), AttachChoice::UseExisting);
        assert_eq!(resolve_attach(Some("Knife"), Some("Knife"), false, || true), AttachChoice::StartNew);
    }

    #[test]
    fn attach_new_flag_skips_prompt() {
        let c = resolve_attach(Some("Knife"), Some("Knife"), true, || panic!("--new must not prompt"));
        assert_eq!(c, AttachChoice::StartNew);
    }

    #[test]
    fn attach_different_machine_starts_new_without_prompt() {
        let c = resolve_attach(Some("Knife"), Some("Sau"), false, || panic!("a different box must not prompt"));
        assert_eq!(c, AttachChoice::StartNew);
    }

    #[test]
    fn attach_without_requested_machine_treats_live_as_target() {
        // No --machine: the live session is presumably the intended engagement, so still ask.
        assert_eq!(resolve_attach(Some("Knife"), None, false, || false), AttachChoice::UseExisting);
    }

    #[test]
    fn retag_sets_source_and_context() {
        let mut evs = vec![TelemetryEvent::command("s", 1, 0, "id", Some(0), 1.0, "unix-pty")];
        retag(&mut evs, "in_vm_daemon", "cloud:htb:pwnbox");
        assert_eq!(evs[0].source, "in_vm_daemon");
        assert_eq!(evs[0].provenance.context_path, "cloud:htb:pwnbox");
    }

    #[test]
    fn platform_arg_defaults_to_local() {
        assert_eq!(platform_arg(&[]), "local");
        assert_eq!(platform_arg(&["--machine".into(), "Forge".into()]), "local");
    }

    #[test]
    fn platform_arg_reads_flag() {
        let args = vec!["--platform".to_string(), "thm".to_string()];
        assert_eq!(platform_arg(&args), "thm");
    }

    #[test]
    fn build_base_report_carries_neutral_platform_into_context_and_target() {
        // Mirrors how main() wires --platform/--target: --target wins over --machine for the
        // scope, and an explicit --platform folds into context_path (cloud:<platform>:openvpn).
        let args: Vec<String> =
            ["--platform", "thm", "--target", "Blue", "--machine", "ignored-alias"].iter().map(|s| s.to_string()).collect();
        let target = arg_value(&args, "--target").or_else(|| arg_value(&args, "--machine")).unwrap();
        let platform = platform_arg(&args);
        let context = format!("cloud:{platform}:openvpn");
        let v = build_base_report("u3", machine_arg(&args), &target, &context, "local_pty");
        assert_eq!(v["session"]["target_scope"], "Blue");
        assert_eq!(v["session"]["context_path"], "cloud:thm:openvpn");
    }

    #[test]
    fn machine_alone_keeps_htb_default_context() {
        // No --platform/--target: --machine still names target_scope and context stays untouched
        // by this helper set (callers keep their original "host"/"cloud:htb:pwnbox" default).
        let args: Vec<String> = ["--machine", "Forge"].iter().map(|s| s.to_string()).collect();
        let target = arg_value(&args, "--target").or_else(|| arg_value(&args, "--machine")).unwrap();
        assert_eq!(target, "Forge");
        assert!(arg_value(&args, "--platform").is_none());
    }

    #[test]
    fn self_started_local_session_carries_local_provenance() {
        // a self-started --attach session: local_pty source, recording, named by --machine
        let v = build_base_report("u1", machine_arg(&["--machine".into(), "Forge".into()]), "Forge", "host", "local_pty");
        assert_eq!(v["session"]["source"], "local_pty");
        assert_eq!(v["session"]["machine"]["name"], "Forge");
        assert_eq!(v["recording"], true);
        // the Pwnbox download note must NOT leak into a local capture
        let note = v["coaching"]["next_steps"][0]["action"].as_str().unwrap();
        assert!(!note.contains("Pwnbox"), "local capture should not mention Pwnbox: {note}");
    }

    #[test]
    fn pwnbox_export_keeps_download_note() {
        let v = build_base_report("u2", Value::Null, "Pwnbox session", "cloud:htb:pwnbox", "in_vm_daemon");
        assert_eq!(v["session"]["source"], "in_vm_daemon");
        assert!(v["coaching"]["next_steps"][0]["action"].as_str().unwrap().contains("Pwnbox"));
    }
}
