"""Burp -> Watcher bridge: poll Burp's MCP proxy history, emit web telemetry."""
import time


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


def run(client, watcher, scope, interval=2.0):
    seen, cursor = set(), 0
    watcher.session_start("Burp web capture")
    try:
        while True:
            try:
                history, cursor = client.history_since(cursor)
                poll_once(history, watcher, scope, seen)
            except Exception as e:  # never crash the run — degrade
                print(f"[burp-bridge] poll failed: {e}")
            time.sleep(interval)
    finally:
        watcher.session_end(); watcher.close()
