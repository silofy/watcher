//! Re-redaction on receipt (brief §3.3): the daemon never trusts an upstream agent's own
//! scrubbing — the privacy guarantee lives in the core. Masks IPs, flag hashes, and
//! credential-shaped tokens. Deterministic.

use regex::{Captures, Regex};
use std::sync::OnceLock;

fn ipv4() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap())
}
fn flag() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\b[0-9a-fA-F]{32}\b").unwrap())
}
fn secret() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)\b(password|passwd|pass|secret|token|api[_-]?key)\b\s*[:=]\s*\S+").unwrap())
}

/// Mask IPv4 addresses, 32-hex flags, and credential tokens.
pub fn redact(s: &str) -> String {
    let a = ipv4().replace_all(s, "x.x.x.x");
    let b = flag().replace_all(&a, "[redacted-flag]");
    let c = secret().replace_all(&b, |caps: &Captures| format!("{}=[redacted]", &caps[1]));
    c.into_owned()
}

/// Mask credential-bearing HTTP header values, preserving header names and structure.
pub fn redact_headers(headers: &str) -> String {
    let sensitive = |name: &str| {
        let n = name.trim().to_ascii_lowercase();
        n == "authorization" || n == "cookie" || n == "set-cookie"
            || n == "x-api-key" || n == "x-auth-token" || n.ends_with("-api-key")
    };
    headers
        .split("\r\n")
        .map(|line| match line.split_once(':') {
            Some((name, _)) if sensitive(name) => format!("{}: [redacted]", name),
            _ => line.to_string(),
        })
        .collect::<Vec<_>>()
        .join("\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_ips_flags_and_credentials() {
        assert_eq!(redact("ssh root@10.10.10.8"), "ssh root@x.x.x.x");
        assert_eq!(redact("flag 0123456789abcdef0123456789abcdef done"), "flag [redacted-flag] done");
        assert_eq!(redact("PASSWORD=hunter2"), "PASSWORD=[redacted]");
        assert_eq!(redact("api_key: sk-abc123"), "api_key=[redacted]");
    }

    #[test]
    fn leaves_clean_text_untouched() {
        assert_eq!(redact("uid=0(root) gid=0(root)"), "uid=0(root) gid=0(root)");
    }

    #[test]
    fn masks_auth_headers_and_cookies() {
        let h = "Host: t\r\nAuthorization: Bearer sk-abc123\r\nCookie: session=deadbeef; a=b\r\nAccept: */*";
        let out = redact_headers(h);
        assert!(out.contains("Host: t"));
        assert!(out.contains("Accept: */*"));
        assert!(!out.contains("sk-abc123"));
        assert!(!out.contains("deadbeef"));
        assert!(out.contains("Authorization: [redacted]"));
        assert!(out.contains("Cookie: [redacted]"));
    }
}
