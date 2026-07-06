# Design Spec — Web Capture (Phase 1: Burp via MCP)

**Date:** 2026-07-05
**Status:** Approved for implementation
**Depends on:** existing daemon source-plugin model (`crates/daemon`, `plugins/sdk`), the deterministic MITRE pipeline (`src/lib/pipeline/mitre.ts`), and the redaction core (`crates/core/src/redact.rs`).

---

## 0. Working rules

Same house rules as prior sub-projects:

1. **TDD** — failing test first.
2. **Green gate** — `npm test`, `npm run typecheck`, `npm run build`, `cargo test`, and the schema round-trip all pass before a Work Package is done.
3. **Additive & backward-compatible** — the telemetry envelope and report schema gain optional fields only; every existing report and capture path loads and behaves exactly as before.
4. **Determinism is sacred** — web→technique/CWE classification is a pure function of the exchange; re-running yields identical output. Models never move a number.
5. **Redaction before persistence** — HTTP is the most sensitive data class the tool touches; the daemon re-redacts unconditionally on receipt and never trusts the bridge's scrubbing.
6. **Strictly additive to the run** — if web capture is off or unavailable, terminal capture is byte-for-byte unchanged. Web capture can never degrade or block the core recording.
7. **No scope creep** — the transparent/inline proxy and export-file import are separate, later specs (§10). This spec is Burp-over-MCP only.

---

## 1. Thesis

Watcher today sees only the terminal. Any operator whose work is partly in a browser — hitting a login form, tampering a parameter, probing an upload — is under-credited, and the debrief silently omits that half of the run. This phase makes **HTTP exchanges first-class attack events on the same timeline as terminal commands**, graded against MITRE ATT&CK, the Unified Kill Chain, and — newly load-bearing here — **CWE**, so a SQLi attempt and an XXE count as two distinct skills, exactly as the brief always intended.

The feature splits into two layers:

- **Ingestion layer** — how HTTP exchanges get into the daemon. This phase: a Burp-MCP **bridge plugin**. Later phases (§10) add a transparent proxy and export-file import as additional sources.
- **Web-analysis layer** — the pure, deterministic logic that turns an exchange into a `(tactic, technique, cwe, confidence)` prior. **Shared by all ingestion paths**, so §10's sources plug in with zero rework here.

---

## 2. Goals / non-goals

**Goals**

- Ingest Burp proxy history into the active session, near-live, via Burp's MCP server.
- Grade HTTP exchanges into the existing coverage / grade / kill-chain / findings surfaces, adding a CWE dimension.
- Off by default; one flag to enable; zero required configuration on the happy path.
- Web-aware redaction that provably keeps secrets out of the store.
- A UX that adds no new surface, mode, or vocabulary.

**Non-goals (this phase)**

- No transparent/inline proxy (Watcher does not sit in the traffic path). Burp still does the intercept; Watcher reads.
- No Caido/ZAP sources yet (the analysis layer is built to accept them; the bridge is Burp-specific).
- No export-file import.
- No change to the terminal capture path, the grade rubric weights, or existing report rendering beyond the timeline learning to render an HTTP row.

---

## 3. Architecture & data flow

```
Burp Suite ──(proxy history)──▶ Burp MCP server
                                     │  MCP client (poll)
                          watcher-burp-bridge   (Python plugin + MCP client)
                                     │  §3.3 envelopes over TCP 127.0.0.1:8799
                              watcher-daemon ──re-redact──▶ SQLCipher store
                                     │
                          TS web-analysis layer ──▶ report (timeline, coverage, grade, Live Ops)
```

**Chosen approach: a Python bridge plugin (Approach A).** The daemon already accepts any process that connects to `127.0.0.1:8799`, sends a capability handshake, and streams §3.3 envelopes (`plugins/sdk/watcher_sdk.py`, `crates/daemon/src/lib.rs`). The bridge fits this model exactly: no new networking in the Rust daemon, and it reuses the handshake, re-redaction, and session ownership already built. Rejected: a Rust-native MCP client in the daemon (heavy MCP client in Rust; couples the source-agnostic daemon to Burp) and a standalone TS/Node service (outside the established Python plugin model; second runtime).

The bridge polls Burp's proxy history every ~2s, tracks a monotonic cursor and dedups on `pair_id` so each exchange is emitted once, converts each into a request/response envelope pair, and streams them into the current session. Everything downstream is unchanged plumbing — the daemon does not know these events describe HTTP.

---

## 4. Telemetry envelope extension

`crates/capture/src/envelope.rs` (`TelemetryEvent` / `Payload`) and the store's `RawEvent`:

