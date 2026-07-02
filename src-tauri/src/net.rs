//! Server-side write-up fetch. The webview's `fetch()` is CORS-blocked on arbitrary blogs (0xdf,
//! ippsec notes, etc.), so a URL write-up can only be pulled from the native side. Fetches the page
//! bytes and returns them as text for the local model to extract the intended path from — nothing is
//! uploaded, this is the one optional outbound request and it's initiated by the user pasting a URL.

use std::io::Read;
use std::sync::Arc;

/// Fetch a write-up URL's body as text (no CORS). PDFs come back as lossy text for now; HTML/markdown
/// pages (the common case) come back clean.
#[tauri::command]
pub fn fetch_writeup(url: String) -> Result<String, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) URLs are supported".into());
    }
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let agent = ureq::builder().tls_connector(Arc::new(tls)).build();
    let resp = agent.get(&url).call().map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .take(25_000_000)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Open an http(s) URL in the user's default browser. In the desktop webview a `target="_blank"` link
/// doesn't escape to the OS browser, so external links (IppSec/HTB searches, MITRE, downloads) route
/// through here. Uses the platform opener; the URL is scheme-checked so only web links are launched.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("only http(s) URLs are supported".into());
    }
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("cmd").args(["/C", "start", "", &url]).spawn();
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(&url).spawn();

    spawned.map(|_| ()).map_err(|e| format!("could not open the browser: {e}"))
}
