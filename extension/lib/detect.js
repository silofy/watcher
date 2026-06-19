// The Watcher — browser extension detection core (brief §3.2).
//
// Pure, testable logic shared by the content scripts and the service worker:
//   * classifyHtbActivity — recognize HTB spawn/stop/active API calls (the session triggers)
//   * toSessionControl     — turn a spawn/stop signal into a session_start/session_end the
//                            daemon's SessionController consumes (same kinds the local daemon emits)
//   * redact               — client-side regex redaction; there is no termios in the browser, so
//                            masking must happen here before anything leaves the page. The daemon
//                            re-redacts on receipt (never trusts an upstream's scrubbing).
//   * wsFrameToEnvelope    — map a tapped in-browser-terminal WebSocket frame to a §3.3 envelope.

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const FLAG = /\b[0-9a-fA-F]{32}\b/g;
const SECRET = /((?:password|passwd|pass|secret|token|api[_-]?key))\s*[:=]\s*\S+/gi;

/** Mask IPs, flag hashes, and credential-shaped tokens. */
export function redact(text) {
  return String(text)
    .replace(IPV4, "x.x.x.x")
    .replace(FLAG, "[redacted-flag]")
    .replace(SECRET, (_m, k) => `${k}=[redacted]`);
}

function safeParse(body) {
  if (body && typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const AVATAR_HOST = "https://labs.hackthebox.com";

/** HTB serves avatars from a relative /storage path; make it absolute. */
function absAvatar(a) {
  if (!a || typeof a !== "string") return null;
  return a.startsWith("/") ? AVATAR_HOST + a : a;
}

/**
 * Classify an HTB v4 API call against the real endpoints. Spawn/stop are the session triggers; the
 * active and profile endpoints enrich the machine identity (name, avatar, OS, difficulty, IP).
 * @returns {{kind:'spawn'|'stop'|'active'|'profile', machine_id?, name?, avatar?, ip?, os?, difficulty?}|null}
 */
/** Pull a machine record out of whatever envelope HTB wraps it in (v4 used `info`, v5 varies). */
function pick(b) {
  return b?.info ?? b?.data ?? b?.message ?? b ?? null;
}
function machineFrom(i) {
  return {
    machine_id: i.id ?? i.machine_id ?? null,
    name: i.name ?? null,
    // HTB serves avatars from S3; `avatar_url` is the canonical absolute one. The relative `avatar`
    // (/avatars/..) does NOT resolve on labs.hackthebox.com, so only use it as a last resort.
    avatar: i.avatar_url ?? absAvatar(i.avatar),
    os: i.os ?? null,
    difficulty: i.difficultyText ?? i.difficulty ?? null,
    ip: i.ip ?? i.ipv4 ?? null,
  };
}

export function classifyHtbActivity(url, method, body) {
  const u = String(url || "");
  const m = String(method || "GET").toUpperCase();
  const b = safeParse(body);

  // --- Spawn (session start). HTB unified VM control under v5 /virtual_machine; v4 vm/* lingers
  //     for Starting Point and older flows. Accept both. ---
  if (m === "POST" && /\/api\/v\d+\/(virtual_machine|vm)\/(spawn|start)\b/.test(u)) {
    return { kind: "spawn", machine_id: b?.machine_id ?? b?.machine ?? b?.vm_id ?? b?.id ?? null };
  }
  // Free VPN: POST /api/v4/machine/play/{machine_id} (id is in the path, no body)
  const play = u.match(/\/api\/v4\/machine\/play\/(\d+)/);
  if (m === "POST" && play) {
    return { kind: "spawn", machine_id: Number(play[1]) };
  }
  if (m === "POST" && /\/api\/v\d+\/(virtual_machine|vm|machine)\/(terminate|stop)\b/.test(u)) {
    return { kind: "stop", machine_id: b?.machine_id ?? null };
  }

  // --- Active VM: the authoritative "a machine is running right now" signal. HTB's UI polls this
  //     on load and periodically, so it both opens a missed-spawn session AND closes it on stop. ---
  if (/\/api\/v\d+\/(virtual_machine|machine)\/active\b/.test(u)) {
    const i = pick(b);
    if (i && (i.id != null || i.machine_id != null || i.name)) {
      return { kind: "active", ...machineFrom(i) };
    }
    return { kind: "inactive" }; // running-VM slot is empty
  }

  // --- Profile: identity only (name/os/difficulty/avatar). Fires from just browsing a box, so it
  //     never opens a session on its own — it enriches one. ---
  if (/\/api\/v\d+\/machine\/(profile|info)\b/.test(u)) {
    const i = pick(b);
    if (i && i.name) return { kind: "profile", ...machineFrom(i) };
  }
  return null;
}

/**
 * Turn a spawn/stop signal into a session-control message — the same session_start /
 * session_end lifecycle kinds the local daemon emits. "active" is enrichment, not control.
 */
export function toSessionControl(sig) {
  if (!sig) return null;
  if (sig.kind === "spawn") {
    const name = sig.name || `HTB machine ${sig.machine_id ?? "?"}`;
    return {
      kind: "session_start",
      target_scope: name,
      context_path: "cloud:htb",
      origin: { lab: "htb", machine_id: sig.machine_id ?? null, ip: sig.ip ?? null },
      // the report's machine hero
      machine: { name, avatar: sig.avatar ?? null, os: sig.os, difficulty: sig.difficulty },
    };
  }
  if (sig.kind === "stop") {
    return { kind: "session_end", reason: "machine_stopped", origin: { lab: "htb", machine_id: sig.machine_id ?? null } };
  }
  return null;
}

/**
 * Map a tapped terminal WebSocket frame to a §3.3 telemetry envelope. Boundaries inferred
 * from the stream carry lower confidence than the daemon's exact OSC 133 ones.
 */
export function wsFrameToEnvelope(data, dir, ctx) {
  const isInput = dir === "out"; // bytes the user sent = stdin
  return {
    source: "browser_ext",
    session_uuid: ctx.session_uuid,
    seq: ctx.seq,
    ts_utc_us: ctx.ts_utc_us,
    kind: isInput ? "input" : "output",
    payload: { stream: isInput ? "stdin" : "stdout", text: redact(data) },
    provenance: {
      boundary_confidence: 0.72,
      redaction_method: "regex",
      context_path: ctx.context_path || "cloud:htb:pwnbox",
      platform: ctx.platform || "ttyd",
    },
  };
}
