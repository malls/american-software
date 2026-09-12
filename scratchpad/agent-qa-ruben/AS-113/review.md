REVIEW AS-113 — PASS, no inline fix; branch tip stays de5fd0b (feat/AS-113-probe-budget-ceiling, one commit by developer-lena). Reviewer qa-ruben on Opus under the Fable fallback, tick watcher:79108 loop tick 16. Read cold: plan, then the diff, then the worktree code; the implementer's stage comment was read LAST, after every receipt and finding below was already recorded in my scratchpad. Did not read `.lattice/review_state/`.

**Findings outside the criteria list: 4 (0 blocking — 1 defect out of scope, 3 convention/erratum). Floor check: 4/4 criteria pass. Mutation battery: 3 named falsifiers, 3 observed reds, all exactly {T5}.**

## Findings (first)

**F1 — defect, out of scope, low. The same 2^31-1 clamp is reachable through the watcher's minute-denominated env budgets.** `apps/chat/watch/advance-watcher.mjs` `envNum()` accepts any finite positive number, and `ADVANCE_TICK_TIMEOUT_MIN`, `ADVANCE_LOCK_STALE_MIN`, `ADVANCE_DEPLOY_TIMEOUT_MIN` are multiplied by 60 000 straight into `setTimeout` (lines 2611, 2899, 261/2852). Reproduction on Node v24.13.1: `ADVANCE_TICK_TIMEOUT_MIN=35792` → 2 147 520 000 ms → `TimeoutOverflowWarning … Timeout duration was set to 1` → the timer fired after 2 ms, i.e. the tick child would be SIGTERMed 1 ms after spawn while the log says "TIMEOUT tick exceeded 35792min". Lowest overflowing value is 35792 min (24.9 days), so this is operator-error territory, not a live hazard. The plan scoped AS-113 to "one guard, at the one parse boundary" (§2), so this is not rework. Per the triage gate it stays on this record and folds into the plan of the next task that touches `advance-watcher.mjs` (shape: a ceiling in `envNum` for the `*_MIN`/`*_S` knobs, or a shared `clampTimer()` helper).

**F2 — convention (plan erratum, trivia). Plan §4 AC-1's applied-assertion is miscounted: "MAX_PROBE_TIMEOUT_MS occurs 1→0 in the slice `function probeBudget` … `async function resolveBackend`" — the slice holds the token twice (the `if` and the `${MAX_PROBE_TIMEOUT_MS}` in the fail message), both inside the deleted block, so the true count is 2→0.** My mutant runner asserted the plan's number and refused to apply (throw before write; tree proven clean); corrected to 2→0 and re-ran. The implementer's comment reports the same 2→0 but attributes it to "the doc comment I added above probeBudget" — that comment sits *before* `function probeBudget()` and is outside the slice as the plan defines it; had it been inside, the count would have been 3→1 (the comment survives the deletion). Attribution matters because an unapplied mutation looks exactly like a passing guard: the slice was right, the explanation was not. Owner: plan author; no code change.

**F3 — convention (record, not a verdict). The task record says twice that the reviewer should not be me** (filing comment: "Reviewer should not be Ruben (he named the fix)"; pull-in comment likewise). The orchestrator reassigned the review to me in 23b0466 (one QA identity per lane; Priya on AS-71). I named the finding and the fix shape on AS-83; I did not write the code, the diff was read cold, and the reds and probes below are my own — but the anchoring the filing comment worried about is by nature invisible afterward, so the record should carry it rather than pretend it away. Routed to the orchestrator: either accept the reassignment as recorded here, or have Priya take the review on the next tick if lane pressure allows. Not a defect finding against the branch.

**F4 — convention (trivia). `probe()` in `lib/client.js` still takes a raw number with no guard of its own.** Deliberate per plan §2 (one boundary; the CLI is the only caller — verified by grep, it is). Recording so the next library caller knows the ceiling is enforced by the CLI, not the library. No change requested.

Not a finding, for the record: my first end-to-end harness hung on the ceiling value. Cause was my harness — `spawnSync` blocked the same event loop that hosted the in-process fake server, so the CLI dutifully waited on its 24.8-day budget. Re-ran with the server in its own process (below); the CLI is fine. Written down so the next reviewer does not chase it.

## Receipts (cardinality before quantification)

All compose runs via `node apps/chat/bin/compose-run.mjs --project asc-review-as113 --cwd .worktrees/AS-113/apps/chat` (AS-106 tool: `run --rm --build test`, always `down -v --rmi local --remove-orphans`, leak check).

| run | tree | image line | tests / pass / fail / skipped | exit |
|---|---|---|---|---|
| baseline | de5fd0b clean | `Image asc-review-as113-test Built` | 624 / 616 / 0 / 8 | 0 |
| M1 mutant | guard block deleted | `Image asc-review-as113-test Built` | 624 / 615 / 1 / 8 | 1 |
| confirming | restored, `git diff --exit-code` clean | `Image asc-review-as113-test Built` | 624 / 616 / 0 / 8 | 0 |

Baseline = last merged-master 623/615/0/8 + T5, exactly as the plan predicted. Host (worktree, Node v24.13.1): full suite 624 / 622 / 0 / 2; `test/mode.test.js` 14 / 14 (13 on master + T5). Every compose run torn down; `compose-run.mjs --check` shows 0 leftovers for `asc-review-as113` (one unrelated leftover `asc-plan-as49_stripe-mock` belongs to AS-49 — not mine, not touched).

