/** Resolve a platform avatar image URL at runtime, under the user's own credentials.
 *  Never bundles third-party assets; any failure returns null so the caller keeps the hue emblem. */
const HTB_CDN = "https://labs.hackthebox.com";

export async function resolveAvatar(
  target: { platform: string; name: string; url?: string | null },
  creds: { htbToken?: string } = {},
): Promise<string | null> {
  try {
    if (target.platform === "htb" && creds.htbToken) {
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
      const res = await fetch(target.url);
      if (!res.ok) return null;
      const html = await res.text();
      const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
      return m ? m[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}
