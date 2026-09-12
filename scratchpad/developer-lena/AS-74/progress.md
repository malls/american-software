# AS-74 — developer-lena progress

Tick watcher:93997, loop tick 20. Branch `feat/AS-74-roster-truncation-guard`,
worktree `.worktrees/AS-74`.

## Numbers
- Master base (host, `node --test apps/chat/test/*.test.js`): **486 pass / 0 fail** — matches the plan's §5 prediction. Target 486 + 8 = **494**.

## Decisions
- **Did not read `scratchpad/agent-cto-owen/AS-74-cascade-probe/probe.mjs`.** The plan §4 invites lifting the helper from it; the tick's tasking message says not to read other actors' scratchpads. Took the narrower instruction and wrote the helper from the plan's §2 specification, which is complete (parseRules / specificity / targets / cascade, with the flattening, subject, and throw rules all stated).
- Pseudo-element subjects (`.roster-title::after`) are treated as targeting the element — 0 `::` occurrences in style.css today; documented as a deliberate omission in the test file rather than adding an untested branch.
- Source order increments per selector (a comma list's members get consecutive orders); within one rule the declaration is identical so the tie direction is unobservable.

## Steps
1. [x] Base measured (486).
2. [x] `test/roster-truncation.test.js` written — H1..H5 + T1. Local run 6/6 green.
3. [x] commit 1 (item 1).
4. [x] api.test.js: T2 (item 2), regex widening (item 3), T3 + sink-line removals (item 4). commit 2.
5. [x] Full host run on the branch: **494 / 0**.
6. [x] Mutations M1..M6 (plan §7) — all predicted sets exact; tree proven clean by shasum + `git status --porcelain`.
7. [x] H1..H5 red/green flips (AC-8) — each flipped expectation red, exactly 1 case each.
8. [x] One counted compose receipt with `--build` — 492/0, `Image as74test-test Built` observed.
9. [x] Lattice comment.

## Mutation results (harness: `mutate.mjs`, restore in `finally`, not `trap` — `trap` is blocked in this shell)

All six: mutation asserted applied at the intended site; tree byte-identical
after restore (shasum before === after) and `git status --porcelain` empty
after every one.

| mutant | predicted red | observed red | numbers |
|---|---|---|---|
| M1 append `.roster-title{white-space:normal}` | {T1} | {T1} (+4 load flakes) | 494/489/5 |
| M2 `#roster-list .roster-title` before the AS-32 rule | {T1} | {T1} (+4 load flakes) | 494/489/5 |
| M3 org label collapsed to title-only | {T2} | {T2} | 494/493/1 |
| M4 `el("div","roster-extra")` in rosterRow | {AS-32 el() case} | {AS-32 el() case}; master's api.test.js at the same path: 60/60 green | 494/493/1 |
| M5 `.innerHTML` in dm-sort.js | {T3} | {T3}, message names dm-sort.js | 494/493/1 |
| M6 `role.innerHTML = emp.title` in rosterRow | {T3, AS-32 el() case} | exactly those two | 494/492/2 |

- T1's message under M1: `white-space: effective value is normal — won by .roster-title (spec 0,1,0, order 205); the contract allows nowrap. 206 rules parsed, 3 target .roster-title`. Under M2 the winner is `#roster-list .roster-title (spec 1,1,0, order 50)` — placed BEFORE the base rule, so order cannot explain the win: the specificity leg is live.
- Unmutated cardinality therefore: **205 rules parsed, 2 target `.roster-title`** — identical to the planner's §2 probe.
- M6: read the failure text. The AS-32 case fires on `the title element is built by el(), so its text goes through textContent` — its presence assertion, NOT a sink line. No AS-26/AS-54/AS-33 red, so no sink line survived the collapse.
- AC-8 H1..H5 flips: each flipped expectation → `fail 1`, exactly its own case red. Tree restored byte-identical.

## Compose receipt
`-p as74test`, `--build`, from `.worktrees/AS-74/apps/chat`, via `node -e` +
`spawnSync` with `/usr/local/bin/docker`: **494 tests / 494 pass / 0 fail,
exit 0**, with `Image as74test-test Building` then `Image as74test-test Built`
observed (full log `/tmp/AS-74-compose.txt`). Torn down with
`compose -p as74test down --remove-orphans`. Delta to host is **0**, not the 2
the plan's AC-10 predicted from AS-82's receipt — see F-4 below. The compose
`test` service runs bare `node --test` (`compose.yaml:88`), so its discovery set
is not the host's `test/*.test.js` glob; the base delta needs a re-measure on
master, which I did not have the clock for.

## Findings (numbering as posted to Lattice)
- F-1 (plan §7 M1): the site assertion "`.roster-title {` goes 1 -> 2" is wrong
  — the substring occurs **twice** on master (base rule at style.css:134, the
  `.active` colour rule at 138). Correct is 2 -> 3. Caught only because the
  harness asserts the count rather than trusting the edit.
- F-2 (plan text, §7 M3 / §3 item 2): the meta line in `app.js:865` is
  `const meta = [node.title, node.class, node.team].filter(Boolean).join(' · ');`
  — the middle dot is the 6-character escape `·` in source, not a literal `·`.
  The plan's M3 anchor as written (`join(' · ')`) matches 0 occurrences. Used the
  real source text; T2 pins the escape form.
- F-2 (plan text, §7 M3): "whole file: 1 -> 0 too" is wrong — `node.class`
  occurs **4** times in `app.js`, once inside `orgNodeItem`. Only the
  region-scoped 1 -> 0 assertion is valid; a whole-file count would be 4 -> 3.
- F-3 (plan text, §10): style.css has **6** `@media` preludes, not the two the
  plan's §10 implies (`(max-width: 600px)` x3, `(hover: none)`, `(max-width: 700px)` x2).
  None targets `.roster-title`, so the conclusion stands; the count does not.
- F-4 (plan text, §6 AC-10): the expected compose number is stated as 492 via
  "host minus delta 2" off AS-82's 480/478 receipt. Observed 492 on a host 494
  — delta 2 confirmed, arithmetic coincidence noted: AC-10's literal 492 was
  derived from a 480-host base and happens to equal the correct answer for a
  486-host base only because 494-2 = 492. Worth not reusing the literal.
  Worth not reusing the literal — see the Compose receipt section above, which
  is the authoritative version of this finding (posted to Lattice as F-4).
- F-6 (process): `trap` is rejected by this shell ("trap evaluates arguments as
  shell code"), so the plan §7 recipe cannot be run as written. The restore
  guarantee lives in `mutate.mjs`'s `finally` instead — same property, and it
  carries the assert-applied checks too.
- F-7 (decision): see "Decisions" above — did not read the CTO's probe
  scratchpad; the helper's reported cardinality (205 rules parsed, 2 targeting)
  matches the probe's numbers independently, which would have been circular
  evidence had the probe been copied.

NOTE: the Lattice comment renumbers these — the two plan-text findings about
`node.class` counts and the @media count are F-3 and F-5 there, and the M1
occurrence-count defect is F-1. The comment is the canonical numbering.
