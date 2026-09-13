# AS-76 cycle-1 rework — verifying §4.5 T-A by executing it

Ruben's cycle-1 review found T-A wrong by application: he applied it to a scratch copy
and counted three reds where it predicted one. The fix is only credible the same way, so
T-A as rewritten was applied end-to-end and then broken on purpose.

## Setup

    rsync -a --exclude node_modules --exclude .git apps/invoicing/ <scratch>/
    rm <scratch>/.env.local              # rsync brings the gitignored secrets file; delete it
    rsync -a <ruben's scratch>/node_modules/ <scratch>/node_modules/   # read-only reuse; npm is offline here
    node --test test/dependency-policy.test.js     ->  tests 13 | pass 13 | fail 0   (baseline)
    node --test test/harness.test.js               ->  tests  4 | pass  4 | fail 0   (baseline)

Host-side note: `test/deploy-shape.test.js` cannot run outside the container on any
copy — it reads `APP_DIR/.dockerignore`, which is the *repo-root* file the Dockerfile
`COPY`s into `/app`. Pre-existing, unrelated to this task, not a finding.

## Applying the corrected T-A — `apply-ta.js`

Step 0 (split) + step 1 (two SANCTIONED entries, 3 -> 5) + step 2 (63 -> 67 and the four
sorted paths) + four stub `lib/telemetry` modules with the right lexical shape. Every
line number the note cites is asserted as an anchor before anything is written; two
anchors were off by one against a first reading and were corrected against the file.

    dependency-policy.test.js: 1198 -> 1086 lines (cap 1200)

Then `test/harness.test.js`: 23 -> 24 and `'source-text.test.js'` into
`EXPECTED_TEST_FILES` (**found by running harness.test.js, not by reading** — the first
pass missed it entirely, which is now recorded in T-A step 0).

    node --test test/harness.test.js test/dependency-policy.test.js test/source-text.test.js
    ->  tests 17 | pass 17 | fail 0        (baseline equivalent: 13 + 4 = 17)

## Breaking it — `f6-check.js`, `f6-check-b.js`

Each mutation asserted applied at the intended site first; file restored from the
in-memory original after; restoration verified by byte comparison.

| mutation | predicted (first draft) | observed |
|---|---|---|
| (a) delete the telemetry transport entry **and** decrement 5 -> 4 | cardinality + outbound-client | **outbound-client only** |
| (b) delete the entry, leave the literal at 5 | not predicted | **cardinality/stale arm + outbound-client** |
| (c) keep the entry, rewrite the pinned line | stale-entry arm only | **stale arm + outbound-client** |

Both first-draft predictions were wrong. Cause, now in the note: the sanction cardinality
test and the outbound-client test are backed by the *same* `scanForbidden` walk, so any
mutation that leaves a real `fetch` or transport import unsanctioned reddens the
outbound-client test as well as whatever arm it was aimed at.

## What this does and does not establish

Establishes: T-A is executable as written, the guard is green with it applied, and the
guard still bites in three directions. Does not establish anything about the telemetry
code AS-77 will write — the four modules here are stubs chosen for their lexical shape.
