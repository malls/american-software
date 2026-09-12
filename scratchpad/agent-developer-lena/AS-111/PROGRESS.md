# AS-111 progress — agent:developer-lena (tick watcher:78911 loop tick 20)

Branch `feat/AS-111-events-residuals`, worktree `.worktrees/AS-111`, base dd6a41e (code == master aeeca77).
STATUS: implementation complete; all four findings committed; 11/11 mutants run; scratch worktree removed.

## Baselines (before any change, at dd6a41e)
- Host `node --test` (apps/chat): 605 / 603 pass / 0 fail / 2 skipped — matches plan §0.
- Compose `asc-impl-as111`: `Image asc-impl-as111-test Built`, 605 / 597 / 0 / 8 (compose-base.log).

## Commits (F1 → F2 → F4 → F3, one per finding, plus one F3 guard-strengthening)
- F1 610dfe9 — test/api.test.js `api-events-since-resolves-before-task-filter`.
- F2 d286c25 — server.js lanesKey.events {reason, open}; `stream-lanes-no-frame-for-laneless-event`.
- F4 1d18552 — lib/events.js (shape + checkCycle + matches), bin/events.js (usage, closing, buildData), watcher closeOpen cycle, README; `events-close-matches-cycle`, `events-cli-close-lookup-honours-cycle`.
- F3 517eb5c — server.js tailEvents ino + lastBytes window, 'replaced' code, lanes.js sentence, README; `stream-company-replaced-new-inode`, `stream-company-replaced-same-inode`.
- F3 38afbc1 — the two replaced tests end with a laneless tick_started clear (M4 survivor fix, see below).

## Final counts (tip 38afbc1)
- Host: 611 / 609 / 0 / 2 (host-final.log) — exact to §5.
- Compose at 517eb5c: `Image asc-impl-as111-test Built`, 611 / 603 / 0 / 8 (compose-after.log) — exact to §5.
- Compose at 38afbc1: see compose-final.log (run launched; result recorded in the Lattice comment if it landed in time).

## Mutants (§3) — 11 run, 11 red, 0 survivors at the end; 3 deviations recorded
- M1 exact. M2 exact. M3 exact.
- M4: SURVIVED on the first cut (guard weakness, mutation at the right site line 621): both replacement fixtures move a lane, so the frame carrying 'replaced' was earned by lane fields. Fixed in 38afbc1 (laneless tick_started clear → exactly one lanes frame for the reason alone). Re-run: exact.
- M5 exact. M6 exact. M7 exact. M8 exact.
- M9: WIDER — {events-close-matches-cycle, events-cli-close-lookup-honours-cycle}. `events open` derives from the fold, so the CLI test's "cycle-2 still open" check sees the fold's rule too. M10 red on the CLI test alone shows closing() is separately guarded.
- M10 exact.
- M11: NARROWER — stream-company-truncation stayed green: it never asserts its AS-9 stage_ended closed the stage (only that reason clears). Prediction over-counted; fixture unchanged.

## Tooling note
- My first run-host.mjs / mutants.mjs parsers looked for TAP (`# tests`, `not ok`); node prints spec (`ℹ tests`, `✖ name`). Counts were always real; failing-name lists were vacuous until fixed. All mutant results above are from the fixed parser (logs: mutant-M*.log).
