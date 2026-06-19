/**
 * Offline LLM orchestration with hardware scaling (brief §5.1). Nothing leaves the machine: the
 * engine runs local quantized models as a Tauri sidecar (Ollama/llama.cpp). At first run it probes
 * RAM/cores/GPU, picks the largest model that fits, and degrades gracefully — all the way down to a
 * rules-only mode, which is possible only because the pipeline made the LLM optional for most steps.
 */
import os from "node:os";

export interface HwProfile {
  ramGb: number;
  cores: number;
  hasGpu: boolean;
}

export interface ModelTier {
  name: "high" | "default" | "low" | "rules-only";
  model: string;
  quant: string;
  /** num_ctx the summarizer targets at this tier. */
  numCtx: number;
  strategy: string;
}

/** Pick the largest model that fits the hardware (brief §5.1 table). Pure + deterministic. */
export function selectTier(p: HwProfile): ModelTier {
  if (p.hasGpu && p.ramGb >= 24) {
    return { name: "high", model: "llama3.1:8b", quant: "Q6_K", numCtx: 16384, strategy: "full pipeline, GPU layer offload" };
  }
  if (p.ramGb >= 16) {
    return { name: "default", model: "llama3.1:8b", quant: "Q4_K_M", numCtx: 8192, strategy: "default target — the sweet spot" };
  }
  if (p.ramGb >= 8) {
    return { name: "low", model: "llama3.2:3b", quant: "Q4", numCtx: 4096, strategy: "smaller windows, heavier summarization" };
  }
  return { name: "rules-only", model: "none", quant: "-", numCtx: 0, strategy: "rules-only + MiniLM embeddings for equivalence" };
}

/** Probe the host (node-only). GPU detection is left to the sidecar; assumed false here. */
export function probeHardware(): HwProfile {
  return {
    ramGb: Math.round(os.totalmem() / 1024 ** 3),
    cores: os.cpus().length,
    hasGpu: false,
  };
}
