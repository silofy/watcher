//! Session controller — the lifecycle layer above continuous capture.
//!
//! Capture is always rolling; a *session* (= one report, e.g. one HTB machine) is a bounded
//! window over that stream. This controller decides those boundaries deterministically from
//! signals, strongest wins, with manual override always available:
//!   * manual `start(label)` / `start_with(uuid, label)` / `stop()`  — explicit / upstream-driven
//!   * auto-start on first activity (optional)                       — when no session is open
//!   * idle auto-close                                               — no activity for `idle_timeout`
//!   * flag detection                                                — a 32-hex token is an
//!                                                                      "objective complete" end-NUDGE
//!
//! Boundaries are signals routed to the human, not irreversible verdicts. The browser extension
//! feeds HTB spawn/stop in here as start/stop; the daemon drives it from the merged stream.

pub struct SessionConfig {
    pub idle_timeout_us: u64,
    /// Start a session automatically on the first command when none is open.
    pub auto_start: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        SessionConfig { idle_timeout_us: 10 * 60 * 1_000_000, auto_start: false }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum EndReason {
    Manual,
    Idle,
}

impl EndReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            EndReason::Manual => "manual",
            EndReason::Idle => "idle",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SessionEvent {
    Start { uuid: String, label: String, at_us: u64 },
    /// A flag-shaped token appeared — surface "looks like you finished; wrap up?".
    Flag { uuid: String, at_us: u64 },
    End { uuid: String, at_us: u64, reason: EndReason },
}

struct Active {
    uuid: String,
    started_us: u64,
    last_us: u64,
    flagged: bool,
}

pub struct SessionController {
    cfg: SessionConfig,
    active: Option<Active>,
    id_gen: Box<dyn FnMut() -> String + Send>,
}

impl SessionController {
    pub fn new(cfg: SessionConfig, id_gen: Box<dyn FnMut() -> String + Send>) -> Self {
        SessionController { cfg, active: None, id_gen }
    }

    pub fn active_uuid(&self) -> Option<&str> {
        self.active.as_ref().map(|a| a.uuid.as_str())
    }

    /// Open a session with a caller-supplied id (e.g. an upstream session_start envelope).
    pub fn start_with(&mut self, uuid: String, label: &str, now_us: u64) -> Vec<SessionEvent> {
        let mut out = Vec::new();
        if let Some(end) = self.stop(now_us, EndReason::Manual) {
            out.extend(end);
        }
        out.push(SessionEvent::Start { uuid: uuid.clone(), label: label.to_string(), at_us: now_us });
        self.active = Some(Active { uuid, started_us: now_us, last_us: now_us, flagged: false });
        out
    }

    /// Open a session, minting an id. Manual or auto-start driven.
    pub fn start(&mut self, label: &str, now_us: u64) -> Vec<SessionEvent> {
        let uuid = (self.id_gen)();
        self.start_with(uuid, label, now_us)
    }

    /// Close the active session, if any.
    pub fn stop(&mut self, now_us: u64, reason: EndReason) -> Option<Vec<SessionEvent>> {
        self.active.take().map(|a| {
            vec![SessionEvent::End { uuid: a.uuid, at_us: now_us.max(a.started_us), reason }]
        })
    }

