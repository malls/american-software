# AS-18: Chat: pin employees in the DM sidebar; sort unpinned DMs by team prefix

Board request (chat DM @human:forrest, msg 118, 2026-08-30 17:49), verbatim: "also, we should be able to pin employees in the DM list section, then otherwise sort them by team prefix." Interpretation left to the planner, with hints: pinning is a per-viewer preference (localStorage is the established per-viewer store — identity already lives there); "team prefix" most cheaply reads as the actor-id role prefix (developer-, qa-, pm-, ceo-, cto-), though personnel frontmatter also carries a team: field via apps/chat/lib/personnel.js (AS-8) — planner picks one and says why. Touches the AS-8 roster/DM sidebar rendering.

Planned by cto-owen, 2026-08-31. Complexity: medium-small. Plan against post-AS-25 UI (SSE push, AS-23 drawer).

## Current reality (what "the DM list section" is)

Post-AS-8/AS-23/AS-25 the sidebar has three lists (`public/index.html`):

- `#channel-list` — channels. Untouched by this task.
- `#roster-list` — every **active employee** (from `/api/roster`, i.e. personnel frontmatter joined with Lattice work + DM state), rendered by `rosterRow()` in `public/app.js`, currently in the order the server returns: `readRoster()` sorts **by name** (`lib/personnel.js:91`). This *is* the "DM list section" the board means — clicking a row opens/creates the DM.
- `#dm-list` — non-roster DMs only (other member has no active dossier: `human:forrest`, departed employees), currently in `/api/conversations` order.

`renderSidebar()` is a pure re-render from `state` (AS-25); it is called by the fetch path (`refreshSidebar`: initial load, catch-up, 60s reconcile) *and* directly by push-frame badge bumps. Any ordering we add must be a deterministic function of state so re-renders never shuffle rows.

## Design decisions

### 1. Pin state lives in localStorage, keyed per identity — `chat.pins.<me>`

- **Per-viewer, zero backend.** A pin is a UI preference of the person looking at the sidebar, not company data: it does not belong in the chat DB, does not appear in exports, and needs no durability guarantee beyond the browser profile. localStorage is the established per-viewer store here (`chat.me`, same file).
- **Keyed by identity**, not global: the sidebar is identity-relative (unread, DM ids), and this browser is routinely used to view as different identities via the picker. Key: `chat.pins.` + the actor id (e.g. `chat.pins.human:forrest`). Value: JSON array of pinned actor ids.
- **All reads/writes wrapped in try/catch** (house pattern — see the `chat.me` accesses); a missing/corrupt value degrades to "no pins", never a crash. Non-arrays and non-string members are discarded on load.
- Identity switch (picker `change` handler) reloads pins for the new identity before `refreshSidebar()`.

### 2. "Team prefix" = the actor-id role prefix, not the frontmatter `team:` field

Chosen: the segment of the actor id between `:` and the first `-` — `agent:developer-marcus` → `developer`, `agent:qa-priya` → `qa`, `agent:cto-owen` → `cto`. Why:

- **It matches the request verbatim.** Employees are literally "prefixed by type" (CLAUDE.md hiring conventions); the prefix is the visible naming scheme the board is referring to. The frontmatter `team:` field is coarser (engineering = developer + qa; leadership = ceo + cto) and is a different word than the one used.
- **It is total.** Every row in both lists has an actor id; only active-roster rows have a `team:` field. One comparator therefore sorts `#roster-list` *and* `#dm-list` (and survives the AS-8 degradation contract where the roster endpoint fails and everything falls back to `#dm-list`). `human:forrest` and departed agents sort by the same rule without special cases.
- **No schema coupling.** No new dependency on the personnel frontmatter parser contract.

