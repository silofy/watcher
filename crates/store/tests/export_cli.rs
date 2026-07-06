use std::process::Command;

#[test]
fn export_cli_prints_ndjson() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("t.db");
    let db = db.to_str().unwrap();
    let bin = env!("CARGO_BIN_EXE_watcher-store");

    // ingest a command via stdin
    let stream = r#"{"source":"local_pty","session_uuid":"s1","seq":1,"ts_utc_us":100,"kind":"command","payload":{"cmd":"whoami"},"provenance":{"platform":"htb"}}"#;
    let mut ingest = Command::new(bin).args(["--db", db, "--key", "k"])
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::null())
        .spawn().unwrap();
    use std::io::Write;
    ingest.stdin.take().unwrap().write_all(stream.as_bytes()).unwrap();
    assert!(ingest.wait().unwrap().success());

    // export
    let out = Command::new(bin).args(["--db", db, "--key", "k", "--export"]).output().unwrap();
    assert!(out.status.success());
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert!(stdout.contains("\"kind\":\"command\""));
    assert!(stdout.contains("\"cmd\":\"whoami\""));
}
