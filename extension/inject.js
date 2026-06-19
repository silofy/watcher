// MAIN world (document_start). Three taps, all below the renderer:
//   1. XMLHttpRequest — HTB's SPA uses axios (XHR), so this is the PRIMARY API tap.
//   2. fetch — some calls use fetch; tapped too.
//   3. WebSocket — the raw PTY stream of in-browser text terminals (ttyd/wetty), DOM fallback below.
// For API calls we forward the REQUEST body on POST (spawn's machine_id) and the RESPONSE body on GET
// (the active/profile machine identity). A content script in ISOLATED can't see these — hence MAIN.
(() => {
  const post = (msg) => window.postMessage({ __watcher: true, ...msg }, "*");
  // HTB's machine + VM-lifecycle endpoints live under /api/v4 and /api/v5.
  const isApi = (u) => typeof u === "string" && /\/api\/v[45]\//.test(u);

  const redact = (t) =>
    String(t)
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "x.x.x.x")
      .replace(/\b[0-9a-fA-F]{32}\b/g, "[redacted-flag]");

  const apiBody = (method, reqBody, resText) => {
    if (method === "POST" || method === "PUT") {
      try {
        return JSON.parse(reqBody);
      } catch {
        return reqBody ?? null;
      }
    }
    try {
      return JSON.parse(resText);
    } catch {
      return null;
    }
  };

  // Capture the SPA's bearer token (from its own XHRs) so we can fetch the official write-up with
  // the user's existing HTB auth — no new credential, nothing about the session leaves.
  const xSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try {
      if (/^authorization$/i.test(k) && typeof v === "string" && /bearer/i.test(v)) post({ kind: "htb_auth", token: v });
    } catch {
      /* never break the page */
    }
    return xSetHeader.apply(this, arguments);
  };

  // 1) XHR tap (axios) — patch the prototype so every request is seen.
  const xOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__w = { method: String(method || "GET").toUpperCase(), url };
    return xOpen.apply(this, arguments);
  };
  const xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (reqBody) {
    this.addEventListener("load", () => {
      try {
        const w = this.__w;
        if (!w || !isApi(w.url)) return;
        post({ kind: "htb_api", url: w.url, method: w.method, body: apiBody(w.method, reqBody, this.responseText) });
      } catch {
        /* never break the page */
      }
    });
    return xSend.apply(this, arguments);
  };

  // 2) fetch tap.
  const nativeFetch = window.fetch;
  window.fetch = async function (...a) {
    const res = await nativeFetch.apply(this, a);
    try {
      const url = typeof a[0] === "string" ? a[0] : a[0]?.url;
      if (isApi(url)) {
        const method = String(a[1]?.method || (typeof a[0] !== "string" ? a[0]?.method : "") || "GET").toUpperCase();
        const resText = method === "GET" ? await res.clone().text().catch(() => "") : "";
        post({ kind: "htb_api", url, method, body: apiBody(method, a[1]?.body, resText) });
      }
    } catch {
      /* never break the page */
    }
    return res;
  };

  // 3) WebSocket tap — in-browser text terminal PTY stream (redacted before it leaves the page).
  //    HTB also runs a Pusher realtime socket (notifications/presence) whose frames are JSON
  //    control messages, NOT terminal bytes — drop those so we don't record them as keystrokes.
  const isControlFrame = (d) => {
    if (typeof d !== "string") return false; // binary frames are terminal data
    const s = d.trimStart();
    if (s[0] !== "{" && s[0] !== "[") return false;
    return /"event"\s*:/.test(s) || /pusher|presence|ping|pong/i.test(s);
  };
  const NativeWS = window.WebSocket;
  window.WebSocket = function (...a) {
    const ws = new NativeWS(...a);
    ws.addEventListener("message", (e) => {
      if (!isControlFrame(e.data)) post({ kind: "ws", dir: "in", data: redact(e.data) });
    });
    const send = ws.send.bind(ws);
    ws.send = (d) => {
      if (!isControlFrame(d)) post({ kind: "ws", dir: "out", data: redact(d) });
      return send(d);
    };
    return ws;
  };

  // DOM fallback for platforms that render terminal text into .xterm-rows.
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.target.classList?.contains("xterm-rows")) {
        post({ kind: "ws", dir: "in", data: redact(m.target.innerText) });
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
})();