Ordering: prefix groups in plain lexicographic order (ceo, cto, developer, qa, researcher, …) — no hand-maintained rank table to drift when new titles are hired. Tie-break within a group: `displayName`/`name` localeCompare (preserves today's behavior within groups).

### 3. Pinned rows float to the top of `#roster-list`, sorted by the same comparator

- Pinned employees render first, then all unpinned, each group internally sorted by (prefix, name). Deterministic — pin order in localStorage does not matter, so toggle churn never reorders unexpectedly. (Manual drag-ordering of pins is out of scope; nobody asked for it.)
- **Scope: pins apply to roster rows only.** The board said "pin *employees*"; `#dm-list` holds non-employees and departed staff. `#dm-list` still gets the comparator (sorted by other-member prefix, then display name) so the whole sidebar obeys one rule, but no pin affordance there.
- The self row ("(you)") sorts by the same rule and gets **no pin button** (it is inert — you cannot DM yourself).
- Pinned rows get class `pinned`; the filled glyph is the primary indicator (no separator element, no fourth list — keep the DOM shape AS-23's CSS knows about).

### 4. Pin affordance: always-visible toggle button, touch-first

Post-AS-23 this UI is used on phones; hover-revealed controls are invisible on touch. So:

- A `<button class="pin-toggle">` on each non-self roster row's top line (inside `.roster-top`, after the name/badge), textContent glyph — `☆` unpinned / `★` pinned (text glyphs, house rule: textContent only, no innerHTML/SVG).
- Always visible; unpinned state at reduced opacity (raised on row hover for pointer devices — progressive enhancement, not the baseline).
- Hit target ≥ 32px square via padding at the ≤700px breakpoint (match the AS-23 `padding: 10px 16px` pattern), smaller at desktop.
- `click` handler calls `e.stopPropagation()` — same pattern as the work-status `ref-link` — so toggling never opens the DM. Toggle updates `state.pins`, persists, then calls `renderSidebar()` directly (no fetch, AS-25 style).
- a11y: `aria-pressed` reflecting pinned state, `aria-label` "Pin <name>" / "Unpin <name>".

### 5. Interaction with unread badges / push / 60s reconcile: none by construction

Pins live in `state.pins` (a Set) + localStorage; ordering is a pure function of `(roster, conversations, pins)`. Push-frame badge bumps and the 60s reconcile both funnel through `renderSidebar()`, which re-sorts identically every time — order changes only when pins change or headcount changes. No changes to `refreshSidebar()`'s fetch logic, `/api/*`, or the server. Server untouched entirely.

## Implementation

### New file: `public/dm-sort.js` (pure module, house extraction pattern)

Like `url-state.js` / `live.js` / `scroll.js` / `thread-modal.js`: no DOM, no storage, importable by node tests.

```js
export function teamPrefix(actorId)            // 'agent:developer-marcus' -> 'developer'; 'human:forrest' -> 'forrest'; no '-' -> whole local part; malformed -> '' (sorts first, harmless)
export function rosterOrder(roster, pinnedIds) // -> new sorted array: pinned first; each group by (teamPrefix(actorId), name)
export function dmOrder(dms, otherIdOf, nameOf)// -> new sorted array by (teamPrefix(otherId), displayName); no pin tier
export function togglePin(pins, actorId)       // -> new array with actorId added/removed (idempotent, deduped)
export function sanitizePins(raw)              // JSON.parse result -> string[] (non-array/junk -> [])
```

(Exact signatures at the implementer's discretion; the contract is: pure, deterministic, total over malformed input.)

### `public/app.js` (only client file with logic changes)

1. `state.pins` (Set). `loadPins(me)` / `savePins(me, pins)` helpers wrapping localStorage with try/catch, using `sanitizePins`.
2. `loadIdentities()` end + identity-picker `change` handler: load pins for `state.me`.
3. `renderSidebar()`: replace `state.roster.map(rosterRow)` with `rosterOrder(state.roster, state.pins).map(rosterRow)`; sort `dms` with `dmOrder` before mapping; pass nothing else new.
4. `rosterRow(emp)`: add the pin button for non-self rows (glyph, aria, stopPropagation, toggle→persist→`renderSidebar()`); add `pinned` class when pinned.
5. Import the new module at top.

### `public/style.css`

`.pin-toggle` (size, opacity states, no default button chrome), `.roster-row.pinned` (subtle emphasis is enough — e.g. name stays as-is, glyph carries the state), ≤700px hit-target bump alongside the existing AS-23 block.

### `public/index.html`

Likely **no change** (button is built in JS). If a change proves needed, keep the three-list structure.

### New file: `test/dm-sort.test.js`

`node:test`, importing `../public/dm-sort.js` (same pattern as `test/url-state.test.js`):

- `teamPrefix`: agent/human/system ids, multi-hyphen names (`agent:qa-automation-manager-alice` → `qa`), no-hyphen local part, malformed input.
- `rosterOrder`: groups by prefix lexicographically; name tie-break inside a group; pinned float to top and are themselves comparator-sorted; pins referencing absent ids are ignored; input array not mutated.
- `dmOrder`: sorts non-roster DMs by other-member prefix then name; stable over identical keys.
- `togglePin` / `sanitizePins`: add, remove, dedupe, junk input → `[]`.

## Guards (byte-identical suites)

- **Every existing test file passes unchanged** — `npm test` (i.e. `node --test`) in `apps/chat`, zero modifications to existing `test/*.test.js`. This change is client-rendering + one new pure module; nothing it touches is under existing test.
- Server (`server.js`, `lib/*`) untouched — API responses byte-identical.
- No URL-state changes (AS-9 projection invariant: pins are a view preference, never in the URL), no drawer behavior changes (AS-23), no stream/poll changes (AS-25).

## Acceptance criteria

1. Each non-self roster row has an always-visible pin toggle; tapping it pins/unpins without opening the DM (and without closing the AS-23 drawer).
2. Pinned employees render at the top of the roster list; unpinned employees group by actor-id prefix (lexicographic), name-sorted within a group. `#dm-list` sorts by the same comparator (no pins).
3. Pins persist across reloads (localStorage `chat.pins.<me>`), are per-identity (switching the picker shows that identity's pins), and corrupt/missing storage degrades to no-pins without error.
4. Order is stable across push-frame badge bumps and the 60s reconcile — only a pin toggle or roster change reorders rows.
5. Pin button has `aria-pressed` + descriptive `aria-label`; hit target at the mobile breakpoint is comfortably tappable (≥ ~32px).
6. `npm test` green: all existing suites byte-identical and passing, new `test/dm-sort.test.js` covering the pure logic above.
7. No server, API, export, or URL-state changes.