## Observed reds (one per named falsifier; each step: mutate → assert applied at the site → show mutated diff → run → restore under an exit handler → `git -C .worktrees/AS-113 diff --exit-code`)

| falsifier | mutation (assert applied) | run | red set | failing assertion |
|---|---|---|---|---|
| M1 (AC-1) | delete `if (ms > MAX_PROBE_TIMEOUT_MS) {…}` block; token 2→0 in slice (plan said 1→0, F2) | compose `--build` | exactly {T5}; 624/615/1/8 | `channels (CHAT_PROBE_TIMEOUT_MS=2147483648): exit 0 signal null after 585 ms` — impossible from a pre-mutation image |
| M2 (AC-2) | `above ${MAX_PROBE_TIMEOUT_MS} ms` → `above the ceiling`; `${MAX…}` 1→0 | host mode.test.js | exactly {T5}; 14/13/1 | `the refusal names the ceiling`: actual `… above the ceiling, the Node timer ceiling …`, expected `/2147483647/` |
| M3 (AC-3) | `ms >` → `ms >=`; 0→1 | host mode.test.js | exactly {T5}; 14/13/1 | control `channels (CHAT_PROBE_TIMEOUT_MS=2147483647): exit 1 signal null after 35 ms`, expected 0 |

T3 (AS-83 positive-integer case) stayed green under all three. No set wider or narrower than predicted. Tree proven clean after each; mutant image removed by the tool's own teardown and the confirming run rebuilt from the restored tree.

## Probes past the list (M6)

**Parse-boundary table** — 24 values, 24 as expected. Rule 4 (`CHAT_DB` = fresh temp path, no probe ever runs), `chat channels --me human:forrest`. "db created" = whether the refusal happened before any store open. Full table in scratchpad `probe-table.md`.

| value | exit | db created | message |
|---|---|---|---|
| unset, `""` | 0 | yes | (default 3000; accepted) |
| `"  "`, `0`, `-5`, `+5`, ` 5`, `5 `, `1.5`, `1e9`, `0x10`, `1_000`, `Infinity`, `NaN`, `٥` | 1 | no | AS-83 positive-integer message (unchanged) |
| `1`, `3000`, `007`, `2147483647`, `02147483647` | 0 | yes | accepted (leading zeros are digits; `>` not `>=`) |
| `2147483648`, `02147483648`, `4294967296`, `99999999999999999999` | 1 | no | `invalid CHAT_PROBE_TIMEOUT_MS '<raw>' — above 2147483647 ms, the Node timer ceiling; a larger delay is clamped to 1 ms (AS-113).` — raw string quoted verbatim, ceiling named |

Refusal precedes every side effect (exit 1, no DB file, no `-wal`/`-shm`). The two messages partition cleanly: syntax → AS-83 text, magnitude → AS-113 text.

**End-to-end truth check** — a 300 ms-slow but live fake server in its own process on loopback 18347 (never the production server), `CHAT_API` pointed at it:

| budget | exit | wall | server hits | what the user sees |
|---|---|---|---|---|
| 2147483648 | 1 | 37 ms | 0 | the AS-113 refusal — before any request leaves the process |
| 2147483647 | 0 | 976 ms | 3 (`/api/identities` ×2, `/api/conversations`) | the channel list — the ceiling waited out the slow probe and reached the server; the original defect (refused after ~54 ms) is closed |
| 1 | 1 | 58 ms | 1 | AS-24 refusal `(timed out after 1 ms)` — honest: it names 1 ms and it spent 1 ms |

Also checked directly: `AbortSignal.timeout(2147483647)` neither warns nor holds the event loop after a completed fetch (process exits in 64 ms); usage text renders `at most 2147483647, default 3000`; README env-table row reads correctly.

**Merge seam** — 13 commits on master since the branch point 742b404; none touch `bin/chat.js`, `lib/client.js`, `test/mode.test.js`, or `README.md`; the only `apps/chat` touch is the records export b7ca893. No conflict expected.

## Acceptance-criteria sweep (floor check — 4/4; findings above are what the list did not cover)

1. Budget above the ceiling is a usage error on every path — PASS. T5 green; M1 red exactly {T5} in-image (compose, Built).
2. Message names the ceiling — PASS. M2 red exactly {T5} at `/2147483647/`.
3. Ceiling itself accepted (`>` not `>=`) — PASS. M3 red exactly {T5} at the control's `status === 0`; end-to-end the ceiling value reaches a live server.
4. Nothing else moves — PASS. Compose 624/616/0/8 with `Image asc-review-as113-test Built` (baseline and confirming); host 624/622/0/2; T1–T4 untouched and green under every mutant.

## Verdict

PASS. No inline fix; nothing committed on the branch; tip de5fd0b. F1 stays on this record for the next watcher task (triage gate). F2 is a plan erratum for the plan author. F3 is routed to the orchestrator as a record question, not a verdict. Compose project `asc-review-as113` torn down (leak check clean). Scratchpad: `scratchpad/agent-qa-ruben/AS-113/` (probe.mjs, probe-table.md, e2e/cli-run/slow-server.mjs, mutate.mjs, host-mutant.mjs, compose-mutant.mjs, compose-{baseline,m1,final}.{out,log}).
