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
    R.get_or_init(|| Regex::new(r"(?i)\b(password|passwd|pass|secret|token|api[_-]?key)\b\s*[:=]\s*[^\s&]+").unwrap())
}
fn bearer() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+").unwrap())
}
fn jwt() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b").unwrap())
}
fn api_key() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"\b(?:sk|pk|ghp|xox[baprs])[_-][A-Za-z0-9_-]{10,}\b").unwrap())
}

/// Mask IPv4 addresses, 32-hex flags, and credential tokens.
pub fn redact(s: &str) -> String {
    let a = ipv4().replace_all(s, "x.x.x.x");
    let b = flag().replace_all(&a, "[redacted-flag]");
    let c = secret().replace_all(&b, |caps: &Captures| format!("{}=[redacted]", &caps[1]));
    c.into_owned()
}

/// Mask bearer tokens, JWTs, and common API-key shapes in free text (bodies, query strings,
/// urls), preserving surrounding structure (param names, the literal "Bearer " prefix).
pub fn redact_tokens(s: &str) -> String {
    let a = bearer().replace_all(s, "Bearer [redacted]");
    let b = jwt().replace_all(&a, "[redacted-jwt]");
    let c = api_key().replace_all(&b, "[redacted-key]");
    c.into_owned()
}

/// Full redaction for HTTP url/body values: existing rules plus token shapes.
pub fn redact_body(s: &str) -> String {
    redact_tokens(&redact(s))
}

/// Mask credential-bearing HTTP header values, preserving header names and structure.
pub fn redact_headers(headers: &str) -> String {
    let sensitive = |name: &str| {
        let n = name.trim().to_ascii_lowercase();
        n == "authorization" || n == "cookie" || n == "set-cookie"
            || n == "x-api-key" || n == "x-auth-token" || n.ends_with("-api-key")
    };
    headers
        .split('\n')
        .map(|raw| {
            let line = raw.strip_suffix('\r').unwrap_or(raw);
            match line.split_once(':') {
                Some((name, _)) if sensitive(name) => format!("{}: [redacted]", name),
                _ => line.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
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
    fn keyword_secret_stops_at_param_delimiter() {
        let out = redact_body("token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig&user=admin&id=7");
        assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9"));
        assert!(out.contains("user=admin"));   // trailing params must survive
        assert!(out.contains("id=7"));
    }

    #[test]
    fn leaves_clean_text_untouched() {
        assert_eq!(redact("uid=0(root) gid=0(root)"), "uid=0(root) gid=0(root)");
    }

    #[test]
    fn masks_auth_headers_and_cookies() {
        let h = "Host: t\r\nAuthorization: Bearer sk-abc123\r\nCookie: session=deadbeef; a=b\r\nAccept: */*\r\nSet-Cookie: sid=abc123\r\nX-API-Key: k-123456\r\nX-Auth-Token: tok-abcdef";
        let out = redact_headers(h);
        assert!(out.contains("Host: t"));
        assert!(out.contains("Accept: */*"));
        assert!(!out.contains("sk-abc123"));
        assert!(!out.contains("deadbeef"));
        assert!(out.contains("Authorization: [redacted]"));
        assert!(out.contains("Cookie: [redacted]"));
        assert!(!out.contains("sid=abc123"));
        assert!(!out.contains("k-123456"));
        assert!(!out.contains("tok-abcdef"));
        assert!(out.contains("Set-Cookie: [redacted]"));
        assert!(out.contains("X-API-Key: [redacted]"));
        assert!(out.contains("X-Auth-Token: [redacted]"));
    }

    #[test]
    fn masks_headers_joined_with_bare_newlines() {
        let h = "Host: t\nAuthorization: Bearer secret123\nCookie: session=deadbeef";
        let out = redact_headers(h);
        assert!(!out.contains("secret123"));
        assert!(!out.contains("deadbeef"));
        assert!(out.contains("Authorization: [redacted]"));
        assert!(out.contains("Cookie: [redacted]"));
        assert!(out.contains("Host: t"));
    }

    #[test]
    fn masks_token_shapes_but_keeps_param_names() {
        // JWT value masked, param name survives (shape preserved)
        let out = redact_body("access=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-_123&user=admin");
        assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9"));
        assert!(out.contains("access="));
        assert!(out.contains("user=admin"));
        // bearer + sk- key masked
        let b = redact_body("Authorization was Bearer sk-live-abcdef0123456789 here");
        assert!(!b.contains("sk-live-abcdef0123456789"));
        assert!(b.contains("Bearer [redacted]") || b.contains("[redacted-key]"));
    }
}
