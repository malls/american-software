# AS-12: chat: harden assignmentsByActor against prototype-chain task fields

**Complexity: low.** Fully-specified bug — Priya located both leaks and named the fix in the task description; this plan just pins it down.

## Approach

In `apps/chat/lib/lattice.js` `assignmentsByActor()` (lines 92–118), per Priya's sketch:

1. Replace the in-flight filter `task.status in IN_FLIGHT_RANK` with `Object.hasOwn(IN_FLIGHT_RANK, task.status)` — `in` walks the prototype chain, so `"constructor"`/`"toString"` statuses pass and render phantom work.
2. Accumulate in a `Map` instead of a plain object (`??=` on a plain object reads `Object.prototype` for `assigned_to: "__proto__"`, so the subsequent `.push` throws — blanking the whole roster via /api/roster's try/catch and crashing `chat roster`). Sort/shape within the Map, then `return Object.fromEntries(map)` — `fromEntries` uses CreateDataProperty, so a `"__proto__"` key becomes a safe own property.
3. Regression tests in `apps/chat/test/lattice.test.js` with hostile task fixtures rebuilt from the description: (a) `status: "constructor"` — excluded from results; (b) `assigned_to: "__proto__"` — no throw, task appears under an own `"__proto__"` key, other actors' rosters unaffected.

## Key files

- `apps/chat/lib/lattice.js` — the fix (assignmentsByActor only)
- `apps/chat/test/lattice.test.js` — regression tests

## Acceptance criteria

- Both repro shapes covered by tests: `status: "constructor"` filtered out; `assigned_to: "__proto__"` handled without TypeError and without touching Object.prototype.
- Existing behavior unchanged for well-formed tasks (same keys, same rank/recency ordering, same shape of returned entries).
- Full chat test suite green — currently 83 tests; must be 83 + the new regression tests, all passing.
