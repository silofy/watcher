import { fetchWriteupUrl } from "../net";

/** Resolve a platform avatar image URL at runtime, under the user's own credentials.
 *  Never bundles third-party assets; any failure returns null so the caller keeps the hue emblem. */
const HTB_CDN = "https://labs.hackthebox.com";

export async function resolveAvatar(
  target: { platform: string; name: string; url?: string | null },
  creds: { htbToken?: string } = {},
): Promise<string | null> {
  try {
    if (target.platform === "htb" && creds.htbToken) {
      // NOTE: this stays on raw `fetch` rather than `fetchWriteupUrl` because it needs to send an
      // `Authorization: Bearer` header, which `fetchWriteupUrl`/`fetch_writeup` doesn't support today.
      // As a result this branch is CORS-blocked in the shipped desktop app and only resolves in
      // contexts with permissive CORS. It's also currently unreachable in practice — the HTB token
      // lives only on the native side and is never passed in as `creds.htbToken` (see MachineAvatar.tsx)
      // — so it degrades to the hue emblem regardless. Fixing this needs (a) a token exposed to the
      // webview and (b) a native fetch command that can forward custom headers.
      const slug = target.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const res = await fetch(`https://labs.hackthebox.com/api/v4/machine/profile/${slug}`, {
        headers: { Authorization: `Bearer ${creds.htbToken}`, Accept: "application/json" },
      });
      if (!res.ok) return null;
      const data = await res.json();
      const path = data?.info?.avatar ?? data?.avatar ?? null;
      return path ? (path.startsWith("http") ? path : `${HTB_CDN}${path}`) : null;
    }
    if (target.platform === "thm" && target.url) {
      // Routed through the native (Tauri) fetch seam so this isn't CORS-blocked in the shipped
      // desktop app — THM's room pages don't send permissive CORS headers, so a plain browser
      // `fetch()` fails there. Resolves on desktop; in the dev browser `fetchWriteupUrl` falls back
      // to raw `fetch()`, which stays CORS-limited and degrades to the hue emblem.
      const html = await fetchWriteupUrl(target.url);
      const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      return m ? m[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}
