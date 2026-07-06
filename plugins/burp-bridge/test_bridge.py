from bridge import poll_once


class FakeWatcher:
    def __init__(self): self.events = []
    def http_request(self, **kw): self.events.append(("req", kw["pair_id"]))
    def http_response(self, **kw): self.events.append(("resp", kw["pair_id"]))


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


if __name__ == "__main__":
    tests = [test_dedups_and_scopes]
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
