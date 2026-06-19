// Auto-fetch a box write-up so the report can grade against the intended path (Layer 2).
//
// Source chain: HTB official (authenticated, you're already logged in) -> 0xdf -> IppSec notes.
// Only the box name/id ever leaves; the user's SESSION never does. Returns { text, source } | null.
// Best-effort + defensively parsed: external sites change, so failures are silent and we move on.

const MIN_LEN = 600; // ignore stubs / nav-only pages

/** Strip a fetched HTML page down to readable article text. */
export function htmlToText(html) {
  const body = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const slugify = (name) => String(name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** HTB's own write-up for the box (retired/VIP). Authenticated via the token the SPA already uses. */
async function fromHtbOfficial(id, token, log) {
  if (!id || !token) return null;
  try {
    const r = await fetch(`https://labs.hackthebox.com/api/v4/machine/writeup/${id}`, { headers: { Authorization: token } });
    log?.(`htb writeup ${id}: ${r.status} ${r.headers.get("content-type")}`);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    // Official write-ups are PDFs on presigned S3. If the API redirected us to the PDF, hand the
    // daemon the (no-auth) URL to fetch + extract. r.url is the final URL after redirects.
    if (ct.includes("application/pdf")) return { url: r.url, source: "htb-official" };
    const j = await r.json().catch(() => null);
    // Or the API hands back a link to the PDF.
    const link = j?.url ?? j?.message?.url ?? j?.data?.url ?? j?.message?.download ?? null;
    if (typeof link === "string" && /\.pdf/i.test(link)) return { url: link, source: "htb-official" };
    // Or inline text/markdown.
    const w = j?.message?.writeup ?? j?.writeup ?? j?.data ?? null;
    if (typeof w === "string" && w.length >= MIN_LEN && !/^JVBER/i.test(w)) return { text: w, source: "htb-official" };
    return null;
  } catch {
    return null;
  }
}

/** 0xdf: find the box's post via the sitemap (no date guessing), then fetch + clean it. */
async function from0xdf(name, log) {
  const slug = slugify(name);
  if (!slug) return null;
  try {
    const sm = await fetch("https://0xdf.gitlab.io/sitemap.xml");
    if (!sm.ok) return null;
    const xml = await sm.text();
    const re = new RegExp(`https://0xdf\\.gitlab\\.io/[0-9/]+/htb-${slug}\\.html`, "i");
    const url = xml.match(re)?.[0];
    log?.(`0xdf ${slug}: ${url || "no match"}`);
    if (!url) return null;
    const page = await fetch(url);
    if (!page.ok) return null;
    const text = htmlToText(await page.text());
    return text.length >= MIN_LEN ? { text, source: "0xdf" } : null;
  } catch {
    return null;
  }
}

/** IppSec notes (GitBook). Best-effort per-box page. */
async function fromIppsec(name, log) {
  const slug = slugify(name);
  if (!slug) return null;
  for (const url of [`https://notes.ippsec.rocks/htb/${slug}`, `https://notes.ippsec.rocks/machines/${slug}`]) {
    try {
      const r = await fetch(url);
      log?.(`ippsec ${slug}: ${r.status} ${url}`);
      if (!r.ok) continue;
      const text = htmlToText(await r.text());
      if (text.length >= MIN_LEN) return { text, source: "ippsec-notes" };
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Try each source in order; first usable write-up wins. */
export async function fetchWriteup({ machine_id, name }, token, log) {
  return (
    (await fromHtbOfficial(machine_id, token, log)) ||
    (await from0xdf(name, log)) ||
    (await fromIppsec(name, log)) ||
    null
  );
}
