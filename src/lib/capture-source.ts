import type { Session } from "../types/report";

/**
 * A friendly, colour-coded identity for WHERE a run was captured. The Session
 * carries a coarse `source` (local_pty | in_vm_daemon | plugin), but every
 * ingest adapter also stamps a finer signal on `shell`/`context_path`
 * (claude-code, http-proxy, sysmon, web:*, edr:*). This collapses both into one
 * badge so the UI can tell an AI-agent run from a terminal run from an
 * EDR-reconstructed run, instead of labelling them all "Plugin".
 */
export interface CaptureSource {
  key: string;
  label: string;
  /** A theme CSS var suitable for <Chip color=...>. */
  color: string;
  /** One-line explanation for a tooltip/aria. */
  hint: string;
}

export function captureSource(session: Session): CaptureSource {
  const shell = (session.shell ?? "").toLowerCase();
  const ctx = (session.context_path ?? "").toLowerCase();

  if (shell === "claude-code" || ctx.startsWith("agent") || ctx.startsWith("claude")) {
    return { key: "claude-code", label: "Claude Code", color: "var(--color-signal)", hint: "Reconstructed from a Claude Code agent transcript." };
  }
  if (shell === "http-proxy" || ctx.startsWith("web:")) {
    return { key: "http-proxy", label: "HTTP proxy", color: "var(--color-web)", hint: "Captured from HTTP proxy traffic (HAR / Burp)." };
  }
  if (shell === "sysmon" || ctx.startsWith("edr:")) {
    return { key: "sysmon", label: "EDR / Sysmon", color: "var(--color-flag)", hint: "Reconstructed from host telemetry (Sysmon / EDR)." };
  }
  if (session.source === "local_pty") {
    return { key: "local_pty", label: "Local terminal", color: "var(--color-manual)", hint: "Recorded live from your terminal (userspace PTY)." };
  }
  if (session.source === "in_vm_daemon") {
    return { key: "in_vm_daemon", label: "Pwnbox / VM", color: "var(--color-tool)", hint: "Captured by the in-VM daemon (Pwnbox)." };
  }
  return { key: session.source ?? "plugin", label: "Plugin", color: "var(--color-muted)", hint: "Imported through a capture plugin." };
}
