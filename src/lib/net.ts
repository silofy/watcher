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
