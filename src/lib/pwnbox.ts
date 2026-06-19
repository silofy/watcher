/**
 * Pwnbox SSH sync config + invoker. The Watcher scp-pulls the in-Pwnbox agent's exports into
 * ~/.watcher/sessions/, where the existing live-bridge poll picks them up. Tauri-only; config lives
 * in localStorage (a host/user/key pointer — no secret material beyond a key PATH).
 */
export interface PwnboxConfig {
  enabled: boolean;
  host: string;
  user: string;
  port?: number;
  identity?: string; // path to a private key (optional; agent/default key otherwise)
  remoteDir?: string;
}

const KEY = "watcher.pwnbox";
const DEFAULT: PwnboxConfig = { enabled: false, host: "", user: "", remoteDir: "~/.watcher-exports" };

export function loadPwnboxConfig(): PwnboxConfig {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT };
  } catch {
    return { ...DEFAULT };
  }
}

export function savePwnboxConfig(c: PwnboxConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable */
  }
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Pull new exports from Pwnbox. Returns the filenames newly landed locally. Throws on SSH failure. */
export async function pullPwnbox(c: PwnboxConfig): Promise<string[]> {
  if (!isTauri()) return [];
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke("pull_pwnbox", {
    host: c.host,
    user: c.user,
    port: c.port ?? null,
    identity: c.identity || null,
    remoteDir: c.remoteDir || null,
  })) as string[];
}