- **New `kind` values:** `http_request`, `http_response`.
- **New optional `Payload` fields** (all `skip_serializing_if = "Option::is_none"`, so existing events serialize identically): `method`, `url`, `status`, `req_headers`, `req_body`, `resp_headers`, `resp_body`, `mime`, `pair_id` (links a response to its request).
- **Provenance:** `source: "plugin"`, `context_path: "web:burp"`, `platform` from the run's `--platform`, `boundary_confidence: 1.0` (Burp gives exact request boundaries).
- **Schema bump:** report schema minor version; older reports load unchanged.

No existing field changes meaning. Terminal capture emits exactly the bytes it does today.

---

## 5. The Burp-MCP bridge plugin

`plugins/burp-bridge/` — a Python plugin built on `watcher_sdk.Watcher`, plus an MCP client (the `mcp` Python package) speaking to Burp's MCP server.

- **Handshake:** `class: "web-source"`, `boundary_confidence: "exact"`, `redaction: "none"` (relies on the daemon). `context_template: "web:burp"`.
- **Lifecycle:** `session_start` on connect → poll loop → `session_end` on shutdown. Joins the operator's *existing* session (the daemon merges sources), it does not open a competing one.
- **Poll loop:** query proxy history since cursor, filter to in-scope hosts (§7), emit `http_request` then `http_response` per exchange with a shared `pair_id`, advance cursor, dedup.
- **Scope:** adopts Burp's configured target scope by default. Empty scope → warn, do not silently ingest everything (§7).
- **Graceful degradation:** unreachable Burp/MCP → log, retry with backoff, never crash. The run's terminal capture is unaffected.
- **`requirements.txt`** pins the MCP client dep.

---

## 6. Web-analysis / grading layer (the novel, shared part)

`src/lib/pipeline/web.ts`, mirroring the shape of `mitre.ts`: an **ordered, deterministic lookup table**, first match wins, mapping an HTTP exchange to a `(tactic, technique, cwe, confidence)` prior from request/response *features* — not live secret values. Illustrative rules (final table decided during implementation, test-first):

| Signal in the exchange | Maps to |
|---|---|
| `'`/`UNION`/boolean-tamper in a param **and** SQL error / anomaly in response | `T1190` · **CWE-89** (SQLi) |
| Sequential/opaque ID param swapped, authorized-looking 200 | **CWE-639** (IDOR) |
| `../` / encoded traversal in a path/file param | **CWE-22** (path traversal) |
| Reflected script payload echoed unescaped in response | **CWE-79** (XSS) |
| Repeated POSTs to an auth endpoint, varied creds | `T1110` (brute force) |
| Content discovery patterns (dir/file fuzzing signatures) | `T1595.003` |

- **CWE dimension:** this is where CWE becomes real in the graded output — distinct weakness classes count as distinct skills.
- **Source-agnostic:** consumes exchanges regardless of origin (Burp now; proxy/export later), so §10 adds no logic here.
- **Determinism:** pure function of the stored exchange; identical input → identical prior. No model in the loop for the letter grade.

Web priors feed the *same* coverage, kill-chain trajectory, findings ledger, and grade inputs that command priors feed. Rubric weights are not re-tuned in this spec beyond admitting web-sourced technique/CWE hits.

---

## 7. Defaults & consent

Web capture ships **off**. Rationale: it has hard external dependencies (Burp + MCP server) that make on-by-default fail for most runs; HTTP is the most sensitive data class; and Burp's history is broader than the target.

- **Opt in per run** with `--web` (see §9); optional persisted config toggle for operators who always want it.
- **Scope-limited even when on:** ingest only Burp-in-scope hosts. Empty Burp scope → warn (`Burp scope is empty — Watcher will ingest all proxied traffic. Set a target scope in Burp to limit what's recorded.`), do not silently hoover the full history.
- **Detect-and-nudge, never auto-enable:** if Burp's MCP is reachable at session start, print one hint (`Burp MCP detected; add --web to record web traffic`). Nothing is captured until the operator opts in.

---

## 8. Redaction

HTTP leaks auth headers, session cookies, bearer tokens, API keys, and PII on nearly every request. The daemon already re-redacts every field on receipt and never trusts upstream scrubbing (`crates/daemon` → `watcher_core::redact`). Extend `redact.rs` with web-aware rules:

- Mask `Authorization`, `Cookie` / `Set-Cookie`, and `X-API-Key`-class headers.
- Mask token-shaped values in query strings and bodies.
- Preserve request **shape** — param names, payload patterns, structure — because that is exactly what grading (§6) needs; masking the live secret loses nothing analytically.

A dedicated test asserts known secrets in a fixture exchange never reach the store.

---

## 9. UX — binding simplicity constraint

The tool is already dense. **Binding rule: if using web capture requires the operator to learn a new concept, read a doc before their first run, or edit a config file, the UX has failed.** Web capture must feel like Watcher just got more observant, not like a subsystem to operate. Enforced by the "one" constraints:

