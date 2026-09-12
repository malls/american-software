// dm-sort.js — pure sidebar-ordering + pin logic for the chat UI (AS-18).
// No DOM, no storage, no globals: importable from the browser (app.js) and
// from node:test alike. All localStorage / rendering side effects live in
// app.js.
//
// Ordering contract (the whole sidebar obeys one rule):
//   - roster rows: pinned first, then unpinned; BOTH tiers sorted by
//     (teamPrefix(actorId), name).
//   - non-roster DM rows: (teamPrefix(otherId), displayName). No pin tier —
//     pins apply to employees only.
// Prefix groups sort in plain lexicographic order (ceo, cto, developer, qa,
// …) — no hand-maintained rank table to drift when new titles are hired.
// Every function is total over malformed input: junk degrades, never throws.

/**
 * Role prefix of an actor id — the segment between ':' and the first '-'.
 *   'agent:developer-marcus'             -> 'developer'
 *   'agent:qa-automation-manager-alice'  -> 'qa'
 *   'human:forrest'                      -> 'forrest'   (no '-': whole local part)
 * Malformed (non-string, no ':', empty local part) -> '' (sorts first, harmless).
 */
export function teamPrefix(actorId) {
  if (typeof actorId !== 'string') return '';
  const colon = actorId.indexOf(':');
  if (colon < 0) return '';
  const local = actorId.slice(colon + 1);
  const dash = local.indexOf('-');
  return dash < 0 ? local : local.slice(0, dash);
}

/** Plain lexicographic compare for prefix groups (no locale surprises). */
function cmpPrefix(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Name tie-break: localeCompare, matching the server's roster sort. */
function cmpName(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''));
}

/**
 * Order roster rows: pinned employees first, then unpinned; each tier sorted
 * by (teamPrefix(actorId), name). Deterministic in the roster + pin SET only —
 * pin insertion order never matters. Pins referencing absent ids are ignored
 * (they simply match no row). Returns a new array; never mutates the input.
 *
 * @param {Array<{actorId: string, name: string}>} roster
 * @param {Iterable<string>|null|undefined} pinnedIds Set or array of actor ids
 */
export function rosterOrder(roster, pinnedIds) {
  if (!Array.isArray(roster)) return [];
  const pins = new Set(pinnedIds || []);
  return roster.slice().sort((a, b) => {
    const tier = (pins.has(a.actorId) ? 0 : 1) - (pins.has(b.actorId) ? 0 : 1);
    if (tier !== 0) return tier;
    return (
      cmpPrefix(teamPrefix(a.actorId), teamPrefix(b.actorId)) || cmpName(a.name, b.name)
    );
  });
}

/**
 * Order non-roster DM conversations by (teamPrefix(otherId), displayName).
 * No pin tier. Stable over identical keys (Array.prototype.sort is stable).
 * Returns a new array; never mutates the input.
 *
 * @param {Array<object>} dms
 * @param {(dm: object) => string} otherIdOf  actor id of the other member
 * @param {(dm: object) => string} nameOf     display name for the row
 */
export function dmOrder(dms, otherIdOf, nameOf) {
  if (!Array.isArray(dms)) return [];
  return dms.slice().sort(
    (a, b) =>
      cmpPrefix(teamPrefix(otherIdOf(a)), teamPrefix(otherIdOf(b))) ||
      cmpName(nameOf(a), nameOf(b))
  );
}

/**
 * Toggle actorId's membership in the pin collection. Accepts any iterable of
 * ids (Set or array); returns a NEW deduped array — never mutates the input.
 */
export function togglePin(pins, actorId) {
  const set = new Set(pins || []);
  if (set.has(actorId)) set.delete(actorId);
  else set.add(actorId);
  return [...set];
}

/**
 * Sanitize a parsed localStorage value into a pin list: arrays keep their
 * string members (deduped, order preserved); everything else -> [].
 */
export function sanitizePins(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((x) => typeof x === 'string'))];
}
