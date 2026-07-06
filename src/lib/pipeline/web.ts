/**
 * Web exchange → (tactic, technique, cwe) prior — the deterministic pass-1 table for
 * HTTP traffic, peer of pipeline/mitre.ts. Keyed on request/response *features*
 * (params, payload shape, response signal), never on live secret values.
 */
import type { WebExchange } from "./types";

export interface WebPrior {
  tactic: string;
  technique: string;
  cwe?: string;
  confidence: number;
}

const SQL_ERROR = /sql syntax|mysql_fetch|ORA-\d|unclosed quotation|pg_query|sqlite_/i;
const SQLI_PROBE = /('|%27|\bUNION\b|\bOR\b\s+1=1|--\s|%20OR%20)/i;
const TRAVERSAL = /(\.\.\/|\.\.%2f|%2e%2e\/|\/etc\/passwd)/i;
const XSS_PROBE = /<script|onerror=|javascript:/i;

export function classifyExchange(ex: WebExchange): WebPrior {
  const url = ex.url ?? "";
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const body = ex.req_body ?? "";
  const resp = ex.resp_body ?? "";
  const authy = /\b(login|signin|auth|token|session)\b/i.test(url);

  if (SQLI_PROBE.test(query) || SQLI_PROBE.test(body)) {
    const confirmed = SQL_ERROR.test(resp);
    return { tactic: "TA0001", technique: "T1190", cwe: "CWE-89", confidence: confirmed ? 0.9 : 0.7 };
  }
  if (TRAVERSAL.test(query) || TRAVERSAL.test(body)) {
    return { tactic: "TA0001", technique: "T1190", cwe: "CWE-22", confidence: 0.8 };
  }
  if (XSS_PROBE.test(query) || (XSS_PROBE.test(body) && XSS_PROBE.test(resp))) {
    return { tactic: "TA0001", technique: "T1190", cwe: "CWE-79", confidence: 0.7 };
  }
  if (ex.method === "POST" && authy) {
    return { tactic: "TA0001", technique: "T1110", cwe: undefined, confidence: 0.6 };
  }
  // plain browsing / content discovery — low-confidence recon prior
  return { tactic: "TA0007", technique: "T1595", cwe: undefined, confidence: 0.4 };
}