    /// Observe one activity event: idle auto-close, optional auto-start, flag detection, and
    /// stamping the active session's activity clock.
    pub fn observe(&mut self, is_command: bool, text: &str, label_hint: &str, now_us: u64) -> Vec<SessionEvent> {
        let mut out = Vec::new();

        if let Some(a) = &self.active {
            if now_us.saturating_sub(a.last_us) > self.cfg.idle_timeout_us {
                let closed_at = a.last_us + self.cfg.idle_timeout_us;
                let uuid = a.uuid.clone();
                self.active = None;
                out.push(SessionEvent::End { uuid, at_us: closed_at, reason: EndReason::Idle });
            }
        }

        if self.active.is_none() && self.cfg.auto_start && is_command {
            out.extend(self.start(label_hint, now_us));
        }

        if let Some(a) = &mut self.active {
            a.last_us = now_us;
            if !a.flagged && contains_flag(text) {
                a.flagged = true;
                out.push(SessionEvent::Flag { uuid: a.uuid.clone(), at_us: now_us });
            }
        }
        out
    }
}

/// True if the text contains a maximal run of exactly 32 hex chars (HTB/THM flag shape).
pub fn contains_flag(s: &str) -> bool {
    let mut run = 0usize;
    let mut prev_hex = false;
    for &b in s.as_bytes() {
        let hex = b.is_ascii_hexdigit();
        if hex {
            run += 1;
        } else {
            if prev_hex && run == 32 {
                return true;
            }
            run = 0;
        }
        prev_hex = hex;
    }
    prev_hex && run == 32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counter() -> Box<dyn FnMut() -> String + Send> {
        let mut n = 0;
        Box::new(move || {
            n += 1;
            format!("s{n}")
        })
    }

    const MIN: u64 = 60 * 1_000_000;

    #[test]
    fn manual_start_and_stop() {
        let mut c = SessionController::new(SessionConfig::default(), counter());
        assert_eq!(
            c.start("Optimum", 1000),
            vec![SessionEvent::Start { uuid: "s1".into(), label: "Optimum".into(), at_us: 1000 }]
        );
        assert_eq!(c.active_uuid(), Some("s1"));
        assert_eq!(
            c.stop(5000, EndReason::Manual),
            Some(vec![SessionEvent::End { uuid: "s1".into(), at_us: 5000, reason: EndReason::Manual }])
        );
        assert_eq!(c.active_uuid(), None);
    }

    #[test]
    fn start_with_honors_an_upstream_id() {
        let mut c = SessionController::new(SessionConfig::default(), counter());
        let evs = c.start_with("ext-uuid".into(), "HTB :: Optimum", 0);
        assert!(matches!(&evs[0], SessionEvent::Start { uuid, .. } if uuid == "ext-uuid"));
        assert_eq!(c.active_uuid(), Some("ext-uuid"));
    }

    #[test]
    fn starting_again_closes_the_previous_session() {
        let mut c = SessionController::new(SessionConfig::default(), counter());
        c.start("box-a", 0);
        let evs = c.start("box-b", 100);
        assert_eq!(evs[0], SessionEvent::End { uuid: "s1".into(), at_us: 100, reason: EndReason::Manual });
        assert!(matches!(&evs[1], SessionEvent::Start { uuid, .. } if uuid == "s2"));
    }

    #[test]
    fn auto_start_on_first_command() {
        let cfg = SessionConfig { auto_start: true, ..Default::default() };
        let mut c = SessionController::new(cfg, counter());
        let evs = c.observe(true, "nmap -sV 10.10.10.5", "10.10.10.5", 0);
        assert!(matches!(&evs[0], SessionEvent::Start { uuid, .. } if uuid == "s1"));
        assert_eq!(c.active_uuid(), Some("s1"));
    }

    #[test]
    fn idle_auto_closes_after_timeout() {
        let cfg = SessionConfig { idle_timeout_us: 10 * MIN, auto_start: false };
        let mut c = SessionController::new(cfg, counter());
        c.start("box", 0);
        assert!(c.observe(true, "ls", "", 5 * MIN).is_empty());
        let evs = c.observe(true, "ls", "", 5 * MIN + 11 * MIN);
        assert_eq!(evs, vec![SessionEvent::End { uuid: "s1".into(), at_us: 15 * MIN, reason: EndReason::Idle }]);
        assert_eq!(c.active_uuid(), None);
    }

    #[test]
    fn flag_detection_nudges_once() {
        let mut c = SessionController::new(SessionConfig::default(), counter());
        c.start("box", 0);
        let evs = c.observe(false, "root flag: 0123456789abcdef0123456789abcdef", "", 10);
        assert_eq!(evs, vec![SessionEvent::Flag { uuid: "s1".into(), at_us: 10 }]);
        assert!(c.observe(false, "deadbeefdeadbeefdeadbeefdeadbeef", "", 20).is_empty());
    }

    #[test]
    fn flag_shape_is_exactly_32_hex() {
        assert!(contains_flag("0123456789abcdef0123456789abcdef"));
        assert!(contains_flag("flag is 0123456789ABCDEF0123456789abcdef!"));
        assert!(!contains_flag("0123456789abcdef0123456789abcde"));
        assert!(!contains_flag("0123456789abcdef0123456789abcdef0"));
        assert!(!contains_flag("not a flag at all"));
    }
}
