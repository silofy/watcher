"""Burp -> Watcher bridge: poll Burp's MCP proxy history, emit web telemetry.

Run standalone (spawned by `--web`, crates/capture/src/main.rs::spawn_web_bridge):

    python plugins/burp-bridge/bridge.py --platform htb

Off the terminal capture's critical path — this process is fire-and-forget. It must never raise
a traceback: a missing `mcp` package or an unreachable Burp both degrade to a one-line message and
exit 0, so `--web` is always safe to pass even before Burp is running or deps are installed.
"""
import os
import socket
import sys
import time

from burp_mcp import BurpClient

DEFAULT_PORT = 9876

# Preflight/nudge wording — copied verbatim from src/lib/preflight.ts (that file is the single
# source of the wording; its test pins it). Kept in sync by hand since this is Python, not TS.


def _msg_deps_missing() -> str:
    return "burp-bridge needs Python 3.x and the mcp client. Install: pip install -r plugins/burp-bridge/requirements.txt"


def _msg_unreachable(port: int = DEFAULT_PORT) -> str:
    return (
        f"Can't reach Burp's MCP server at 127.0.0.1:{port}. Is Burp running with the MCP "
        "Server extension enabled? Setup: docs/web-capture.md"
    )


def _msg_empty_scope() -> str:
    return "Burp scope is empty — Watcher will ingest all proxied traffic. Set a target scope in Burp to limit what's recorded."


def poll_once(history, watcher, scope, seen):
    """Emit unseen, in-scope exchanges once. Pure over its inputs for testability."""
    for ex in history:
        pid = ex["pair_id"]
        if pid in seen:
            continue
        if scope and ex.get("host") not in scope:
            continue
        seen.add(pid)
        watcher.http_request(pair_id=pid, method=ex["method"], url=ex["url"],
                             req_headers=ex.get("req_headers", ""), req_body=ex.get("req_body", ""))
        watcher.http_response(pair_id=pid, status=ex.get("status", 0),
                              resp_headers=ex.get("resp_headers", ""), resp_body=ex.get("resp_body", ""),
                              mime=ex.get("mime", ""))


DEFAULT_MAX_CONSECUTIVE_FAILURES = 5


def run(client, watcher, scope, interval=2.0, max_consecutive_failures=None):
    """Poll until the daemon or Burp goes away, then let `finally` clean up.

    A dead daemon socket (this run's session already ended) or an unreachable Burp both manifest
    as repeated poll failures, not a single one-off blip — so this only stops on N CONSECUTIVE
    failures, configurable via `max_consecutive_failures` or the WATCHER_BRIDGE_MAX_FAILURES env
    var, defaulting to DEFAULT_MAX_CONSECUTIVE_FAILURES. A successful poll resets the counter. A
    failure of the SDK send itself (watcher.http_request/http_response raising — the daemon socket
    closed) counts the same as a Burp-side failure: both are "this run is over" signals.
    """
    if max_consecutive_failures is None:
        max_consecutive_failures = int(os.environ.get("WATCHER_BRIDGE_MAX_FAILURES", DEFAULT_MAX_CONSECUTIVE_FAILURES))
    seen, cursor = set(), 0
    consecutive_failures = 0
    watcher.session_start("Burp web capture")
    try:
        while True:
            try:
                history, cursor = client.history_since(cursor)
                poll_once(history, watcher, scope, seen)
                consecutive_failures = 0
            except Exception as e:  # never crash the run — degrade, but track for the stop condition
                consecutive_failures += 1
                print(f"[burp-bridge] poll failed ({consecutive_failures}/{max_consecutive_failures}): {e}")
                if consecutive_failures >= max_consecutive_failures:
                    print("[burp-bridge] too many consecutive failures — stopping.")
                    break
            time.sleep(interval)
    finally:
        watcher.session_end(); watcher.close()


