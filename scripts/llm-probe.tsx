/**
 * Probe the offline LLM setup (brief §5.1): report the hardware tier and whether a local Ollama is
 * reachable. With a model present it refines one episode; without one it confirms rules-only mode.
 *
 *   vite-node scripts/llm-probe.tsx
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WatcherReport } from "../src/types/report";
import { probeHardware, selectTier, resolveProvider, refineClassification } from "../src/lib/llm";

const hw = probeHardware();
const tier = selectTier(hw);
const provider = await resolveProvider();

/* eslint-disable no-console */
console.log(`Hardware: ${hw.ramGb} GB RAM · ${hw.cores} cores · GPU ${hw.hasGpu ? "yes" : "no"}`);
console.log(`Model tier: ${tier.name} → ${tier.model} ${tier.quant} (num_ctx ${tier.numCtx}) — ${tier.strategy}`);
console.log(`Provider: ${provider.name}${provider.name === "rules-only" ? " (no Ollama at 127.0.0.1:11434 — deterministic only)" : ""}`);

const report = JSON.parse(readFileSync(resolve("fixtures/session-htb-easy.json"), "utf8")) as WatcherReport;
const ep = report.episodes.find((e) => e.binary === "nmap")!;
const refined = await refineClassification(provider, ep);
console.log(`\nSample refinement (#${ep.seq} ${ep.binary}):`);
console.log(`  prior:   ${ep.tactic} (confidence ${ep.confidence})`);
console.log(`  refined: ${refined.tactic} (confidence ${refined.confidence})${refined.tactic === ep.tactic ? "  [prior kept]" : "  [overridden]"}`);
