"""Plain-python tests for watcher_sdk.py's optional NDJSON tee (no pytest — not installed).

Monkeypatches socket.create_connection so Watcher() constructs without a real daemon, then
asserts the tee file behavior: every §3.3 envelope sent via `_event` (and the `_send`-direct
session lifecycle events) lands as a JSON line in the sink file, but the capability handshake
(sent via `_send` in `__init__`, before any tee wiring) never does.
"""
import json
import os
import socket
import tempfile

import watcher_sdk
from watcher_sdk import Watcher


class FakeSocket:
    def __init__(self):
        self.sent = []

    def sendall(self, data):
        self.sent.append(data)

    def close(self):
        pass


def _patch_socket(monkeypatch_target=None):
    """Swap socket.create_connection for a fake that returns FakeSocket(), returning the fake
    so callers can inspect what was sent over the wire (unaffected by the tee)."""
    fake = FakeSocket()

    def fake_create_connection(*args, **kwargs):
        return fake

    watcher_sdk.socket.create_connection = fake_create_connection
    return fake


def _read_lines(path):
    with open(path, "r", encoding="utf-8") as f:
        return [line for line in f.read().split("\n") if line]


def test_tee_writes_events_not_handshake():
    original = watcher_sdk.socket.create_connection
    fd, path = tempfile.mkstemp(prefix="watcher-sdk-tee-", suffix=".ndjson")
    os.close(fd)
    os.remove(path)  # start absent — tee append-mode must create it
    try:
        _patch_socket()
        w = Watcher("t", ndjson_path=path)
        w.http_request(pair_id="p1", method="GET", url="http://t/a")

        assert os.path.exists(path), "tee file should exist after the first teed event"
        lines = _read_lines(path)
        assert len(lines) == 1, f"expected exactly one teed line, got {len(lines)}"
        obj = json.loads(lines[0])
        assert obj["kind"] == "http_request"
        assert obj["payload"]["pair_id"] == "p1"

        raw = "\n".join(lines)
        assert "watcher_handshake" not in raw, "the capability handshake must never be teed"
    finally:
        watcher_sdk.socket.create_connection = original
        if os.path.exists(path):
            os.remove(path)


def test_tee_covers_session_lifecycle():
    original = watcher_sdk.socket.create_connection
    fd, path = tempfile.mkstemp(prefix="watcher-sdk-tee-", suffix=".ndjson")
    os.close(fd)
    os.remove(path)
    try:
        _patch_socket()
        w = Watcher("t", ndjson_path=path)
        w.session_start("test session")
        w.command("whoami")
        w.session_end("manual")

        lines = _read_lines(path)
        kinds = [json.loads(line)["kind"] for line in lines]
        assert kinds == ["session_start", "command", "session_end"]
    finally:
        watcher_sdk.socket.create_connection = original
        if os.path.exists(path):
            os.remove(path)


def test_no_ndjson_path_means_no_file_and_unchanged_behavior():
    """Additive/backward-compatible: omitting ndjson_path must not create any file or otherwise
    change socket-only behavior."""
    original = watcher_sdk.socket.create_connection
    fake = _patch_socket()
    try:
        w = Watcher("t")
        w.http_request(pair_id="p1", method="GET", url="http://t/a")
        assert w.ndjson_path is None
        assert len(fake.sent) == 2  # handshake + http_request, socket only
    finally:
        watcher_sdk.socket.create_connection = original


if __name__ == "__main__":
    tests = [
        test_tee_writes_events_not_handshake,
        test_tee_covers_session_lifecycle,
        test_no_ndjson_path_means_no_file_and_unchanged_behavior,
    ]
    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS: {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"FAIL: {t.__name__}: {e!r}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    if failed:
        raise SystemExit(1)
