/**
 * Fetch a write-up URL as text. In the desktop app this goes through a Rust command (`fetch_writeup`)
 * so it isn't subject to the webview's CORS policy — most write-up hosts (0xdf, ippsec notes, HTB)
 * don't send permissive CORS headers, so a browser `fetch()` fails on them. In the dev browser we fall
 * back to `fetch()`, which stays CORS-limited (paste the text instead).
 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Open an http(s) URL in the system browser. In the desktop webview a `target="_blank"` link doesn't
 * escape to the OS browser (it silently does nothing), so route through the native `open_url` command;
 * on the web, a normal new tab. Use this for every external link instead of a bare anchor.
 */
export async function openExternal(url: string): Promise<void> {
  if (isDesktop()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_url", { url });
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function fetchWriteupUrl(url: string): Promise<string> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke("fetch_writeup", { url })) as string;
  }
  return (await fetch(url)).text();
}

/**
 * Resolve and fetch 0xdf's write-up for a box in one click: 0xdf posts are date-stamped so there's no
 * constructable URL, but its Jekyll sitemap lists every post — match `htb-<slug>` and fetch that. This
 * is the one source that's plain text and thus auto-extractable (IppSec is video, HTB is auth-gated).
 */
export async function fetchWriteupFrom0xdf(box: string): Promise<string> {
  const slug = box.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sitemap = await fetchWriteupUrl("https://0xdf.gitlab.io/sitemap.xml");
  const m = sitemap.match(new RegExp(`https?://0xdf\\.gitlab\\.io/[^<\\s]*htb-${slug}[^<\\s]*`, "i"));
  if (!m) throw new Error(`No 0xdf post found for "${box}".`);
  return fetchWriteupUrl(m[0]);
}

/**
 * HTB App Token — a bearer credential stored only by the native side (~/.watcher/config.json), never
 * held in the JS bundle or returned to the webview. The UI only ever learns whether one is set.
 */
export async function hasHtbToken(): Promise<boolean> {
  if (!isDesktop()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke("has_htb_token")) as boolean;
}

export async function setHtbToken(token: string): Promise<void> {
  if (!isDesktop()) throw new Error("The HTB token can only be saved in the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_htb_token", { token });
}

export async function clearHtbToken(): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_htb_token");
}

/** Pull the official HTB write-up for a retired box (native-side, using the stored token). */
export async function fetchHtbWriteup(box: string): Promise<string> {
  if (!isDesktop()) throw new Error("Fetching the HTB write-up needs the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke("fetch_htb_writeup", { name: box })) as string;
}

/** A web search that lands on the box's write-up for a source that can't be auto-fetched. IppSec is
 *  video, so go straight to a YouTube search (lands on his walkthrough); HTB write-ups are auth-gated,
 *  so a general search is the best we can do. */
export function writeupSearchUrl(source: "ippsec" | "htb", box: string): string {
  if (source === "ippsec") return `https://www.youtube.com/results?search_query=${encodeURIComponent(`ippsec ${box}`)}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(`hackthebox ${box} official writeup`)}`;
}
