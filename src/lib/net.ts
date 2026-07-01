/**
 * Fetch a write-up URL as text. In the desktop app this goes through a Rust command (`fetch_writeup`)
 * so it isn't subject to the webview's CORS policy — most write-up hosts (0xdf, ippsec notes, HTB)
 * don't send permissive CORS headers, so a browser `fetch()` fails on them. In the dev browser we fall
 * back to `fetch()`, which stays CORS-limited (paste the text instead).
 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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

/** A web search that lands on the box's write-up for a source that can't be auto-fetched. */
export function writeupSearchUrl(source: "ippsec" | "htb", box: string): string {
  const q = source === "ippsec" ? `ippsec ${box}` : `hackthebox ${box} official writeup`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
}
