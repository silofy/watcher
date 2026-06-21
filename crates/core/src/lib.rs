//! Shared core for The Watcher daemon. The session lifecycle controller and the re-redaction
//! pass live here so both the capture agent and the daemon use one implementation.

pub mod redact;
pub mod session;

pub use redact::redact;
pub use session::{EndReason, SessionConfig, SessionController, SessionEvent};