- **One flag, zero required config:** bare `--web` on the existing capture command auto-detects Burp at the default endpoint and auto-adopts Burp's scope. Endpoint/port/scope overrides live only in a config file as a power-user escape hatch, never on the happy path.
- **One decision, surfaced for you:** the §7 detect-and-nudge is the real discovery mechanism; setup friction is carried by §11 preflight, one actionable step at a time.
- **One place it shows up:** web events fold into the existing timeline, coverage, grade, and Live Ops. No web tab, no web mode, no second mental model. (`AttackTimeline` learns to render an HTTP row; that is the only new UI.)
- **One status signal:** a small `web ●` indicator in Live Ops for quiet confidence it is recording. Not a panel, not a log to check.

---

## 10. User journey

Nothing about today's terminal flow changes. Web capture threads a second stream into the same recording.

1. **One-time setup:** operator runs Burp with the MCP Server extension enabled (§11 links the steps). In Watcher, they enable the source once.
2. **During the box:** terminal commands flow through PTY capture as always. Separately, when the operator drives the target's web app through Burp, the bridge pulls those exchanges every ~2s into the *same* session. `gobuster` and the login POST land on one ordered timeline. Live Ops reacts to web moves (findings tick up; a nudge can say "you found the login form but never tested it for auth bypass"). The operator does nothing different.
3. **The debrief:** the same lesson-first report, now including the web attacks. The timeline interleaves HTTP exchanges with commands; coverage and grade reflect web weaknesses mapped to CWE. A run that was 60% web work finally scores like it.

Mental model: Watcher stays the flight recorder; this wires a second black box (web traffic) into the same recording and teaches the debrief to grade it.

---

## 11. Setup, dependencies & preflight

Inform users at two layers, because docs alone are not read at the moment of need.

**Docs.** `docs/web-capture.md` + a README pointer near "Try it": install Burp → install the official **MCP Server** BApp → enable it, note the endpoint → ensure the bridge's Python deps are present → run with `--web`. **Link to PortSwigger's own MCP docs for the Burp-side steps** rather than duplicating them (the Burp MCP server is new and moving). State hard requirements plainly: a Burp version shipping the MCP server, and any Pro-vs-Community differences in exposed proxy history.

**Runtime preflight** (on `--web`, actionable failures, never a stack trace, never blocking the run):

- Burp unreachable → `Can't reach Burp's MCP server at 127.0.0.1:<port>. Is Burp running with the MCP Server extension enabled? Setup: docs/web-capture.md`
- Bridge deps missing → `burp-bridge needs Python 3.x and the mcp client. Install: pip install -r plugins/burp-bridge/requirements.txt`
- Reachable, empty scope → warning from §7 (not a failure).

---

## 12. Testing

Mirrors the existing pattern:

- **`web.test.ts`** — pure classification: fixture exchanges → expected `(tactic, technique, cwe, confidence)` priors (peer of `mitre.test.ts`).
- **Redaction test** (Rust) — known secrets in a fixture exchange never reach the store.
- **Bridge integration test** — against a mock MCP server / recorded Burp responses; no live Burp in CI.
- **Envelope/schema round-trip** — new fields serialize/deserialize; old reports still load.
- Green gate (§0.2) passes.

---

## 13. Explicitly deferred (own specs)

- **Transparent / invisible proxy** — Watcher inline between browser and Burp (upstream chaining). A new source emitting the same `http_request` / `http_response` envelopes.
- **Export-file import** — Burp/Caido/ZAP saved projects. Another source into the same envelopes.
- **Caido / ZAP MCP sources** — bridges analogous to Burp's, same envelopes.

All three feed §6 unchanged; this spec is what makes them additive rather than rework.

---

## 14. Work Packages (implementation order)

1. **WP1 — Envelope + schema:** add `http_request`/`http_response` kinds and web `Payload` fields; round-trip tests. (Rust + TS types.)
2. **WP2 — Web-aware redaction:** extend `redact.rs`; secret-never-persisted test. (Rust.)
3. **WP3 — Web-analysis layer:** `web.ts` + `web.test.ts`, wired into coverage/grade/findings. (TS.) *Independently valuable against fixture exchanges before any bridge exists.*
4. **WP4 — Bridge plugin:** `plugins/burp-bridge/` (SDK + MCP client), poll/cursor/dedup, scope filter, graceful degradation, mock-MCP integration test.
5. **WP5 — Enablement + UX:** `--web` flag, detect-and-nudge, preflight messages, `web ●` Live Ops indicator, `AttackTimeline` HTTP row.
6. **WP6 — Docs:** `docs/web-capture.md` + README pointer.
