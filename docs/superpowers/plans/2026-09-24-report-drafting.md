# Pentest report drafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a graded `WatcherReport` into an OSCP/CPTS-style Markdown pentest-report draft, built deterministically from the run's own evidence.

**Architecture:** A new pure `src/lib/report/` module — a built-in finding-template library, a weakness→finding deriver, Markdown section builders, and an orchestrator — plus an optional model-polish layer and a `scripts/export-report.tsx` surface. Read-only over `WatcherReport`; never touches the grade, metrics, or schema.

**Tech Stack:** TypeScript (strict), Vitest, vite-node (for the script). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-report-drafting-design.md`

## Global Constraints

- Deterministic core; a configured model only sharpens prose, never facts. Drafting is **read-only** over `WatcherReport` — no change to grade, metrics, or schema.
- Redaction-safe: evidence uses each episode's already-redacted `output_digest`; the drafter never un-redacts. Credentials/flags appear only masked/sentinel.
- Findings come only from three sources: `vuln` (CVE) findings, `analyzePrivesc` paths (`confirmed`/`likely`), and CWE tags (`episode.frameworks.cwe` or `BINARY_TO_CWE`). A source-surfaced weakness with no library match still emits a fallback finding (`severity: "unset"`) — nothing is silently dropped.
- Markdown is the only v1 output. No HTML/PDF, no in-app UI, no user-editable templates, no CVSS math.
- No new dependencies. No copied GPL/unlicensed source — library facts are public (NVD/CWE/GTFOBins), re-expressed like the privesc rulebook.
- Run tests with `npx vitest run <path>` from repo root `C:\Users\Tiago Peter\Claude\Projects\Watcher`; typecheck with `npx tsc -b --noEmit`.
- `Severity` type and its ordering are owned by `library.ts` and imported everywhere else — never redefined.

---

### Task 1: Finding-template library

**Files:**
- Create: `src/lib/report/library.ts`
- Test: `src/lib/report/library.test.ts`

**Interfaces:**
- Consumes: `PrivescVector` (type) from `../analysis/privesc`.
- Produces:
  - `export type Severity = "critical" | "high" | "medium" | "low" | "info" | "unset"`
  - `export const SEV_RANK: Record<Severity, number>`
  - `export interface FindingTemplate { title: string; severity: Severity; cwe?: string; description: string; impact: string; remediation: string; references: string[] }`
  - `export function matchTemplate(key: { cve?: string; cwe?: string; vector?: PrivescVector }): FindingTemplate | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/report/library.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { matchTemplate, SEV_RANK } from "./library";

