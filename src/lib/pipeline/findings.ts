import type { Episode, Finding, FindingKind, RedactionProfile } from "../../types/report";

interface Detector {
  kind: FindingKind;
  re: RegExp;
  /** Build (id, value, extra) from a match; return null to skip. */
  make: (m: RegExpMatchArray) => { id: string; value: string; tactic?: string } | null;
}

function hash8(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const DETECTORS: Detector[] = [
  { kind: "port", re: /(\d{1,5})\/(tcp|udp)\s+open(?:\s+(\S+))?/g, make: (m) => ({ id: `port:${m[1]}-${m[2]}`, value: `${m[1]}/${m[2]}`, tactic: "TA0007" }) },
  { kind: "url", re: /https?:\/\/[^\s"'<>]+/g, make: (m) => ({ id: `url:${hash8(m[0])}`, value: m[0], tactic: "TA0007" }) },
  { kind: "hash", re: /\b[a-f0-9]{32,}\b|\$[0-9a-z]\$[^\s:]+/g, make: (m) => ({ id: `hash:${hash8(m[0])}`, value: m[0] }) },
  { kind: "cred", re: /(?:password|passwd|pwd|user(?:name)?)\s*[:=]\s*(\S+)/gi, make: (m) => ({ id: `cred:${hash8(m[0])}`, value: m[0], tactic: "TA0006" }) },
  { kind: "vuln", re: /CVE-\d{4}-\d{3,}/g, make: (m) => ({ id: `vuln:${m[0]}`, value: m[0], tactic: "TA0001" }) },
];

const FLAG_RE = /\b[a-f0-9]{32}\b|(?:HTB|THM|flag)\{[^}]*\}/gi;
const SECRET_KINDS = new Set<FindingKind>(["cred", "hash", "flag"]);

function mask(value: string): string {
  const tail = value.slice(-2);
  return `••••${tail}`;
}

/** Deterministic findings ledger. Iterates episodes in seq order; links used_by_seq by tokenised match. */
export function extractFindings(episodes: Episode[], profile: RedactionProfile): Finding[] {
  const byId = new Map<string, Finding>();

  const add = (f: Omit<Finding, "used_by_seq">) => {
    const existing = byId.get(f.id);
    if (existing) return; // first occurrence wins as source_seq
    byId.set(f.id, { ...f, used_by_seq: [] });
  };

  for (const ep of episodes) {
    const text = ep.output_digest ?? "";
    for (const d of DETECTORS) {
      d.re.lastIndex = 0;
      for (const m of text.matchAll(d.re)) {
        const built = d.make(m);
        if (!built) continue;
        add({ id: built.id, kind: d.kind, value: built.value, source_seq: ep.seq, tactic: built.tactic });
      }
    }
    // flags: a flag-shaped token in output is "proven" (observed). A bare `cat *.txt` with no token isn't.
    FLAG_RE.lastIndex = 0;
    const flagName = /(?:user|root|proof)\.txt/i.test(ep.cmd) ? (/root|proof/i.test(ep.cmd) ? "root" : "user") : null;
    const flagMatch = text.match(FLAG_RE);
    if (flagName || flagMatch) {
      const id = `flag:${flagName ?? hash8(flagMatch![0])}`;
      if (!byId.has(id)) {
        byId.set(id, { id, kind: "flag", value: flagMatch ? flagMatch[0] : `${flagName}.txt`, source_seq: ep.seq, proven: Boolean(flagMatch), used_by_seq: [] });
      }
    }
  }

  // Link used_by_seq: a later episode whose cmd contains the finding's value token consumed it.
  const findings = [...byId.values()];
  for (const f of findings) {
    const needle = f.kind === "port" ? f.value.split("/")[0] : f.value;
    for (const ep of episodes) {
      if (ep.seq <= f.source_seq) continue;
      if (ep.cmd.includes(needle)) f.used_by_seq!.push(ep.seq);
    }
  }

  // Redaction pass.
  if (profile === "public_safe") {
    for (const f of findings) {
      if (SECRET_KINDS.has(f.kind)) { f.value = mask(f.value); f.masked = true; }
    }
  }

  // Stable ordering: by source_seq, then id.
  findings.sort((a, b) => a.source_seq - b.source_seq || a.id.localeCompare(b.id));
  return findings;
}
