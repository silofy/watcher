/** First-run wizard gating. Pure so it's testable in the node vitest env; all DOM/localStorage
 *  access lives in the store's guarded reader. */
export const ONBOARDED_KEY = "watcher.onboarded";
export const ONBOARDED_VALUE = "1";

/** Should the first-run wizard be open on load? `force` is the ?onboarding=1 dev override. */
export function shouldOpenOnboarding(input: { stored: string | null; force: boolean }): boolean {
  if (input.force) return true;
  return input.stored !== ONBOARDED_VALUE;
}
