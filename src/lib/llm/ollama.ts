/**
 * Offline Ollama backend. Talks to a local Ollama server (default 127.0.0.1:11434) — managed as a
 * Tauri sidecar in the app. Uses structured outputs (the `format` schema) so the model stays in
 * valid JSON, with a low temperature for reproducibility. Nothing leaves the machine.
 */
import type { GenOptions, LlmProvider } from "./provider";

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";
  constructor(
    private url: string = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
    private model: string = process.env.OLLAMA_MODEL ?? "llama3.1:8b",
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
