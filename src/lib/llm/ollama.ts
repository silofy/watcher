/**
 * Offline Ollama backend. Talks to a local Ollama server (default 127.0.0.1:11434) — managed as a
 * Tauri sidecar in the app. Uses structured outputs (the `format` schema) so the model stays in
 * valid JSON, with a low temperature for reproducibility. Nothing leaves the machine.
 */
import type { GenOptions, LlmProvider } from "./provider";

// `process` is undefined in the Vite browser build, so reading process.env.* directly at construction
// throws ReferenceError. `typeof` never throws, so this degrades to the default instead.
function envVar(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";
  constructor(
    private url: string = envVar("OLLAMA_URL") ?? "http://127.0.0.1:11434",
    private model: string = envVar("OLLAMA_MODEL") ?? "llama3.1:8b",
  ) {}

  async available(): Promise<boolean> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 600);
      const res = await fetch(`${this.url}/api/tags`, { signal: ctl.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  }

  async generateJson(prompt: string, opts: GenOptions = {}): Promise<unknown | null> {
    try {
      const body = {
        model: this.model,
        prompt,
        stream: false,
        format: opts.schema ?? "json",
        options: { temperature: opts.temperature ?? 0.1 },
      };
      const res = await fetch(`${this.url}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { response?: string };
      return data.response ? JSON.parse(data.response) : null;
    } catch {
      return null;
    }
  }
}
