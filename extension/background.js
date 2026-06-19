// Service worker (module). Receives the ISOLATED relay's messages, classifies HTB API taps into
// session lifecycle, maps terminal frames to §3.3 envelopes, and forwards both to the local daemon
// over Native Messaging. HTB fires the spawn POST *before* the name/avatar arrive (via the
// active/profile GETs), so we badge + open the session on spawn and enrich it when identity lands.
import { classifyHtbActivity, wsFrameToEnvelope } from "./lib/detect.js";
import { fetchWriteup } from "./lib/writeup.js";

const HOST = "com.thewatcher.host";
const ctx = { session_uuid: null, seq: 0, context_path: "cloud:htb:pwnbox", platform: "htb", machine: null, token: null, writeupFetched: false };

/** Auto-fetch the box write-up (HTB official -> 0xdf -> IppSec) once we have an open session + id. */
async function maybeFetchWriteup() {
  if (!ctx.session_uuid || ctx.writeupFetched || !ctx.machine?.machine_id) return;
  ctx.writeupFetched = true;
  const sid = ctx.session_uuid;
  const res = await fetchWriteup(ctx.machine, ctx.token, (m) => console.log(`[Watcher] writeup · ${m}`));
  if (res && ctx.session_uuid === sid) {
    // text = community HTML (already stripped here); url = official PDF the daemon fetches + extracts.
    console.log(`[Watcher] ✓ write-up from ${res.source} (${res.text ? `${res.text.length} chars` : "pdf url"}) — grading vs intended path`);
    send(envelope({ kind: "writeup", text: res.text ?? null, url: res.url ?? null, source: res.source }));
  } else if (!res) {
    console.log("[Watcher] no write-up found (box may not be retired / no public write-up yet)");
  }
}

let port = null;
function daemon() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(HOST);
    port.onDisconnect.addListener(() => {
      port = null;
    });
  } catch {
    port = null;
  }
  return port;
}
function send(envelope) {
  const p = daemon();
  try {
    p?.postMessage(envelope);
  } catch {
    /* daemon not running — capture on the host still works */
  }
}
function envelope(extra) {
  return { source: "browser_ext", session_uuid: ctx.session_uuid, ts_utc_us: Date.now() * 1000, ...extra };
}

function badge(text, color) {
  try {
    chrome.action.setBadgeText({ text });
    if (color) chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    /* no action surface */
  }
}

function mergeMachine(sig) {
  const m = ctx.machine ?? {};
  ctx.machine = {
    machine_id: sig.machine_id ?? m.machine_id,
    name: sig.name ?? m.name,
    // keep the first good avatar (the active poll's S3 url) — don't let a later profile enrich,
    // which only carries the non-resolving relative path, clobber it.
    avatar: m.avatar ?? sig.avatar,
    os: sig.os ?? m.os,
    difficulty: sig.difficulty ?? m.difficulty,
    ip: sig.ip ?? m.ip,
  };
}

/** Open a recording session for the running box (from a spawn POST or an active poll). */
function openSession(sig) {
  ctx.session_uuid = crypto.randomUUID();
  ctx.seq = 0;
  ctx.writeupFetched = false;
  mergeMachine(sig);
  badge("REC", "#c8811a");
  const name = ctx.machine?.name || `HTB machine ${ctx.machine?.machine_id ?? "?"}`;
  console.log(`[Watcher] ▶ session opened — ${name}`, ctx.machine);
  send(
    envelope({
      kind: "session_start",
      target_scope: name,
      context_path: "cloud:htb",
      origin: { lab: "htb", machine_id: ctx.machine?.machine_id ?? null, ip: ctx.machine?.ip ?? null },
      machine: { name, avatar: ctx.machine?.avatar ?? null, os: ctx.machine?.os, difficulty: ctx.machine?.difficulty },
    }),
  );
  void maybeFetchWriteup();
}

/** Close the active session (machine stopped, or the active poll went empty). */
function closeSession(reason) {
  if (!ctx.session_uuid) return;
  console.log(`[Watcher] ■ session closed — ${reason}`);
  badge("", null);
  send(envelope({ kind: "session_end", reason, origin: { lab: "htb", machine_id: ctx.machine?.machine_id ?? null } }));
  ctx.session_uuid = null;
  ctx.machine = null;
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message?.watcher) return;
  const msg = message.payload;

  if (msg.kind === "htb_api") {
    const sig = classifyHtbActivity(msg.url, msg.method, msg.body);
    if (!sig) return;

    // A VM is running. Open a session if we don't have one (covers a spawn we never saw), else enrich.
    if (sig.kind === "active") {
      mergeMachine(sig);
      if (!ctx.session_uuid) openSession(sig);
      else send(envelope({ kind: "session_enrich", machine: ctx.machine, target_scope: ctx.machine.name }));
      void maybeFetchWriteup();
      return;
    }

    // The active slot is empty — nothing running. If we had a session, the box was stopped.
    if (sig.kind === "inactive") {
      closeSession("machine_stopped");
      return;
    }

    // Identity only (browsing or the post-spawn enrich). Cache it; push to an open session.
    if (sig.kind === "profile") {
      mergeMachine(sig);
      console.log(`[Watcher] machine identity: ${ctx.machine?.name}`, ctx.machine);
      if (ctx.session_uuid && ctx.machine?.name) {
        send(envelope({ kind: "session_enrich", machine: ctx.machine, target_scope: ctx.machine.name }));
      }
      void maybeFetchWriteup();
      return;
    }

    if (sig.kind === "spawn") {
      mergeMachine(sig);
      console.log(`[Watcher] ▶ HTB spawn detected — machine_id=${sig.machine_id}`);
      if (!ctx.session_uuid) openSession(sig);
      return;
    }

    if (sig.kind === "stop") {
      closeSession("machine_stopped");
      return;
    }
  }

  // The SPA's bearer token — lets us fetch the official HTB write-up with the user's own auth.
  if (msg.kind === "htb_auth" && msg.token) {
    ctx.token = msg.token;
    void maybeFetchWriteup();
    return;
  }

  // In-browser text terminals (ttyd/xterm over WebSocket — e.g. some THM rooms). Pwnbox is VNC and
  // can't be tapped this way; the in-Pwnbox agent handles that case (capture/CAPTURE.md).
  if (msg.kind === "ws" && ctx.session_uuid) {
    ctx.seq += 1;
    send(wsFrameToEnvelope(msg.data, msg.dir, { ...ctx, ts_utc_us: Date.now() * 1000 }));
  }
});

console.log("[Watcher] extension service worker ready — watching hackthebox.com for spawns");
