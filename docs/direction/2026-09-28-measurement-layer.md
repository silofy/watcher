# The Watcher, beyond offensive — the measurement layer

**Date:** 2026-09-28 · **Status:** direction note, for reaction
**Origin:** user-testing feedback — skepticism about the "no eBPF/ptrace/kernel hooks" stance, plus a request to capture what AI harnesses (Claude Code / Codex) actually did.

## Thesis in one line

The Watcher's product is not *offensive capture*. It is an engine that **grades and coaches a technical performance against a rubric and the optimal line.** That engine is domain-agnostic — so the growth path is more *sources* and more *domains*, not more kernel.

## The architectural key: pluggable capture adapters

The pipeline's ingest boundary is `RawCommand[]` (`src/lib/pipeline/types.ts`): `cmd`, `started_at_ms`, `ended_at_ms`, `exit_code`, `output_digest`, `output_line_count`, `context_path`, optional `web`. **Everything downstream** — episodes, phases, ATT&CK · UKC · CWE tagging, the grade, the Ghost, the report — is derived from that shape.

So every new source is just an adapter that emits `RawCommand[]`. It never has to know about scoring.

| Adapter | Status | Notes |
|---|---|---|
| Userspace PTY (shell hooks) | shipping | zero-priv, portable — the wedge |
| AI-agent harness (Claude Code) | **spiked ✓** | 1,087 `RawCommand` from one real session; think-time falls out for free |
| HTTP proxy (Burp/mitm) | candidate | `web` exchange shape already exists |
| EDR / Sysmon export | candidate | ingest someone else's kernel telemetry; grade the human's response |

**Spike proof (Claude Code):** `tool_use(Bash).input.command → cmd`; its `timestamp → started_at_ms`; paired `tool_result` (by `tool_use_id`) `timestamp → ended_at_ms`; `is_error → exit_code` (approx); redacted+truncated result content → `output_digest`. Wall-clock spans include model think-time — a feature, it *is* the agent's reasoning gap. Effort to production: ~a day. Gaps: approximate exit codes; non-Bash tools (Read/Edit/MCP) need a map-or-drop rule; WebFetch → `web`.

## Why "not an EDR" is the point, not a gap

- **EDR / syscall tracers** answer *"what did this process do to the system?"* — defense, forensics, detection. Kernel-priv, heavy, noisy for our question.
- **The Watcher** answers *"how good was my run, and how do I improve?"* — the decisions live in the session, not the syscalls. An EDR would bury methodology under telemetry.

Zero-privilege, install-in-seconds, safe on any lab box is the moat for the *learner/operator* buyer. Don't trade it away.

## Two moves that look alike and aren't

- **Move A — own the telemetry layer** (build/ship a kernel/syscall collector so we *produce* EDR-grade data). **Resist as core.** That is CrowdStrike / SentinelOne / Defender territory: signed drivers per-OS, detection content, SOC integrations, compliance — company-sized, and it kills the wedge. Only ever an *opt-in deep-collector plugin* for power users.
- **Move B — own the measurement layer for defense too.** **Recommended.** Same grading engine, new domains:
  - Blue-team / DFIR practice (HTB Sherlocks, IR drills) — grade the investigation; "you vs. the optimal investigation line."
  - Detection engineering — did the hunts cover the techniques the scenario exercised?
  - Purple team — score both sides on one timeline.
  - SOC onboarding / continuous skill measurement — a manager has no way today to prove analysts are improving; that's a training budget EDR doesn't own.

**How B answers the EDR question directly:** don't compete with the EDR — *consume* its output as one more adapter and grade the analyst's response. Sit on top of the EDR, not beside it.

## Positioning

> The Watcher is the deliberate-practice and performance-grading layer for security work — offense today, defense/DFIR next — with every telemetry source (PTY · AI harness · EDR/Sysmon · HTTP proxy) as a pluggable adapter into one grading engine.

You don't hook the kernel. You hook the harness.

## Next steps

1. Finish the Claude Code adapter (`transcript → RawCommand[]`), behind a `watcher ingest --claude-code <session.jsonl>` surface; reuse `redact.ts` for output digests.
2. Reframe site/README copy so "no kernel hooks" reads as frictionless-by-design.
3. Spike a second adapter to validate the pattern breadth — HTTP proxy (offense) or a Sysmon export (defense).
4. Decide the defense wedge (DFIR practice vs. SOC training) before building domain rubrics.
