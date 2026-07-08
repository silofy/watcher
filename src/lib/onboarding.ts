/** First-run wizard gating. Pure so it's testable in the node vitest env; all DOM/localStorage
 *  access lives in the store's guarded reader. */
export const ONBOARDED_KEY = "watcher.onboarded";
export const ONBOARDED_VALUE = "1";

/** Should the first-run wizard be open on load? `force` is the ?onboarding=1 dev override. */
export function shouldOpenOnboarding(input: { stored: string | null; force: boolean }): boolean {
  if (input.force) return true;
  return input.stored !== ONBOARDED_VALUE;
}

/** Number of steps in the activation flow. */
export const STEP_COUNT = 4;

/** Keep a step index within the valid range. */
export function clampStep(n: number): number {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > STEP_COUNT - 1) return STEP_COUNT - 1;
  return Math.floor(n);
}

/** The header "finish setup" pill shows once onboarding is dismissed but no real run exists yet. */
export function shouldShowNudge(input: { onboarded: boolean; hasRealCapture: boolean }): boolean {
  return input.onboarded && !input.hasRealCapture;
}

/** The step ④ recap list. Capture completion is derived from app state, not stored. */
export function deriveChecklist(input: { demoDone: boolean; hasRealCapture: boolean; aiDone: boolean }): { key: "demo" | "capture" | "ai"; label: string; done: boolean }[] {
  return [
    { key: "demo", label: "Watched a demo run", done: input.demoDone },
    { key: "capture", label: "Captured your own run", done: input.hasRealCapture },
    { key: "ai", label: "Turned on AI coaching", done: input.aiDone },
  ];
}
