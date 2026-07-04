/** The Deep dive panel's tab config — pure data + a type guard, no rendering here (see
 *  `../components/DeepDive`). Order is the tab order shown in the UI. */
export type DeepDiveTabId = "timeline" | "stealth" | "deviation" | "frameworks" | "findings" | "log";

export interface DeepDiveTab {
  id: DeepDiveTabId;
  label: string;
}

export const DEEP_DIVE_TABS: DeepDiveTab[] = [
  { id: "timeline", label: "Timeline" },
  { id: "stealth", label: "Stealth & noise" },
  { id: "deviation", label: "Time lost" },
  { id: "frameworks", label: "Frameworks" },
  { id: "findings", label: "Findings" },
  { id: "log", label: "Command log" },
];

export function isDeepDiveTab(id: string): id is DeepDiveTabId {
  return DEEP_DIVE_TABS.some((t) => t.id === id);
}
