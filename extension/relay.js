// ISOLATED world (document_start). The only context allowed to talk to the extension's
// service worker / nativeMessaging. It forwards the MAIN-world taps and nothing else.
(() => {
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.__watcher !== true) return;
    // Hand off to the service worker (background.js), which classifies + forwards to the daemon.
    try {
      chrome.runtime.sendMessage({ watcher: true, payload: msg });
    } catch {
      /* worker may be asleep; MV3 will wake it on the next message */
    }
  });
})();
