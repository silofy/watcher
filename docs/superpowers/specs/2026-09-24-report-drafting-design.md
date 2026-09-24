# Pentest report drafting — design

**Status:** approved for planning
**Date:** 2026-09-24
**Author:** silofy (with Claude)
**Reference:** SysReptor (https://sysreptor.com/) — projects built from designs, a reusable
finding-template library, reports composed of sections. We borrow the *finding-template*
idea as a built-in offline library and the *section* structure; we do not build its editor,
project storage, or HTML→PDF designer.

## Problem

The Watcher captures everything a pentest report needs — the vulnerabilities exploited, the
exact commands that surfaced and used them, the path to root — but it only ever renders a
*coaching debrief*. Writing the actual engagement/exam report (OSCP, HTB CPTS) is still manual,
and it's the most-hated part of those exams. Because the tool already holds the evidence, it can
draft that report.

This feature turns a run into an **OSCP/CPTS-style report draft** in Markdown: findings with
severity, impact, evidence and remediation, a chronological walkthrough, and an appendix — built
deterministically from run data, with optional model polish on the prose.

## Goals

- One command turns a graded run into a portable, editable Markdown report draft.
- Findings are derived from what the run actually exploited, each with evidence and reproduction
  taken from the real command log — never invented.
- Works fully offline and deterministically; a configured coaching model only sharpens prose,
  never facts (same invariant as the rest of the app).
- Redaction-safe by default: evidence respects `redaction_profile`; credentials and flags appear
  only in their redacted/sentinel form.

## Non-goals

- No user-editable finding-template CRUD, no template storage/variables (SysReptor's editor) —
  the library is built-in and code-owned in v1; user templates are a later feature.
- No HTML/PDF rendering in v1. Markdown is the single output; a rendered/print path can follow.
- No CVSS calculator. Severity is library-provided or a marked placeholder — never a guessed score.
- No in-app UI in v1. A script is the surface; `draftReport` is pure so a "Draft report" button
  is a small later follow-up.
- No new report schema fields, no change to the grade/metrics. Drafting is read-only over an
  existing `WatcherReport`.

## Design overview

### Data source: what the draft reads

Everything comes from an assembled `WatcherReport` (read-only):
- `session` — target, platform, difficulty, `started_at`/`ended_at`, `target_scope` (scope, header, dates).
- `episodes` — `cmd`, `binary`, `output_digest`, `tactic`, `technique`, `seq` (evidence, reproduction, walkthrough, appendix log).
- `findings` — the ledger (`vuln`/`cred`/`port`/`service`/`flag`/…) (CVE findings → report findings; ports/services/creds → appendix table).
- `phases` — `label`, per-phase timing (methodology + walkthrough grouping).
- `analyzePrivesc(report)` — `PrivescResult { paths: PrivescPath[], confirmed, likely, first_confirmed_seq, rooted_seq }`; each `PrivescPath { vector, severity, title, detail, abuse, ref?, evidence_seq }` (the richest finding source).
- `metrics` — used only for the summary line (findings/severity counts, time-to-root); never rewritten.

### Module layout (`src/lib/report/`)

Each file has one responsibility and a well-defined interface:

- **`library.ts`** — the built-in finding-template library. A keyed table of report-field
  templates (public NVD/CWE/GTFOBins facts re-expressed, like the privesc rulebook). Exports:
  - `type FindingTemplate = { title: string; severity: Severity; cwe?: string; description: string; impact: string; remediation: string; references: string[] }`
  - `matchTemplate(key: { cve?: string; cwe?: string; vector?: PrivescVector }): FindingTemplate | null`
  Seeded with the weaknesses the shipped demos exhibit (print-injection RCE / CVE-2026-4480,
  password reuse, Samba wide-links, writable systemd unit, SUID/sudo GTFOBins) plus a handful of
  common ones; grows like the rulebook.
- **`findings.ts`** — `deriveReportFindings(report): ReportFinding[]`. Turns run weaknesses into
  structured findings from three sources, de-duplicated, severity-ordered.
- **`sections.ts`** — pure section builders returning Markdown strings: `headerSection`,
  `execSummarySection`, `scopeSection`, `methodologySection`, `findingsSection`,
  `walkthroughSection`, `appendixSection`.
- **`draft.ts`** — `draftReport(report, opts?): string`. Orchestrates the sections into one
  Markdown document. Pure, no I/O.
- **`narrate.ts`** — `narrateReport(draftFields, provider): Promise<...>`. Optional model polish
  of prose fields only; mirrors `src/lib/ghost/narrate.ts`. Off unless a provider is passed.

Surface: **`scripts/export-report.tsx`** (vite-node), mirroring `scripts/export-html.tsx`: reads a
fixture or `--report <path>`, calls `draftReport`, writes `report.md`.

### `ReportFinding` shape

```ts
type Severity = "critical" | "high" | "medium" | "low" | "info" | "unset";
interface Evidence { seq: number; cmd: string; output: string; } // output already redacted
interface ReportFinding {
  id: string;               // stable, e.g. "cve-2026-4480" | "vector-systemd" | "cwe-78"
  title: string;
  severity: Severity;
  cwe?: string;
  cve?: string;
  affected: string;         // target name / host / service
  description: string;      // library or minimal fallback
  impact: string;
  remediation: string;
  references: string[];
  evidence: Evidence[];     // from the real episodes (redacted output)
  reproduction: string[];   // ordered commands for the finding's phase/objective
}
```

### Finding derivation (`deriveReportFindings`)

Three sources, merged and de-duplicated by `id`:

1. **CVE findings** — each `finding.kind === "vuln"` (value like `CVE-2026-4480`) → a `ReportFinding`,
   fields from `matchTemplate({ cve })`; evidence from its `source_seq` episode.
2. **Privesc paths** — each `confirmed`/`likely` `PrivescPath` → a `ReportFinding`. The path supplies
   `title`/`detail`(→description)/`abuse`(→a reproduction hint)/`ref`; `matchTemplate({ vector, cwe })`
   supplies `impact`/`remediation`/`references`/default severity (falling back to the path's own
   `severity`); evidence from `evidence_seq`.
3. **CWE-tagged weaknesses** — CWEs from `episode.frameworks.cwe` (when present) or `BINARY_TO_CWE`
   for the binaries used → `matchTemplate({ cwe })`; evidence from those episodes.

**Fallback:** a weakness with no library match still emits a finding — title from the CVE id or
`techniqueName`/vector, a generic remediation line, and `severity: "unset"` (rendered as
`— set severity`). Nothing is silently dropped.

**De-dup:** same `id` collapses; when two sources describe the same weakness (a CVE that is also a
privesc vector), the richer record wins and evidence lists are merged.

**Order:** by severity (critical→info; `unset` last), then by earliest `evidence_seq`.

**Evidence & reproduction:** `evidence[].output` is the episode's `output_digest` — already redacted
upstream; the drafter never un-redacts. `reproduction` is the ordered `cmd`s of the episodes in the
finding's phase (or, for a privesc path, the commands from foothold to that path's evidence seq),
as a fenced code block.

### Report structure (Markdown sections, in order)

1. **Header** — `# <target> — <platform> <difficulty>`, engagement window (`started_at`→`ended_at`),
   rooted status. A one-line note: "Evidence is redacted per the run's redaction profile
   (`<profile>`); credentials and flags are masked."
2. **Executive summary** — templated: N findings by severity, whether the target was rooted, and
   time-to-root. Model-polishable.
3. **Scope** — target(s), platform, `target_scope`, context path, dates.
4. **Methodology** — a short templated narrative over the phases actually present (from `phases`),
   naming the three frameworks (ATT&CK / Unified Kill Chain / CWE).
5. **Findings** — `## Findings`, then one `### <n>. <title>` per finding in severity order, each with
   **Severity**, **CWE/CVE**, **Affected**, **Description**, **Impact**, **Evidence** (fenced
   command + output), **Steps to reproduce** (fenced command list), **Remediation**, **References**.
6. **Attack walkthrough** — `## Walkthrough`, the chronological commands grouped by phase label —
   the "how the target was compromised" narrative.
7. **Appendix** — full command log (table: seq · time · command), a findings-ledger table
   (ports/services/creds, redacted), and the tool loadout (binary → count).

### Optional model polish (`narrate.ts`)

Off by default. When a provider is passed, it rewrites only: the executive summary, and each
finding's `description` and `impact`. Input is the structured fields already in the draft (title,
severity, cwe/cve, affected, the deterministic description/impact) — nothing new, nothing
un-redacted. On any provider error it returns the deterministic text unchanged. Same opt-in,
fail-safe contract as `ghost/narrate.ts`.