def _arg_or_env(argv, flag, env_name, default=None):
    """`--flag value` from argv, else the matching env var, else default — mirrors how
    crates/capture/src/main.rs passes `--platform` (and friends) through to this child process."""
    if flag in argv:
        i = argv.index(flag)
        if i + 1 < len(argv):
            return argv[i + 1]
    return os.environ.get(env_name, default)


def _parse_scope(raw):
    return {h.strip() for h in raw.split(",") if h.strip()} if raw else set()


def _reachable(port: int) -> bool:
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1.0).close()
        return True
    except OSError:
        return False


def _connect_session(port: int):
    """Establish the live MCP client session against Burp's MCP Server extension and adapt it to
    the synchronous `call_tool(name, args)` shape `BurpClient` expects.

    This is the one Burp-specific integration seam: structurally wired to the `mcp` package's SSE
    transport (Burp's extension exposes an SSE endpoint on the MCP port), but NOT exercised
    against a real Burp instance in this environment — validate it manually against a running
    Burp + MCP Server extension (docs/web-capture.md) before relying on it. Every failure mode
    here (wrong transport shape, handshake mismatch, mid-session disconnect) is caught by the
    broad `except Exception` in `main()`, so it degrades to the `unreachable` message rather than
    a traceback.
    """
    import asyncio

    from mcp import ClientSession
    from mcp.client.sse import sse_client

    class _SyncSession:
        """Bridges the async `ClientSession.call_tool` to `BurpClient`'s synchronous call — the
        poll loop in `run()`/`poll_once()` is deliberately synchronous, so one persistent event
        loop drives each round-trip."""

        def __init__(self, session, loop):
            self._session, self._loop = session, loop

        def call_tool(self, name, args):
            result = self._loop.run_until_complete(self._session.call_tool(name, args))
            content = getattr(result, "content", result)
            return content if isinstance(content, list) else [content]

    async def _open():
        url = f"http://127.0.0.1:{port}/sse"
        read, write = await sse_client(url).__aenter__()
        session = await ClientSession(read, write).__aenter__()
        await session.initialize()
        return session

    loop = asyncio.new_event_loop()
    session = loop.run_until_complete(_open())
    return BurpClient(_SyncSession(session, loop))


def main(argv=None) -> int:
    """Entry point for running the bridge standalone. Reads --platform/--scope from argv or the
    matching WATCHER_* env vars, then joins the run started by --attach. Degrades gracefully
    (message + exit 0, no traceback) when the mcp client isn't installed or Burp isn't reachable —
    both are ordinary states (fresh checkout, Burp not open yet) that must never surface as a crash
    in what is always a fire-and-forget child process."""
    argv = sys.argv[1:] if argv is None else argv
    platform = _arg_or_env(argv, "--platform", "WATCHER_PLATFORM", "local")
    scope = _parse_scope(_arg_or_env(argv, "--scope", "WATCHER_SCOPE", ""))
    port = int(_arg_or_env(argv, "--port", "WATCHER_BURP_MCP_PORT", str(DEFAULT_PORT)))

    try:
        import mcp  # noqa: F401 — presence check; the real API is used in _connect_session
    except ImportError:
        print(f"[burp-bridge] {_msg_deps_missing()}")
        return 0

    if not _reachable(port):
        print(f"[burp-bridge] {_msg_unreachable(port)}")
        return 0

    if not scope:
        print(f"[burp-bridge] {_msg_empty_scope()}")

    print(f"[burp-bridge] joining platform={platform} scope={sorted(scope) or 'all hosts'}")
    try:
        client = _connect_session(port)
        from watcher_sdk import Watcher  # plugins/sdk — see cloudshell_plugin.py for the pattern
        watcher = Watcher("burp-bridge", context_template="web:burp", has_stdin=False)
        run(client, watcher, scope)
    except Exception as e:  # any setup/session failure — degrade, never crash the caller
        print(f"[burp-bridge] {_msg_unreachable(port)} ({e})")
        return 0
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))
    raise SystemExit(main())
