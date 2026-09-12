# AS-80 progress (developer-lena) — COMPLETE, ready for review

Commit: **f15d810** on `feat/AS-80-close-clears-every-interval` (only commit; diff = 1 file,
`apps/chat/test/stream.test.js`, +37/-9).

- [x] Reworked the line-449 case per plan §4. Zero production change.
- [x] Host: 480 pass / 0 fail / 0 skipped, 31 test files.
- [x] AC-1 grep: old name 0 occurrences, new name 1.
- [x] Compose counted run, `-p as80test`, `--build`: exit 0, receipt line ` Image as80test-test Built`,
      **tests 480 / pass 480 / fail 0**. Network `as80test_default` removed afterwards.
      Marker written: scratchpad/agent-cto-owen/lanes/AS-80-compose-done.
- [x] M1 (delete `clearInterval(loopPoll)`, line 1074): whole suite 480/479 pass/1 fail,
      failing set = {T1} exactly, message `close() left 1 interval(s) armed`. Restored, sha equal,
      `git status` empty, re-run 480/480.
- [x] M2 (delete `clearInterval(heartbeat);`, line 1073): narrowed run only. Control 1/1 pass;
      mutated 1 test / 0 pass / 1 fail, exit 1, runner exited on its own, same message.
      Restored, sha equal, `git status` empty, whole suite 480/480.
- [x] Lattice comment posted from the main checkout.

## Findings (outside the criteria list)

F-1 — AC-7's compose expectation (478, host-minus-compose delta 2) is not reproducible.
Host and compose run the IDENTICAL 480-case set (full name-list diff, 0 differing in either
direction — `diff-names.mjs`). 478 is AS-82's receipt taken on its own branch at 9d32a0c.
True delta is 0.

F-2 — the branch base is 8 commits behind master and does NOT contain d815848 (the AS-73 code
merge). Master's host count today is 486; this branch's is 480. Expect 486 after the --no-ff
merge. No conflict risk (AS-73 touched check-org.js, personnel.js, org-chart.js and three other
test files). I deliberately did not merge master into the branch.

F-3 (minor) — node's summary repeats a failing name under `failing tests:`, so `grep -c '^✖'`
reports 3 for one failing case under M1. Distinct-name cardinality is 1; `ℹ fail 1`.

## Artifacts in this directory
`host.txt`, `compose.txt`, `compose-run.mjs`, `diff-names.mjs`, `since-receipt.mjs`,
`m1.mjs` + `m1-observed.txt` + `m1-restored.txt`, `m2.mjs` + `m2-control.txt` + `m2-observed.txt`.
(`m1.sh`/`m1-mutate.mjs` were a first shell-based draft, superseded by `m1.mjs`.)
