// scroll.js — sticky-bottom scroll primitive for the chat panes (AS-17).
// No DOM construction, no fetch, no globals: importable from the browser
// (app.js) and from node:test alike (same pattern as url-state.js). The only
// DOM interaction is reading/writing scroll metrics on the pane it is handed —
// any scrollable element works, so AS-19's redesigned thread container can
// consume it unchanged.

/**
 * Is the reader pinned (within `slack` px) to the bottom of a scrollable pane?
 *
 * Degenerate metrics count as "at bottom" — the harmless answer:
 * - all zeros (hidden pane): scrolling it is a no-op anyway;
 * - clientHeight >= scrollHeight (no scrollbar): there is only one position.
 *
 * @param {{ scrollTop: number, scrollHeight: number, clientHeight: number }} metrics
 *   Any object carrying the three metrics — a real element or a plain object.
 * @param {number} slack  Pixel tolerance below which the reader still counts
 *   as at-bottom (matches the pre-AS-17 main-pane heuristic of 40).
 * @returns {boolean}
 */
export function isAtBottom(metrics, slack = 40) {
  const { scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = metrics || {};
  if (clientHeight >= scrollHeight) return true; // no scrollbar / hidden pane
  return scrollHeight - scrollTop - clientHeight < slack;
}

/**
 * Re-render a scrollable pane with "sticky bottom" semantics (what every
 * mainstream chat client does):
 * - forceBottom          -> jump to the (new) bottom, unconditionally;
 * - reader was at bottom -> follow new content to the new bottom;
 * - reader scrolled up   -> restore the measured scrollTop exactly.
 *
 * The restore is explicit rather than relying on the browser retaining
 * scrollTop across replaceChildren's remove-all-then-insert — that retention
 * is engine behavior we choose not to depend on.
 *
 * @param {Element|object} pane    The scrollable element being re-rendered.
 * @param {() => void} render      Callback that replaces the pane's content.
 * @param {{ forceBottom?: boolean }} [opts]
 */
export function renderPreservingScroll(pane, render, { forceBottom = false } = {}) {
  const savedTop = pane.scrollTop;
  const wasAtBottom = isAtBottom(pane);
  render();
  if (forceBottom || wasAtBottom) pane.scrollTop = pane.scrollHeight;
  else pane.scrollTop = savedTop;
}
