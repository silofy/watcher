# Offline LLM refinement (§4.2, §4.3, §5.1)

The semantic layer on top of the deterministic pipeline. **Deterministic-first**: the LLM only ever
refines compact cards (classification, objective-equivalence), never raw bytes, and is fully
optional — with no model, everything runs **rules-only** and the deterministic priors stand.

```
npm run llm:probe        # hardware tier + Ollama reachability + a sample refinement
```

## Pieces

- **`hardware.ts`** — `selectTier(profile)` picks the largest model that fits and degrades to
  rules-only (brief §5.1 table: 24GB+GPU → 8B Q6_K · 16GB → 8B Q4_K_M · 8GB → 3B · else rules-only).
- **`grammar.ts`** — a llama.cpp **GBNF grammar** and an Ollama **JSON schema** so a quantized model
  can't drift out of JSON; both bounded by the same tactic set.
- **`provider.ts` / `ollama.ts`** — the provider seam. `NullProvider` is rules-only; `OllamaProvider`
  talks to a local Ollama (structured outputs, temperature 0.15 for reproducibility). `resolveProvider`
  uses Ollama if reachable, else NullProvider. Nothing leaves the machine.
- **`refine.ts`** — the two passes the LLM is allowed to touch:
  - `refineClassification` — confirm/override an episode's MITRE tactic (the table is the prior;
    the model's tactic is adopted only above a confidence threshold).
  - `judgeEquivalence` — did this episode satisfy this golden objective (§4.3's only LLM role).
  - `refineReport` — refine every episode; **rules-only is a verified no-op**.

## Reproducibility

Low temperature + constrained decoding keep the model in valid JSON, and the deterministic-first
gate means a re-run with no model (or a flaky model) yields the same report the pipeline produced.
The model runs as a **Tauri sidecar** (Ollama/llama.cpp) in the app; this module is node-side (it
never enters the browser bundle).

## Tauri sidecar

The desktop shell manages Ollama as a sidecar (brief §5.1). `src-tauri/src/llm.rs` exposes two
commands — `ollama_status` (dependency-free raw HTTP probe, no webview CORS) and `start_ollama`
(spawns `ollama serve` from PATH). The header's **LLM status chip** (`runtime.ts` +
`LlmStatusChip.tsx`) shows `ollama`/`rules-only` live and, on the desktop, starts the sidecar on
click. In a plain browser it probes directly and degrades to rules-only.

## To enable on your machine

```
ollama serve && ollama pull llama3.1:8b     # this box probes to the "default" tier
npm run llm:probe                            # CLI: now shows provider: ollama
npm run tauri dev                            # desktop: the chip flips to "LLM · ollama"
```
