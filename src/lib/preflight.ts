/**
 * Web capture enablement strings (brief §8). Single source of the wording for `--web`'s three
 * preflight states plus the detect-and-nudge — pinned by preflight.test.ts, and copied verbatim
 * into crates/capture/src/main.rs (Rust-side stdout) and plugins/burp-bridge/bridge.py (the
 * child process's own degrade path) so the message reads the same no matter where it fires.
 */
export type PreflightState = "unreachable" | "deps_missing" | "empty_scope" | "detected";

export function preflightMessage(state: PreflightState, opts: { port?: number } = {}): string {
  const port = opts.port ?? 9876;
  switch (state) {
    case "unreachable":
      return `Can't reach Burp's MCP server at 127.0.0.1:${port}. Is Burp running with the MCP Server extension enabled? Setup: docs/web-capture.md`;
    case "deps_missing":
      return `burp-bridge needs Python 3.x and the mcp client. Install: pip install -r plugins/burp-bridge/requirements.txt`;
    case "empty_scope":
      return `Burp scope is empty — Watcher will ingest all proxied traffic. Set a target scope in Burp to limit what's recorded.`;
    case "detected":
      return `Burp MCP detected; add --web to record web traffic`;
  }
}
