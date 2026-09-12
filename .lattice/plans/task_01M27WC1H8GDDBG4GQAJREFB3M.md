# AS-113: Chat: chat.js probe budget accepts values above 2^31-1, which Node clamps to 1 ms — a budget of 2147483648 refuses a live server after 54 ms naming a budget it never spent (AS-83 Ruben F-1)

Two-stage path (`complexity: low`): developer-lena plans + implements in this stage; qa-priya reviews. Filed from Ruben's AS-83 review F-1.

## 1. Defect

`bin/chat.js` `probeBudget()` accepts any `^\d+$` string with `Number(raw) > 0`. `lib/client.js` `probe()` hands that number to `AbortSignal.timeout(timeoutMs)`, which is a Node timer: a delay above `2^31-1` (2147483647) does not fit a 32-bit signed int, Node emits `TimeoutOverflowWarning` and **sets the delay to 1 ms** (reproduced on Node v24.13.1: `AbortSignal.timeout(2147483648)` → "Timeout duration was set to 1"; `2147483647` is accepted with no warning). So `CHAT_PROBE_TIMEOUT_MS=2147483648` against a live-but-not-instant server refuses as ambiguous after ~54 ms with `timed out after 2147483648 ms` — a budget it never spent. The AS-24 boundary held (exit 1, no DB touched); the defect is that the knob lies.

## 2. Fix — one guard, at the one parse boundary

The budget is parsed in exactly one place: `probeBudget()` in `bin/chat.js` (the only caller of `lib/client.js probe()` in the codebase is the CLI; `probe()` takes an already-validated number). The guard goes there, on the same every-path rule AS-83 set (validated even when no probe runs, e.g. rule 4 `CHAT_DB` only).

- `lib/client.js`: export `MAX_PROBE_TIMEOUT_MS = 2147483647` beside `DEFAULT_PROBE_TIMEOUT_MS`, with a comment naming why (Node timer ceiling; larger clamps to 1 ms). The ceiling is a fact about the library's mechanism, so the library names it and the CLI imports it — the number appears once in code.
- `bin/chat.js` `probeBudget()`: after the existing positive-integer check, `if (ms > MAX_PROBE_TIMEOUT_MS) fail(...)` with the exact message:
  `chat: invalid CHAT_PROBE_TIMEOUT_MS '<raw>' — above ${MAX_PROBE_TIMEOUT_MS} ms, the Node timer ceiling; a larger delay is clamped to 1 ms (AS-113).`
  Keeps the `invalid CHAT_PROBE_TIMEOUT_MS '<raw>'` prefix so the existing T3 grep shape holds. Usage text gains `, at most 2147483647` via the constant.
- `apps/chat/README.md` env-table row for `CHAT_PROBE_TIMEOUT_MS`: add the ceiling in one clause.
- `test/mode.test.js`: one new case, T5 (T3-style, rule-4 spawns so no probe ever runs):
  `mode: AS-113 — CHAT_PROBE_TIMEOUT_MS above 2147483647 (the Node timer ceiling, clamped to 1 ms) is a usage error naming the ceiling; the ceiling itself is accepted`
  - `'2147483648'` with `CHAT_DB` = phantom → `status === 1`, stderr `/invalid CHAT_PROBE_TIMEOUT_MS/`, `/'2147483648'/`, `/2147483647/`, `assertNoDbTouched`.
  - Control in the same case: `'2147483647'` with a real temp `CHAT_DB` → `status === 0`, stdout `/#engineering/` (the boundary is `>` not `>=`).

Not changed, deliberately: `probe()` gets no second guard (one guard, one boundary — a library caller passing a raw number is out of scope and there is none); the AS-83 positive-integer regex and T1–T4 are untouched.

## 3. Files

| File | Change |
|---|---|
| `apps/chat/lib/client.js` | `export const MAX_PROBE_TIMEOUT_MS` + comment |
| `apps/chat/bin/chat.js` | import; ceiling check in `probeBudget()`; usage text |
| `apps/chat/test/mode.test.js` | T5 |
| `apps/chat/README.md` | one clause in the env table row |

## 4. Acceptance criteria (M4 — each with its falsifier and the exact predicted red set, executable case names)

1. **A budget above the ceiling is a usage error on every path.** T5 passes. Falsifier **M1**: in the worktree scratch copy delete the `if (ms > MAX_PROBE_TIMEOUT_MS)` block from `probeBudget()` (assert applied: `MAX_PROBE_TIMEOUT_MS` occurs 1→0 times in the slice `function probeBudget` … `async function resolveBackend`; in the built image, the red case's `describeExit` output shows `exit 0` for `channels (CHAT_PROBE_TIMEOUT_MS=2147483648)` — impossible from a pre-mutation image). Predicted red: exactly `{T5}` — T3 (`mode: AS-83 — CHAT_PROBE_TIMEOUT_MS must be a positive integer…`) stays green.
2. **The message names the ceiling.** Falsifier **M2**: replace `above ${MAX_PROBE_TIMEOUT_MS} ms` with `above the ceiling` in the fail message (assert applied: `${MAX_PROBE_TIMEOUT_MS}` occurs 1→0 in the same slice). Predicted red: exactly `{T5}` at the `/2147483647/` match. Host `node --test test/mode.test.js` run.
3. **The ceiling itself is accepted** (`>` not `>=`). Falsifier **M3**: change `>` to `>=` (assert applied: `ms >= MAX_PROBE_TIMEOUT_MS` 0→1 in the slice). Predicted red: exactly `{T5}` at the control's `status === 0`. Host run.
4. **Nothing else moves.** Full suite green on a `--build` compose receipt; host `node --test` green.

## 5. Counts

Baseline (last merged-master receipt, tick 14): compose chat **623 / 615 / 0 / 8** (tests / pass / fail / skipped). Predicted after T5: **624 / 616 / 0 / 8**. Host baseline is measured in the worktree before editing and quoted in the stage comment; predicted host = baseline + 1.

Counted runs via `node apps/chat/bin/compose-run.mjs --project asc-impl-as113 --cwd .worktrees/AS-113/apps/chat` (M1 counted through compose with `--build`; M2/M3 on the host against `test/mode.test.js` only, so the sets are exact). Restore after each mutant, prove with `git -C .worktrees/AS-113 diff --exit-code`, final green rebuild after the last mutant.
