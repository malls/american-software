# AS-20 — Watcher parent-lock marker moves to the /advance prompt argument

**Planner:** cto-owen, 2026-08-30. **Complexity: low.** Transport change only —
no lock semantics, debounce, or highwater changes.

## Problem (evidence)

Third live fire, tick log `apps/chat/data/logs/tick-2026-08-30T18-20-03.664Z.log`:
the tick authenticated (AS-14 works) but self-cancelled — verbatim from the log,
"the env read was declined by the permission layer." Headless ticks
(`claude -p`, permission-mode `acceptEdits`) cannot read environment variables,
so the AS-15 `ADVANCE_TICK_PARENT` marker is invisible exactly where it matters.
The tick then correctly treated its parent watcher's `advance.lock`
(`source:"watcher"`) as foreign and no-op'd. Right marker, wrong transport.

## Design (decided at triage, recorded in the task description)

The marker rides in the prompt. The watcher fires:

```
claude -p '/advance watcher:<watcher-pid>' --permission-mode <mode> --output-format text
```

`advance.md` declares the argument; step 0 matches the `advance.lock` pid
against the **argument** marker. No env read anywhere on step 0's happy path.
`ADVANCE_TICK_PARENT` stays in `tickChildEnv()` as belt — harmless, and useful
in any context where env is readable. The prompt argument is the contract.

## Changes

1. **`apps/chat/watch/advance-watcher.mjs`** — new exported pure helper
   `tickArgv(watcherPid, permissionMode)` returning the exact argv array
   `['-p', '/advance watcher:<pid>', '--permission-mode', <mode>, '--output-format', 'text']`,
   mirroring the `tickChildEnv` pin pattern (AS-14: pinned set changes only
   deliberately, code + test together). `fire()` spawns with
   `tickArgv(process.pid, config.permissionMode)`. `tickChildEnv` unchanged.
   Update the spawn-site env comment block to note the argument is now the
   contract and env the belt.

2. **`.claude/commands/advance.md`** — add `argument-hint: [watcher:<pid>]` to
   the frontmatter; rewrite the step 0 watcher clause: a watcher-fired tick
   receives `watcher:<pid>` as the `/advance` argument; if the existing lock has
   `source: "watcher"` AND its `pid` matches the **argument** marker, the lock
   is yours — proceed, do not release at tick end (watcher releases in
   `settle()`). Mention `ADVANCE_TICK_PARENT` only as a belt for env-readable
   contexts. Any other source/pid, or no argument: foreign lock → no-op.
   (advance.md is a `.claude` command file, employee-editable — not one of the
   protected top-level markdown files.)

3. **`apps/chat/test/watcher.test.js`** — pin `tickArgv` exactly like the
   `tickChildEnv` pin: `deepEqual` on the full array for a known pid/mode,
   marker format `/^\/advance watcher:\d+$/` on the prompt element, default-mode
   behavior. Existing `tickChildEnv` pin test stays untouched (env belt remains).

## Acceptance criteria

- `tickArgv` exported, pure, pinned by test; `fire()` uses it.
- Prompt element is exactly `/advance watcher:<watcher-pid>` (the watcher's own
  pid — the same pid `acquireLock()` writes into the lock file).
- advance.md step 0 claims the parent lock via the argument, requires no env
  read, and keeps the "watcher releases its own lock" rule verbatim.
- Full suite green:
  `cd apps/chat && DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build test`.
- No behavior change for loop/manual ticks (no argument → foreign-lock rule
  unchanged).

## Out of scope

- AS-16 (pid-reuse nonce) — rides this transport later; linked AS-20 blocks AS-16.
- The tick log's "re-fired message 120 three times" claim — misdiagnosis;
  deliberate board-side highwater resets during debugging. No highwater change.
