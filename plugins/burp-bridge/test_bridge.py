from bridge import poll_once, run


class FakeWatcher:
    def __init__(self): self.events = []
    def http_request(self, **kw): self.events.append(("req", kw["pair_id"]))
    def http_response(self, **kw): self.events.append(("resp", kw["pair_id"]))
    def session_start(self, *a, **kw): self.events.append(("start",))
    def session_end(self, *a, **kw): self.events.append(("end",))
    def close(self): self.events.append(("close",))


class AlwaysFailsClient:
    """Fake Burp client whose poll always raises — a stand-in for a dead daemon socket / an ended
    session, both of which manifest as repeated poll failures rather than a one-off blip."""
    def __init__(self): self.calls = 0
    def history_since(self, cursor):
        self.calls += 1
        raise ConnectionError("dead socket")


def test_dedups_and_scopes():
    history = [
        {"pair_id": "p1", "host": "target", "method": "GET", "url": "http://target/a",
         "req_headers": "", "req_body": "", "status": 200, "resp_headers": "", "resp_body": "ok", "mime": "text/html"},
        {"pair_id": "p1", "host": "target", "method": "GET", "url": "http://target/a",
         "req_headers": "", "req_body": "", "status": 200, "resp_headers": "", "resp_body": "ok", "mime": "text/html"},
        {"pair_id": "p2", "host": "other", "method": "GET", "url": "http://other/x",
         "req_headers": "", "req_body": "", "status": 200, "resp_headers": "", "resp_body": "", "mime": ""},
    ]
    w = FakeWatcher(); seen = set()
    poll_once(history, w, scope={"target"}, seen=seen)
    pairs = {p for _, p in w.events}
    assert pairs == {"p1"}          # p1 emitted once (dedup), p2 out of scope
    assert ("req", "p1") in w.events and ("resp", "p1") in w.events


def test_run_exits_after_consecutive_failure_threshold():
    client = AlwaysFailsClient()
    watcher = FakeWatcher()
    run(client, watcher, scope=set(), interval=0, max_consecutive_failures=3)
    # stopped after exactly the threshold, not hung forever
    assert client.calls == 3
    # finally ran cleanup — no orphaned process
    assert ("end",) in watcher.events
    assert ("close",) in watcher.events


if __name__ == "__main__":
    tests = [test_dedups_and_scopes, test_run_exits_after_consecutive_failure_threshold]
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
