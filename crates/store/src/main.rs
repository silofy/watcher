//! watcher-store — ingest §3.3 telemetry (NDJSON) into the encrypted SQLCipher store.
//!
//!   watcher-store --db <path> [--key <key>] [--ndjson <path>]   (NDJSON defaults to stdin)

use std::io::Read;

use watcher_store::{dump, export_ndjson, ingest, open, parse_ndjson};

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db = arg("--db").ok_or("missing --db <path>")?;
    let key = arg("--key").unwrap_or_else(|| "watcher-dev-key".to_string());

    // export mode: reconstruct the §3.3 NDJSON stream from the store and print it
    if std::env::args().any(|a| a == "--export") {
        let conn = open(&db, &key)?;
        let session = arg("--session");
        print!("{}", export_ndjson(&conn, session.as_deref())?);
        return Ok(());
    }

    // read-back mode: decrypt and print the stored sessions/commands
    if std::env::args().any(|a| a == "--dump") {
        let conn = open(&db, &key)?;
        print!("{}", dump(&conn)?);
        return Ok(());
    }

    let ndjson = match arg("--ndjson") {
        Some(p) => std::fs::read_to_string(p)?,
        None => {
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s)?;
            s
        }
    };

    let events = parse_ndjson(&ndjson);
    let mut conn = open(&db, &key)?;
    let (cmds, outs) = ingest(&mut conn, &events)?;

    eprintln!("[watcher-store] {db}: ingested {cmds} commands, {outs} output blocks (AES-256, SQLCipher)");
    Ok(())
}
