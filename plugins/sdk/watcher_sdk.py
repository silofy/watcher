"""The Watcher — thin Python plugin SDK (brief §5.4).

A plugin is any process that emits valid TelemetryEvents to the daemon's local socket. This SDK
handles the capability handshake and the §3.3 envelope framing so a typical wrapper is ~tens of
lines. Go and Rust SDKs follow the same shape.

    from watcher_sdk import Watcher
    w = Watcher("aws-cloudshell", context_template="cloud:aws:cloudshell:us-east-1", has_stdin=True)
    w.session_start("AWS CloudShell")
    w.command("aws s3 ls"); w.output("2024-... my-bucket")
    w.session_end(); w.close()
"""
import json
import socket
import time
import uuid


class Watcher:
    def __init__(self, plugin, *, host="127.0.0.1", port=8799, klass="source",
                 has_exit_codes=False, has_stdin=False, boundary_confidence="inferred",
                 redaction="none", context_template=None, ndjson_path=None):
        self.plugin = plugin
        self.session = str(uuid.uuid4())
        self.seq = 0
        self.ndjson_path = ndjson_path
        self.sock = socket.create_connection((host, port))
        hs = {
            "watcher_handshake": "1.0",
            "plugin": plugin,
            "class": klass,
            "capabilities": {
                "has_exit_codes": has_exit_codes,
                "has_stdin": has_stdin,
                "boundary_confidence": boundary_confidence,
                "redaction": redaction,
            },
        }
        if context_template:
            hs["context_template"] = context_template
        self._send(hs)

    def _now(self):
        return int(time.time() * 1_000_000)

    def _send(self, obj):
        self.sock.sendall((json.dumps(obj) + "\n").encode("utf-8"))

    def _tee(self, obj):
        """Append `obj` as a JSON line to `self.ndjson_path`, if set — additive: the socket send
        this always accompanies is unaffected. Never call this for the capability handshake
        (that's sent directly via `_send` in `__init__`, before any tee wiring exists)."""
        if not self.ndjson_path:
            return
        with open(self.ndjson_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(obj) + "\n")

    def _event(self, kind, payload):
        self.seq += 1
        event = {"source": "plugin", "session_uuid": self.session, "seq": self.seq,
                 "ts_utc_us": self._now(), "kind": kind, "payload": payload}
        self._send(event)
        self._tee(event)

    def command(self, cmd, exit_code=None):
        payload = {"cmd": cmd}
        if exit_code is not None:
            payload["exit_code"] = exit_code
        self._event("command", payload)

    def output(self, text, stream="stdout"):
        self._event("output", {"stream": stream, "text": text, "line_count": text.count("\n") + 1})

    def http_request(self, pair_id, method, url, req_headers="", req_body=""):
        self._event("http_request", {"pair_id": pair_id, "method": method, "url": url,
                                     "req_headers": req_headers, "req_body": req_body})

    def http_response(self, pair_id, status, resp_headers="", resp_body="", mime=""):
        self._event("http_response", {"pair_id": pair_id, "status": status,
                                      "resp_headers": resp_headers, "resp_body": resp_body, "mime": mime})

    def session_start(self, label):
        event = {"source": "plugin", "session_uuid": self.session, "ts_utc_us": self._now(),
                 "kind": "session_start", "payload": {"text": label}}
        self._send(event)
        self._tee(event)

    def session_end(self, reason="manual"):
        event = {"source": "plugin", "session_uuid": self.session, "ts_utc_us": self._now(),
                 "kind": "session_end", "payload": {"text": reason}}
        self._send(event)
        self._tee(event)

    def close(self):
        self.sock.close()