describe("matchTemplate", () => {
  it("matches a seeded CVE", () => {
    const t = matchTemplate({ cve: "CVE-2026-4480" });
    expect(t?.severity).toBe("critical");
    expect(t?.title).toMatch(/print/i);
    expect(t?.remediation.length).toBeGreaterThan(0);
  });

  it("matches a privesc vector", () => {
    const t = matchTemplate({ vector: "systemd" });
    expect(t).not.toBeNull();
    expect(t?.cwe).toMatch(/^CWE-/);
  });

  it("matches a CWE", () => {
    expect(matchTemplate({ cwe: "CWE-78" })?.severity).toBe("critical");
  });

  it("prefers cve over vector over cwe, and returns null for unknowns", () => {
    expect(matchTemplate({ cve: "CVE-0000-0000" })).toBeNull();
    expect(matchTemplate({ vector: "nfs", cwe: "CWE-78" })?.cwe).not.toBe("CWE-78"); // vector wins
    expect(matchTemplate({})).toBeNull();
  });

  it("SEV_RANK orders critical highest, unset last", () => {
    expect(SEV_RANK.critical).toBeLessThan(SEV_RANK.high);
    expect(SEV_RANK.unset).toBeGreaterThan(SEV_RANK.info);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/report/library.test.ts`
Expected: FAIL — `./library` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/report/library.ts`:

```ts
import type { PrivescVector } from "../analysis/privesc";

/** Report severity (distinct from privesc confidence tiers). */
export type Severity = "critical" | "high" | "medium" | "low" | "info" | "unset";

/** Sort rank — critical first, unset last. */
export const SEV_RANK: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4, unset: 5,
};

export interface FindingTemplate {
  title: string;
  severity: Severity;
  cwe?: string;
  description: string;
  impact: string;
  remediation: string;
  references: string[];
}

const GTFO = "https://gtfobins.github.io/";
const cwe = (id: string) => `https://cwe.mitre.org/data/definitions/${id.replace("CWE-", "")}.html`;

// Keyed built-in library. Public NVD/CWE/GTFOBins facts, re-expressed. Extend like the privesc rulebook.
const BY_CVE: Record<string, FindingTemplate> = {
  "CVE-2026-4480": {
    title: "Samba print-job command injection (CVE-2026-4480)",
    severity: "critical",
    cwe: "CWE-78",
    description: "The Samba print path forwards the print-job description through the shell without escaping, so a crafted job name is executed as a command on the server.",
    impact: "Unauthenticated remote command execution as the Samba service account — an initial foothold on the host.",
    remediation: "Patch Samba to a fixed release; disable the print$ / spooler services if unused; never pass untrusted job metadata to a shell.",
    references: ["https://nvd.nist.gov/vuln/detail/CVE-2026-4480"],
  },
};

const BY_VECTOR: Partial<Record<PrivescVector, FindingTemplate>> = {
  systemd: {
    title: "Writable systemd unit directory allows root escalation",
    severity: "critical", cwe: "CWE-732",
    description: "A systemd unit or drop-in directory is group/world-writable, so a low-privileged user can add an ExecStartPre/ExecStart that runs as root on the next (re)start.",
    impact: "Full root compromise of the host.",
    remediation: "Restrict systemd unit directories to root ownership and 0755 permissions; audit group membership that grants write access.",
    references: [cwe("CWE-732")],
  },
  writable: {
    title: "World-writable sensitive file",
    severity: "high", cwe: "CWE-732",
    description: "A security-sensitive file is writable by an unprivileged user.",
    impact: "Tampering that can lead to privilege escalation or persistence.",
    remediation: "Tighten file ownership and permissions to least privilege.",
    references: [cwe("CWE-732")],
  },
  suid: {
    title: "Exploitable SUID binary", severity: "high", cwe: "CWE-269",
    description: "A SUID-root binary can be abused (per GTFOBins) to run commands as root.",
    impact: "Local privilege escalation to root.",
    remediation: "Remove the SUID bit where not required; replace GTFOBins-listed binaries or restrict access.",
    references: [GTFO, cwe("CWE-269")],
  },
  sudo: {
    title: "Abusable sudo rule", severity: "high", cwe: "CWE-269",
    description: "A sudo rule permits running a binary that can spawn a shell or write arbitrary files as root (per GTFOBins).",
    impact: "Local privilege escalation to root.",
    remediation: "Scope sudo rules to specific safe commands; avoid NOPASSWD on shell-capable binaries.",
    references: [GTFO, cwe("CWE-269")],
  },
  sgid: {
    title: "Exploitable SGID binary", severity: "high", cwe: "CWE-269",
    description: "An SGID binary can be abused to run with an elevated group (per GTFOBins).",
    impact: "Privilege escalation via an elevated group.",
    remediation: "Remove the SGID bit where not required.",
    references: [GTFO, cwe("CWE-269")],
  },
  cap: {
    title: "Dangerous file capability", severity: "high", cwe: "CWE-269",
    description: "A binary carries a Linux capability (e.g. cap_setuid) that allows privilege escalation.",
    impact: "Local privilege escalation.",
    remediation: "Remove unnecessary file capabilities with setcap -r.",
    references: [GTFO, cwe("CWE-269")],
  },
  group: {
    title: "Dangerous group membership", severity: "medium", cwe: "CWE-269",
    description: "Membership in a privileged group (docker, lxd, disk, …) grants a path to root.",
    impact: "Local privilege escalation to root.",
    remediation: "Remove users from privileged groups they do not need.",
    references: [cwe("CWE-269")],
  },
  nfs: {
    title: "NFS no_root_squash misconfiguration", severity: "high", cwe: "CWE-732",
    description: "An NFS export with no_root_squash lets a client write root-owned SUID binaries.",
    impact: "Local privilege escalation to root.",
    remediation: "Enable root_squash on NFS exports.",
    references: [cwe("CWE-732")],
  },
  "ld-preload": {
    title: "LD_PRELOAD preserved across sudo", severity: "high", cwe: "CWE-426",
    description: "sudo preserves LD_PRELOAD, allowing a malicious shared object to run as root.",
    impact: "Local privilege escalation to root.",
    remediation: "Remove env_keep+=LD_PRELOAD from sudoers.",
    references: [cwe("CWE-426")],
  },
  "kernel-cve": {
    title: "Kernel vulnerable to a known privilege-escalation CVE", severity: "critical", cwe: "CWE-269",
    description: "The kernel version matches a published local-privilege-escalation CVE.",
    impact: "Local privilege escalation to root.",
    remediation: "Patch the kernel to a fixed release.",
    references: ["https://nvd.nist.gov/"],
  },
  "sudo-cve": {
    title: "sudo vulnerable to a known CVE", severity: "critical", cwe: "CWE-269",
    description: "The sudo version matches a published privilege-escalation CVE (e.g. Baron Samedit).",
    impact: "Local privilege escalation to root.",
    remediation: "Update sudo to a fixed release.",
    references: ["https://nvd.nist.gov/"],
  },
};

const BY_CWE: Record<string, FindingTemplate> = {
  "CWE-78": {
    title: "OS command injection", severity: "critical", cwe: "CWE-78",
    description: "User-controlled input reaches a shell/command interpreter without sanitisation.",
    impact: "Remote command execution on the host.",
    remediation: "Use parameterised APIs; validate and escape all input that reaches a shell.",
    references: [cwe("CWE-78")],
  },
  "CWE-89": {
    title: "SQL injection", severity: "high", cwe: "CWE-89",
    description: "User input is concatenated into a SQL query.",
    impact: "Database read/write, authentication bypass, sometimes RCE.",
    remediation: "Use parameterised queries / prepared statements.",
    references: [cwe("CWE-89")],
  },
  "CWE-522": {
    title: "Insufficiently protected credentials", severity: "medium", cwe: "CWE-522",
    description: "Credentials are stored or transmitted in a recoverable form.",
    impact: "Credential theft enabling lateral movement or escalation.",
    remediation: "Store secrets in a vault; never reuse credentials across accounts/services.",
    references: [cwe("CWE-522")],
  },
};

/** First match wins in priority order: exact CVE, then privesc vector, then CWE. */
export function matchTemplate(key: { cve?: string; cwe?: string; vector?: PrivescVector }): FindingTemplate | null {
  if (key.cve && BY_CVE[key.cve]) return BY_CVE[key.cve];
  if (key.vector && BY_VECTOR[key.vector]) return BY_VECTOR[key.vector]!;
  if (key.cwe && BY_CWE[key.cwe]) return BY_CWE[key.cwe];
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/report/library.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b --noEmit` (expect clean), then:

```bash
git add src/lib/report/library.ts src/lib/report/library.test.ts
git commit -m "feat(report): built-in finding-template library"
```

---

### Task 2: Weakness → report-finding deriver

**Files:**
- Create: `src/lib/report/findings.ts`
- Test: `src/lib/report/findings.test.ts`

**Interfaces:**
- Consumes: `WatcherReport`, `Episode` from `../../types/report`; `analyzePrivesc` + `PrivescPath`, `PrivescSeverity` from `../analysis/privesc`; `matchTemplate`, `Severity`, `SEV_RANK` from `./library`; `BINARY_TO_CWE` from `../pipeline/frameworks`.
- Produces:
  - `export interface Evidence { seq: number; cmd: string; output: string }`
  - `export interface ReportFinding { id: string; title: string; severity: Severity; cwe?: string; cve?: string; affected: string; description: string; impact: string; remediation: string; references: string[]; evidence: Evidence[]; reproduction: string[] }`
  - `export function deriveReportFindings(report: WatcherReport): ReportFinding[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/report/findings.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveReportFindings } from "./findings";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";

const report = demo as unknown as WatcherReport;

describe("deriveReportFindings (Abducted fixture)", () => {
  const findings = deriveReportFindings(report);

  it("derives exactly the two source-backed findings", () => {
    const ids = findings.map((f) => f.id).sort();
    expect(ids).toEqual(["cve-cve-2026-4480", "vector-systemd"]);
  });

  it("orders by severity (both critical here) then evidence seq", () => {
    expect(findings[0].severity).toBe("critical");
    expect(findings.every((f) => f.severity !== "unset")).toBe(true);
  });

  it("attaches evidence and reproduction from real episodes", () => {
    const priv = findings.find((f) => f.id === "vector-systemd")!;
    expect(priv.evidence[0].seq).toBe(24);
    expect(priv.evidence[0].cmd).toContain("smbd.service.d");
    expect(priv.reproduction.length).toBeGreaterThan(0);
    expect(priv.cwe).toBe("CWE-732");
  });

  it("uses the target name as affected", () => {
    expect(findings[0].affected).toBe("Abducted");
  });
});

describe("deriveReportFindings fallback", () => {
  it("emits an unset-severity finding for a source weakness the library doesn't know", () => {
    const r = {
      session: { target: { name: "Box" }, target_scope: "HTB :: Box" },
      episodes: [{ seq: 1, cmd: "searchsploit foo", binary: "searchsploit", tactic: "TA0001", output_digest: "CVE-1999-9999 found", duration_ms: 0, gap_before_ms: 0, actor: "human_active" }],
      findings: [{ id: "vuln:CVE-1999-9999", kind: "vuln", value: "CVE-1999-9999", source_seq: 1, used_by_seq: [] }],
      phases: [], metrics: {}, golden_dag: [],
    } as unknown as WatcherReport;
    const f = deriveReportFindings(r);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe("unset");
    expect(f[0].cve).toBe("CVE-1999-9999");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/report/findings.test.ts`
Expected: FAIL — `./findings` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/report/findings.ts`:

```ts
import type { WatcherReport, Episode } from "../../types/report";
import { analyzePrivesc, type PrivescPath, type PrivescSeverity } from "../analysis/privesc";
import { matchTemplate, SEV_RANK, type Severity } from "./library";
import { BINARY_TO_CWE } from "../pipeline/frameworks";

export interface Evidence { seq: number; cmd: string; output: string; }
export interface ReportFinding {
  id: string;
  title: string;
  severity: Severity;
  cwe?: string;
  cve?: string;
  affected: string;
  description: string;
  impact: string;
  remediation: string;
  references: string[];
  evidence: Evidence[];
  reproduction: string[];
}

/** Privesc confidence tier → a conservative report severity, when the library has no override. */
function confidenceToSeverity(c: PrivescSeverity): Severity {
  return c === "confirmed" ? "high" : c === "likely" ? "medium" : "info";
}

export function deriveReportFindings(report: WatcherReport): ReportFinding[] {
  const episodes = report.episodes ?? [];
  const bySeq = new Map<number, Episode>(episodes.map((e) => [e.seq, e]));
  const affected = report.session?.target?.name ?? report.session?.target_scope ?? "the target";

  const evidenceOf = (seq: number): Evidence => {
    const e = bySeq.get(seq);
    return { seq, cmd: e?.cmd ?? "", output: e?.output_digest ?? "" };
  };
  // Reproduction: the commands of the same phase (tactic) up to and including the evidence step.
  const reproductionFor = (seq: number): string[] => {
    const anchor = bySeq.get(seq);
    if (!anchor) return [];
    return episodes
      .filter((e) => e.tactic === anchor.tactic && e.seq <= seq)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => e.cmd);
  };

  const byId = new Map<string, ReportFinding>();
  const add = (f: ReportFinding) => {
    const existing = byId.get(f.id);
    if (existing) { existing.evidence.push(...f.evidence); return; }
    byId.set(f.id, f);
  };

  // Source 1 — CVE findings.
  for (const vf of (report.findings ?? []).filter((f) => f.kind === "vuln")) {
    const tpl = matchTemplate({ cve: vf.value });
    add({
      id: `cve-${vf.value.toLowerCase()}`,
      title: tpl?.title ?? `${vf.value} (unverified)`,
      severity: tpl?.severity ?? "unset",
      cwe: tpl?.cwe,
      cve: vf.value,
      affected,
      description: tpl?.description ?? `The run referenced ${vf.value}; confirm applicability against the affected service and version.`,
      impact: tpl?.impact ?? "Depends on the affected component — assess and set the impact.",
      remediation: tpl?.remediation ?? "Patch the affected component to a fixed release; confirm the version is in range.",
      references: tpl?.references ?? [`https://nvd.nist.gov/vuln/detail/${vf.value}`],
      evidence: [evidenceOf(vf.source_seq)],
      reproduction: reproductionFor(vf.source_seq),
    });
  }

  // Source 2 — privesc paths (confirmed / likely).
  const pr = analyzePrivesc(report);
  for (const p of pr.paths.filter((x: PrivescPath) => x.severity === "confirmed" || x.severity === "likely")) {
    const tpl = matchTemplate({ vector: p.vector });
    add({
      id: `vector-${p.vector}`,
      title: tpl?.title ?? p.title,
      severity: tpl?.severity ?? confidenceToSeverity(p.severity),
      cwe: tpl?.cwe,
      affected,
      description: tpl?.description ?? p.detail,
      impact: tpl?.impact ?? "Local privilege escalation on the host.",
      remediation: tpl?.remediation ?? "Remove the misconfiguration; apply least privilege.",
      references: tpl?.references ?? (p.ref ? [p.ref] : []),
      evidence: [evidenceOf(p.evidence_seq)],
      reproduction: reproductionFor(p.evidence_seq),
    });
  }

  // Source 3 — CWE tags (episode.frameworks.cwe or BINARY_TO_CWE), only when the library knows the CWE.
  for (const e of episodes) {
    const cwes = new Set<string>([...(e.frameworks?.cwe ?? []), ...(BINARY_TO_CWE[e.binary] ?? [])]);
    for (const c of cwes) {
      const tpl = matchTemplate({ cwe: c });
      if (!tpl) continue;
      add({
        id: `cwe-${c.toLowerCase()}`,
        title: tpl.title, severity: tpl.severity, cwe: c, affected,
        description: tpl.description, impact: tpl.impact, remediation: tpl.remediation,
        references: tpl.references,
        evidence: [evidenceOf(e.seq)],
        reproduction: reproductionFor(e.seq),
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    const s = SEV_RANK[a.severity] - SEV_RANK[b.severity];
    return s !== 0 ? s : (a.evidence[0]?.seq ?? 0) - (b.evidence[0]?.seq ?? 0);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/report/findings.test.ts`
Expected: PASS (5 tests). If the fixture import needs a tsconfig `resolveJsonModule` flag, it is already enabled (other tests import fixtures the same way — see `scripts/screenshots.mjs` / existing fixture imports); if not, add `"resolveJsonModule": true` under `compilerOptions` and note it in the report.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b --noEmit`, then:

```bash
git add src/lib/report/findings.ts src/lib/report/findings.test.ts
git commit -m "feat(report): derive report findings from run weaknesses"
```

---

### Task 3: Markdown section builders

**Files:**
- Create: `src/lib/report/sections.ts`
- Test: `src/lib/report/sections.test.ts`

**Interfaces:**
- Consumes: `WatcherReport`, `Finding` from `../../types/report`; `ReportFinding` from `./findings`; `Severity` from `./library`; `fmtClock` from `../format`; `groupFindingsByKind` from `../findings-view`.
- Produces (all pure, return a Markdown string):
  - `export function headerSection(report: WatcherReport): string`
  - `export function execSummarySection(report: WatcherReport, findings: ReportFinding[], summary?: string): string`
  - `export function scopeSection(report: WatcherReport): string`
  - `export function methodologySection(report: WatcherReport): string`
  - `export function findingsSection(findings: ReportFinding[]): string`
  - `export function walkthroughSection(report: WatcherReport): string`
  - `export function appendixSection(report: WatcherReport): string`
  - `export function severityLabel(s: Severity): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/report/sections.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { headerSection, findingsSection, walkthroughSection, appendixSection, severityLabel } from "./sections";
import { deriveReportFindings } from "./findings";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";

const report = demo as unknown as WatcherReport;

describe("sections", () => {
  it("header names the target and states redaction", () => {
    const h = headerSection(report);
    expect(h).toContain("# Abducted");
    expect(h.toLowerCase()).toContain("redact");
  });

  it("findings section has one ### entry per finding with the required fields", () => {
    const findings = deriveReportFindings(report);
    const md = findingsSection(findings);
    expect((md.match(/^### /gm) || []).length).toBe(findings.length);
    expect(md).toContain("**Severity**");
    expect(md).toContain("**Steps to reproduce**");
    expect(md).toContain("**Remediation**");
  });

  it("walkthrough groups by phase label", () => {
    expect(walkthroughSection(report)).toContain("Privilege Escalation");
  });

  it("severityLabel maps unset to a placeholder", () => {
    expect(severityLabel("unset")).toMatch(/set severity/i);
    expect(severityLabel("critical")).toMatch(/critical/i);
  });

  it("does not leak a raw flag — only the sentinel", () => {
    const md = appendixSection(report) + findingsSection(deriveReportFindings(report));
    expect(md).not.toMatch(/HTB\{[^}]/); // no real flag body
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/report/sections.test.ts`
Expected: FAIL — `./sections` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/report/sections.ts`:

```ts
import type { WatcherReport, Finding } from "../../types/report";
import type { ReportFinding } from "./findings";
import type { Severity } from "./library";
import { fmtClock } from "../format";
import { groupFindingsByKind } from "../findings-view";

export function severityLabel(s: Severity): string {
  return s === "unset" ? "— set severity" : s[0].toUpperCase() + s.slice(1);
}

function fence(lines: string[]): string {
  return "```\n" + lines.join("\n") + "\n```";
}

export function headerSection(report: WatcherReport): string {
  const t = report.session?.target;
  const name = t?.name ?? report.session?.target_scope ?? "Engagement";
  const platform = t?.platform ?? "";
  const diff = t?.difficulty?.label ?? "";
  const start = report.session?.started_at ?? "";
  const end = report.session?.ended_at ?? "";
  const profile = report.redaction_profile ?? "full";
  return [
    `# ${name} — Penetration Test Report`,
    "",
    `**Target:** ${name}${platform ? ` (${platform}${diff ? `, ${diff}` : ""})` : ""}  `,
    `**Engagement window:** ${start} → ${end}  `,
    `> Evidence is redacted per the run's redaction profile (\`${profile}\`); credentials and flags are masked.`,
  ].join("\n");
}

export function execSummarySection(report: WatcherReport, findings: ReportFinding[], summary?: string): string {
  if (summary) return `## Executive summary\n\n${summary}`;
  const counts = new Map<Severity, number>();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1);
  const parts = [...counts.entries()].filter(([, n]) => n > 0).map(([s, n]) => `${n} ${severityLabel(s).toLowerCase()}`);
  const rooted = report.golden_dag?.some((o) => /root/i.test(o.objective) && o.status === "proven");
  return [
    "## Executive summary",
    "",
    `The engagement surfaced ${findings.length} finding${findings.length === 1 ? "" : "s"}${parts.length ? ` (${parts.join(", ")})` : ""}.`,
    rooted ? "The target was fully compromised (root access achieved)." : "",
  ].filter(Boolean).join("\n");
}

export function scopeSection(report: WatcherReport): string {
  const t = report.session?.target;
  return [
    "## Scope",
    "",
    `- **Target:** ${t?.name ?? report.session?.target_scope ?? "—"}`,
    `- **Platform:** ${t?.platform ?? "—"}`,
    `- **Context:** ${report.session?.context_path ?? "host"}`,
    `- **Window:** ${report.session?.started_at ?? "—"} → ${report.session?.ended_at ?? "—"}`,
  ].join("\n");
}

export function methodologySection(report: WatcherReport): string {
  const phases = (report.phases ?? []).map((p) => p.label);
  return [
    "## Methodology",
    "",
    "The engagement was recorded end-to-end and analysed against three frameworks — MITRE ATT&CK (technique), the Unified Kill Chain (ordering), and CWE (weakness class).",
    phases.length ? `Phases exercised: ${phases.join(" → ")}.` : "",
  ].filter(Boolean).join("\n");
}

export function findingsSection(findings: ReportFinding[]): string {
  if (!findings.length) return "## Findings\n\nNo findings were derived from the run.";
  const blocks = findings.map((f, i) => {
    const idpart = [f.cve, f.cwe].filter(Boolean).join(" · ") || "—";
    const refs = f.references.length ? f.references.map((r) => `  - ${r}`).join("\n") : "  - —";
    return [
      `### ${i + 1}. ${f.title}`,
      "",
      `**Severity**: ${severityLabel(f.severity)}  `,
      `**Weakness**: ${idpart}  `,
      `**Affected**: ${f.affected}`,
      "",
      `**Description** — ${f.description}`,
      "",
      `**Impact** — ${f.impact}`,
      "",
      "**Evidence**",
      f.evidence.map((e) => `- \`#${e.seq}\` \`${e.cmd}\`\n${fence([e.output || "(no captured output)"])}`).join("\n"),
      "",
      "**Steps to reproduce**",
      fence(f.reproduction.length ? f.reproduction : ["(see the walkthrough)"]),
      "",
      `**Remediation** — ${f.remediation}`,
      "",
      "**References**",
      refs,
    ].join("\n");
  });
  return "## Findings\n\n" + blocks.join("\n\n");
}

export function walkthroughSection(report: WatcherReport): string {
  const episodes = [...(report.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const labelByTactic = new Map((report.phases ?? []).map((p) => [p.mitre_tactic, p.label]));
  const out: string[] = ["## Walkthrough", ""];
  let current = "";
  for (const e of episodes) {
    const label = labelByTactic.get(e.tactic) ?? e.tactic;
    if (label !== current) { out.push(`### ${label}`, ""); current = label; }
    out.push(`- \`#${e.seq}\` \`${e.cmd}\`${e.output_digest ? ` — ${e.output_digest}` : ""}`);
  }
  return out.join("\n");
}

export function appendixSection(report: WatcherReport): string {
  const episodes = [...(report.episodes ?? [])].sort((a, b) => a.seq - b.seq);
  const t0 = episodes[0]?.started_at_ms ?? 0;
  const log = episodes.map((e) => `| ${e.seq} | ${e.started_at_ms ? fmtClock(e.started_at_ms - t0) : "—"} | \`${e.cmd}\` |`).join("\n");
  const ledgerRows = groupFindingsByKind(report.findings ?? [])
    .filter(([kind]) => kind === "port" || kind === "service" || kind === "cred")
    .flatMap(([kind, fs]: [string, Finding[]]) => fs.map((f) => `| ${kind} | ${f.masked ? "••••" : f.value} |`));
  const loadout = new Map<string, number>();
  for (const e of episodes) loadout.set(e.binary, (loadout.get(e.binary) ?? 0) + 1);
  const tools = [...loadout.entries()].sort((a, b) => b[1] - a[1]).map(([b, n]) => `| \`${b}\` | ${n} |`).join("\n");
  return [
    "## Appendix",
    "",
    "### Command log",
    "",
    "| # | Time | Command |",
    "| --- | --- | --- |",
    log,
    "",
    "### Findings ledger",
    "",
    "| Kind | Value |",
    "| --- | --- |",
    ledgerRows.join("\n") || "| — | — |",
    "",
    "### Tool loadout",
    "",
    "| Tool | Count |",
    "| --- | --- |",
    tools,
  ].join("\n");
}
```

Note on the redaction test: the fixture's flag findings already carry the redacted sentinel value (`[redacted-flag]`) and secret findings are masked upstream, so the appendix (which prints only `port`/`service`/`cred` kinds, cred masked) and the findings section never emit a raw flag body.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/report/sections.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b --noEmit`, then:

```bash
git add src/lib/report/sections.ts src/lib/report/sections.test.ts
git commit -m "feat(report): markdown section builders"
```

---

### Task 4: Draft orchestrator

**Files:**
- Create: `src/lib/report/draft.ts`
- Test: `src/lib/report/draft.test.ts`

**Interfaces:**
- Consumes: `WatcherReport` from `../../types/report`; `ReportFinding`, `deriveReportFindings` from `./findings`; all section builders from `./sections`.
- Produces: `export function draftReport(report: WatcherReport, opts?: { findings?: ReportFinding[]; summary?: string }): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/report/draft.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { draftReport } from "./draft";
import { deriveReportFindings } from "./findings";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";

const report = demo as unknown as WatcherReport;

describe("draftReport", () => {
  const md = draftReport(report);

  it("contains every top-level section in order", () => {
    const heads = (md.match(/^## .+$/gm) || []).map((h) => h.replace(/^## /, ""));
    expect(heads).toEqual(["Executive summary", "Scope", "Methodology", "Findings", "Walkthrough", "Appendix"]);
    expect(md).toMatch(/^# Abducted/m);
  });

  it("has one findings entry per derived finding", () => {
    const n = deriveReportFindings(report).length;
    expect((md.match(/^### \d+\. /gm) || []).length).toBe(n);
  });

  it("is deterministic and leaks no raw flag", () => {
    expect(draftReport(report)).toBe(md);
    expect(md).not.toMatch(/HTB\{[^}]/);
  });

  it("honors an injected summary and findings override", () => {
    const md2 = draftReport(report, { summary: "CUSTOM SUMMARY LINE." });
    expect(md2).toContain("CUSTOM SUMMARY LINE.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/report/draft.test.ts`
Expected: FAIL — `./draft` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/report/draft.ts`:

```ts
import type { WatcherReport } from "../../types/report";
import { deriveReportFindings, type ReportFinding } from "./findings";
import {
  headerSection, execSummarySection, scopeSection, methodologySection,
  findingsSection, walkthroughSection, appendixSection,
} from "./sections";

/**
 * Render a full OSCP/CPTS-style Markdown report draft. Pure and deterministic. `opts.findings`
 * and `opts.summary` let a caller inject model-polished pieces (see report/narrate.ts); with no
 * opts the whole draft is deterministic.
 */
export function draftReport(report: WatcherReport, opts?: { findings?: ReportFinding[]; summary?: string }): string {
  const findings = opts?.findings ?? deriveReportFindings(report);
  return [
    headerSection(report),
    execSummarySection(report, findings, opts?.summary),
    scopeSection(report),
    methodologySection(report),
    findingsSection(findings),
    walkthroughSection(report),
    appendixSection(report),
  ].join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/report/draft.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b --noEmit`, then:

```bash
git add src/lib/report/draft.ts src/lib/report/draft.test.ts
git commit -m "feat(report): draft orchestrator"
```

---

### Task 5: Optional model polish

**Files:**
- Create: `src/lib/report/narrate.ts`
- Test: `src/lib/report/narrate.test.ts`

**Interfaces:**
- Consumes: `WatcherReport` from `../../types/report`; `LlmProvider` from `../llm/provider`; `deriveReportFindings`, `ReportFinding` from `./findings`.
- Produces: `export async function narrateReport(report: WatcherReport, provider: LlmProvider): Promise<{ findings: ReportFinding[]; summary?: string }>` — polished pieces to pass into `draftReport(report, …)`. On unavailable provider or any error, returns the deterministic findings and no summary (so the draft is unchanged).

- [ ] **Step 1: Write the failing test**

Create `src/lib/report/narrate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { narrateReport } from "./narrate";
import { draftReport } from "./draft";
import { deriveReportFindings } from "./findings";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";
import type { LlmProvider } from "../llm/provider";

const report = demo as unknown as WatcherReport;
const nullProvider: LlmProvider = { async available() { return false; }, async generateJson() { return null; } };

describe("narrateReport", () => {
  it("with an unavailable provider, returns deterministic findings and no summary", async () => {
    const out = await narrateReport(report, nullProvider);
    expect(out.summary).toBeUndefined();
    expect(out.findings).toEqual(deriveReportFindings(report));
    // draft is unchanged vs the fully deterministic draft
    expect(draftReport(report, out)).toBe(draftReport(report));
  });

  it("with a stub provider, only prose fields change", async () => {
    const stub: LlmProvider = {
      async available() { return true; },
      async generateJson() { return { summary: "POLISHED SUMMARY", descriptions: {} }; },
    };
    const out = await narrateReport(report, stub);
    expect(out.summary).toBe("POLISHED SUMMARY");
    // structural fields (id/severity/evidence) untouched
    expect(out.findings.map((f) => f.id)).toEqual(deriveReportFindings(report).map((f) => f.id));
    expect(out.findings.map((f) => f.severity)).toEqual(deriveReportFindings(report).map((f) => f.severity));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/report/narrate.test.ts`
Expected: FAIL — `./narrate` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/report/narrate.ts`:

```ts
import type { WatcherReport } from "../../types/report";
import type { LlmProvider } from "../llm/provider";
import { deriveReportFindings, type ReportFinding } from "./findings";

/**
 * Optional prose polish. Deterministic-first: with no available provider (or on any error) it
 * returns the deterministic findings and no summary, so draftReport(report, out) === draftReport(report).
 * When a provider yields JSON, it overrides ONLY prose: the exec summary and per-finding description.
 * Structural fields (id, severity, cwe/cve, evidence, reproduction) are never touched. Nothing new
 * or un-redacted is sent — the model sees only fields already in the deterministic draft.
 */
export async function narrateReport(
  report: WatcherReport,
  provider: LlmProvider,
): Promise<{ findings: ReportFinding[]; summary?: string }> {
  const findings = deriveReportFindings(report);
  try {
    if (!(await provider.available())) return { findings };
    const payload = findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity, description: f.description, impact: f.impact }));
    const prompt = [
      "Rewrite the prose of a penetration-test report for clarity and a professional tone.",
      "Return JSON { summary: string, descriptions: { <finding id>: string } }.",
      "Do not invent facts, CVEs, or severities. Keep every claim supported by the input.",
      JSON.stringify({ findings: payload }),
    ].join("\n");
    const res = (await provider.generateJson(prompt)) as { summary?: string; descriptions?: Record<string, string> } | null;
    if (!res) return { findings };
    const polished = findings.map((f) =>
      res.descriptions?.[f.id] ? { ...f, description: res.descriptions[f.id] } : f,
    );
    return { findings: polished, summary: res.summary };
  } catch {
    return { findings };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/report/narrate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b --noEmit`, then:

```bash
git add src/lib/report/narrate.ts src/lib/report/narrate.test.ts
git commit -m "feat(report): optional model prose polish"
```

---

### Task 6: Export script + README

**Files:**
- Create: `scripts/export-report.tsx`
- Modify: `README.md` (add a "Draft a report" subsection after the "Capture your own runs" / debrief sections)
- Test: `src/lib/report/export-report.test.ts`

**Interfaces:**
- Consumes: `draftReport` from `../src/lib/report/draft`; reads a report JSON fixture or `--report <path>`.
- Produces: writes a Markdown file (default `dist/report.md` or `--out <path>`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/report/export-report.test.ts` (a smoke test that drives the same pure entry point the script uses):

```ts
import { describe, it, expect } from "vitest";
import { draftReport } from "./draft";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";

describe("export smoke", () => {
  it("produces a non-empty markdown report with a header and findings", () => {
    const md = draftReport(demo as unknown as WatcherReport);
    expect(md.length).toBeGreaterThan(200);
    expect(md).toMatch(/^# Abducted/m);
    expect(md).toContain("## Findings");
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npx vitest run src/lib/report/export-report.test.ts`
Expected: PASS once Task 4 is in (this task's test is a smoke check; it validates the entry point the script wraps). If it fails because `draftReport` is missing, Task 4 was not completed — stop and report.

- [ ] **Step 3: Write the script**

Create `scripts/export-report.tsx`:

```ts
/**
 * Draft an OSCP/CPTS-style Markdown pentest report from a graded run.
 *
 *   vite-node scripts/export-report.tsx [--report <path>] [--out <path>]
 *
 * Defaults: reads fixtures/session-demo-full.json, writes dist/report.md. Deterministic; no model.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { draftReport } from "../src/lib/report/draft";
import type { WatcherReport } from "../src/types/report";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const argOf = (flag: string, def: string) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const reportPath = resolve(root, argOf("--report", "fixtures/session-demo-full.json"));
const outPath = resolve(root, argOf("--out", "dist/report.md"));

const report = JSON.parse(readFileSync(reportPath, "utf8")) as WatcherReport;
const md = draftReport(report);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, md, "utf8");

/* eslint-disable no-console */
console.log(`wrote ${outPath} (${md.length} bytes)`);
console.log("Paste it into your OSCP/CPTS template, or run it through any Markdown→PDF tool.");
```

- [ ] **Step 4: Verify the script runs**

Run: `npx vite-node scripts/export-report.tsx`
Expected: prints `wrote …/dist/report.md` and the file exists and is non-empty. Open it and eyeball the header, the two findings, the walkthrough, and the appendix.

- [ ] **Step 5: README subsection**

Add to `README.md`, after the "Capture your own runs" section (before "Record your web traffic"):

```markdown
## Draft a report

Turn a graded run into an OSCP/CPTS-style report draft in Markdown — findings with severity,
evidence and remediation, a walkthrough, and an appendix, all built from the run's own record:

```sh
npm run report                      # drafts the bundled demo → dist/report.md
npm run report -- --report <path>   # draft from your own report JSON
```

It's deterministic and offline. Paste the Markdown into your exam template, or run it through any
Markdown→PDF tool. Findings come from what the run proves it exploited (CVEs, privilege-escalation
paths, weakness classes); evidence and reproduction are the real commands, redacted per your
redaction profile.
```

Then add the `report` script to `package.json`'s `"scripts"`: `"report": "vite-node scripts/export-report.tsx"`.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npx vitest run` (all report tests plus the existing suite green) and `npx tsc -b --noEmit` (clean).

- [ ] **Step 7: Commit**

```bash
git add scripts/export-report.tsx src/lib/report/export-report.test.ts README.md package.json
git commit -m "feat(report): export-report script + docs"
```