### Surfacing (v1)

`scripts/export-report.tsx`: `vite-node scripts/export-report.tsx [--report <path>] [--out <path>]`.
Defaults to the demo fixture and `dist/report.md`. Prints the output path and a one-line hint
(paste into your OSCP/CPTS template, or run through any Markdown→PDF tool). README gets a short
"Draft a report" subsection.

## Testing (TDD)

- **`library.ts`** — a known CVE/CWE/vector key returns its template; an unknown key returns null.
- **`findings.ts`** — the Abducted fixture yields the expected findings (print-injection RCE via
  CVE-2026-4480, password reuse, Samba wide-links, writable systemd → root), de-duplicated and
  severity-ordered; each carries evidence + reproduction drawn from real episodes; a weakness with
  no library match produces a fallback finding with `severity: "unset"`.
- **`sections.ts` / `draft.ts`** — the Markdown contains every required top-level heading; the
  findings section has one entry per derived finding; the walkthrough is phase-grouped; the appendix
  tables render. **Redaction assertion:** the draft contains no unredacted credential or flag — it
  contains the masked/sentinel forms, never a raw secret (structural asserts, not brittle full-text
  snapshots).
- **`narrate.ts`** — with no provider, `draftReport` output is byte-identical with and without the
  narrate step (deterministic passthrough); with a stub provider, only the prose fields change.
- **`export-report.tsx`** — smoke: running it on the demo fixture writes a non-empty `report.md`
  containing the header and a Findings section.

## Global constraints

- Deterministic core; a model only sharpens prose, never facts. Read-only over `WatcherReport`;
  never touches the grade, metrics, or schema.
- Redaction-safe: evidence uses already-redacted `output_digest`; no un-redaction anywhere.
- No new dependencies. No copied GPL/unlicensed source — library facts are public (NVD / CWE /
  GTFOBins), re-expressed like the privesc rulebook.
- Markdown is the only v1 output. TypeScript strict; Vitest.
