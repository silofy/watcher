/**
 * Deep-link from a summary view to its detail. The debrief's supporting sections live in collapsed
 * `<details name="debrief-details">` accordions, each wrapped in a div with a known id (see App.tsx:
 * path / bridge / unfolded / frameworks / deviated / stealth / log). Opening one closes the rest
 * (native `name` grouping), so this both expands the target and scrolls it into view.
 */
export function openDetail(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const details = el.querySelector("details");
  if (details && !details.open) details.open = true;
  // let the accordion paint its expanded height before scrolling to it
  requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
}
