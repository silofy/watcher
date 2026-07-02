/**
 * Cloud coaching providers (Claude / OpenAI / OpenRouter / Gemini). Opt-in and off by default: sending a command
 * to a cloud model contradicts the "your session never leaves the device" guarantee, so this path is
 * a deliberate trade the user makes. Two safeguards ride along: the prompt is redacted (IPs, creds,
 * flags stripped) before it leaves, and the API key stays native-side — the webview only ever calls
 * cloud_generate, never holds the key.
 */
import type { GenOptions, LlmProvider } from "./provider";
import { redactText } from "../redact";
import { isDesktop } from "../net";

export type CloudName = "anthropic" | "openai" | "gemini" | "openrouter";

/** Default model per provider. Configurable — override via the CloudProvider constructor. OpenRouter
 *  takes a namespaced model id (provider/model); this default routes to GPT-4o through it. */
export const CLOUD_DEFAULT_MODEL: Record<CloudName, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
  gemini: "gemini-1.5-pro",
  openrouter: "openai/gpt-4o",
};

export const CLOUD_LABEL: Record<CloudName, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

/** Pull a JSON object out of a model reply that may wrap it in prose or a ```json fence. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body.trim();
}

export async function hasApiKey(provider: CloudName): Promise<boolean> {
  if (!isDesktop()) return false;
  const { invoke } = await import("@tauri-apps/api/core");
  return (await invoke("has_api_key", { provider })) as boolean;
}

export async function setApiKey(provider: CloudName, key: string): Promise<void> {
  if (!isDesktop()) throw new Error("The API key can only be saved in the desktop app.");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_api_key", { provider, key });
}

export async function clearApiKey(provider: CloudName): Promise<void> {
  if (!isDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_api_key", { provider });
}

/**
 * A cloud model behind the deterministic-first seam. generateJson redacts the prompt, sends it to the
 * provider via the native command, and parses the JSON reply — returning null (rules-only) on any
 * failure, exactly like the local providers.
 */
export class CloudProvider implements LlmProvider {
  readonly name: string;
  constructor(
    private readonly provider: CloudName,
    private readonly model: string = CLOUD_DEFAULT_MODEL[provider],
  ) {
    this.name = `cloud:${provider}`;
  }

  available(): Promise<boolean> {
    return hasApiKey(this.provider);
  }

  async generateJson(prompt: string, _opts?: GenOptions): Promise<unknown | null> {
    if (!isDesktop()) return null;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const system = "You are a security-coaching assistant. Respond with a single JSON object only — no prose, no markdown fences.";
      const redacted = redactText(prompt); // strip IPs / creds / flags before it leaves the machine
      const text = (await invoke("cloud_generate", { provider: this.provider, model: this.model, system, prompt: redacted })) as string;
      return JSON.parse(extractJson(text));
    } catch {
      return null;
    }
  }
}
