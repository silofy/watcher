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
use terminal::{clean_lines, extract_sessions, Sink, Terminal};

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

    let dump = std::env::temp_dir().join("watcher-capture-transcript.txt");
    let _ = std::fs::write(&dump, term.lock().unwrap().lines.join("\n"));
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

// ---- Attach mode: correlate a local terminal to the HTB session the extension opened ----
//
// The browser extension writes ~/.watcher/sessions/<uuid>.json with the machine identity and
// recording:true. `--attach` finds that session and streams the commands you run in a watched
// shell straight into it as episodes, so your local hacking shows up in the report — correlated to
// the box, with no second session to reconcile.

use serde_json::{json, Value};

fn watcher_sessions_dir() -> Option<std::path::PathBuf> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok()?;
    Some(std::path::Path::new(&home).join(".watcher").join("sessions"))
}

/// The newest still-recording session file (the engagement the extension currently has open).
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
    let caps = extract_sessions(t);
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

/// Merge episodes into the session file the extension wrote (preserving its machine identity).
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
    let _ = std::fs::write(path, serde_json::to_string_pretty(&v).unwrap_or_default());
}

fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Build the machine-identity block for a standalone export from CLI args (Pwnbox has no extension
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

/// A complete, schema-shaped report for a standalone capture (the in-Pwnbox agent). Same shape the
/// daemon writes for a live session, so the file can be dropped straight into ~/.watcher/sessions/.
fn build_base_report(uuid: &str, machine: Value, target: &str, context: &str) -> Value {
    let t = iso_now();
    json!({
        "schema_version": "1.0",
        "session": { "uuid": uuid, "started_at": t, "ended_at": t, "target_scope": target,
                     "context_path": context, "shell": "", "source": "in_vm_daemon", "machine": machine },
        "episodes": [], "phases": [], "golden_dag": [],
        "metrics": { "efficiency_pct": 0, "objective_coverage_pct": 0, "stealth_score": 100, "technique_breadth": 0,
                     "time_waster": { "productive_ms": 0, "detour_ms": 0, "stuck_ms": 0, "loop_ms": 0, "t_active_ms": 0 } },
        "coaching": { "skill_radar": { "recon": 0, "web": 0, "exploit": 0, "privesc": 0, "opsec": 0 },
                      "next_steps": [{ "action": "Captured inside Pwnbox. Download this file and drop it into ~/.watcher/sessions/ on your PC.", "why": "", "category": "Recap", "evidence_seq": null }] },
        "redaction_profile": "full",
        "recording": true
    })
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

    // Stream episodes into the session file as commands complete.
    let writer_term = term.clone();
    let writer_path = path.to_path_buf();
    let writer_base = base.clone();
    let writer_running = running.clone();
    let ep_handle = thread::spawn(move || {
        let mut last = usize::MAX;
        loop {
            thread::sleep(Duration::from_millis(800));
            let eps = episodes_from_terminal(&writer_term.lock().unwrap());
            if eps.len() != last {
                last = eps.len();
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

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let profile = platform_profile();
    let session = Uuid::new_v4().to_string();
    let platform = profile.platform_tag();

    let args: Vec<String> = std::env::args().collect();

    // Standalone capture (the in-Pwnbox agent): record with our own identity, write a complete
    // report to a file the user downloads and imports. No extension session needed.
    if let Some(out) = arg_value(&args, "--export") {
        let target = arg_value(&args, "--machine").unwrap_or_else(|| "Pwnbox session".to_string());
        let context = arg_value(&args, "--context").unwrap_or_else(|| "cloud:htb:pwnbox".to_string());
        let base = build_base_report(&session, machine_arg(&args), &target, &context);
        let path = std::path::PathBuf::from(&out);
        write_session_episodes(&path, &base, vec![]); // create it immediately so it's visible live
        eprintln!("[watcher-capture] exporting to {out} — hack as normal, type 'exit' to finish.");
        run_attached(profile.as_ref(), &path, &base)?;
        // Mark finished so it imports as an archived run, not a live recording.
        if let Ok(s) = std::fs::read_to_string(&path) {
            if let Ok(mut v) = serde_json::from_str::<Value>(&s) {
                v["recording"] = json!(false);
                v["session"]["ended_at"] = json!(iso_now());
                let _ = std::fs::write(&path, serde_json::to_string_pretty(&v).unwrap_or_default());
            }
        }
        eprintln!("[watcher-capture] done -> {out}. Download it and drop it into ~/.watcher/sessions/ on your PC.");
        return Ok(());
    }

    // Attach to the live HTB session the extension opened and stream local commands into it.
    if args.iter().any(|a| a == "--attach") {
        let Some((path, base)) = find_active_session() else {
            eprintln!("[watcher-capture] no active recording session in ~/.watcher/sessions.");
            eprintln!("                  Spawn a box on HTB first (the extension opens the session), then re-run.");
            return Ok(());
        };
        let name = base["session"]["machine"]["name"].as_str().unwrap_or("session").to_string();
        eprintln!("[watcher-capture] attached to '{name}'. Your commands will appear in The Watcher live.");
        eprintln!("                  Hack as normal; type 'exit' to stop capturing.");
        return run_attached(profile.as_ref(), &path, &base);
    }

    let interactive = args.iter().any(|a| a == "--interactive" || a == "-i");
    let label = args
        .iter()
        .position(|a| a == "--label")
        .and_then(|i| args.get(i + 1).cloned())
        .unwrap_or_else(|| "capture session".to_string());

    eprintln!("[watcher-capture] session {session} via {platform} ({})", if interactive { "interactive" } else { "scripted" });

    let raw_events = if interactive {
        run_interactive(profile.as_ref(), &session, platform)?
    } else {
        let commands: Vec<String> = match args.iter().position(|a| a == "--") {
            Some(i) if i + 1 < args.len() => args[i + 1..].to_vec(),
            _ => profile.demo_commands(),
        };
        run_scripted(profile.as_ref(), &commands, &session, platform)?
    };
    let mut events = add_session_lifecycle(raw_events, &session, &label, platform);

    // in-VM / agent identity: default to a local host PTY; override for a guest box.
    let source = arg_value(&args, "--source").unwrap_or_else(|| "local_pty".to_string());
    let context = arg_value(&args, "--context").unwrap_or_else(|| "host".to_string());
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
    fn retag_sets_source_and_context() {
        let mut evs = vec![TelemetryEvent::command("s", 1, 0, "id", Some(0), 1.0, "unix-pty")];
        retag(&mut evs, "in_vm_daemon", "cloud:htb:pwnbox");
        assert_eq!(evs[0].source, "in_vm_daemon");
        assert_eq!(evs[0].provenance.context_path, "cloud:htb:pwnbox");
    }
}
