# AS-121 — compose-run.mjs: tear down on SIGINT/SIGTERM

Complexity **low** (two-stage: developer-lena plans + implements, qa reviews). Filed from
Priya's AS-106 review (probe: `scratchpad/agent-qa-priya/AS-106/sig.mjs`).

## 1. Problem

`bin/compose-run.mjs` registers no signal handler and drives docker with `spawnSync`. A
SIGINT/SIGTERM to the node process kills it before any JS runs: no `down`, no receipt; the
project's image (and, off the `network_mode: none` pin, its network) survives. The AS-106 plan
§2(b)4 promised the always-down path "on SIGINT/SIGTERM" and proxied it with T5c (exec throws),
which is not the same path.

## 2. Approach (the filed fix shape, bin-only)

1. In `main()`, for the counted run only (not `--check`, not before the guard): register a
   handler for `SIGINT` and `SIGTERM` that records the first signal name and nothing else. With
   the handler installed the process survives the signal; `spawnSync` returns when the compose
   child ends (killed with the group, or ran to completion on parent-only delivery) and
   `runCounted`'s existing always-down + leak-check path runs unchanged. Handlers are removed
   after `runCounted` returns.
2. The handler callback is deferred by `spawnSync`, so after `runCounted` returns, `main` yields
   one `setImmediate` turn to let it fire before reporting.
3. An interrupted run is not a receipt: print `compose-run: interrupted by <SIG> during the run —
   teardown ran; this run is not a receipt` on stderr and, when the lib's exit was 0, exit
   `128 + signal number` (`os.constants.signals`, the shell convention; 130 / 143). A non-zero
   lib exit (1, LEAK 4, NO_BUILD 5) is kept — it is already "not a receipt".
4. Document the signal contract in `apps/chat/README.md` (compose-run section) — one paragraph.

Non-goals (recorded, not done): forwarding the signal to the compose child so a parent-only
SIGTERM stops the container promptly (needs `runCounted` async in `lib/compose-run.js` — a second
production file, medium; proposed as a follow-up if the watcher's 15 s SIGTERM→SIGKILL grace turns
out to matter). SIGKILL is out of reach for any in-process fix. AS-122 (image filter
false-positive) is untouched: this change adds nothing to the leak-check path.

## 3. Key files

- `apps/chat/bin/compose-run.mjs` — the only production change.
- `apps/chat/test/compose-run.test.js` — T12a/T12b (stub docker, always on), T13 (real docker, opt-in
  under the file's existing `AS106_REAL=1` switch).
- `apps/chat/README.md` — contract paragraph.

Stub docker for T12: a `#!/bin/sh` script in a tmpdir, passed as `ADVANCE_DOCKER_BIN`; appends
every argv to `$AS121_LOG`; `compose … run` sleeps ~2 s then prints a summary + `Built` line;
everything else prints empty / `[]`. The test polls the log for the `run` line, sends the signal,
waits for exit, and asserts on the log order, stdout receipt, stderr line, and exit code.

## 4. Acceptance criteria

| # | Criterion | Falsifier (mutant) | Expected red set |
|---|---|---|---|
| AC-1 | Parent-only SIGTERM to the script mid-run (Priya's shape): the script survives, `down` is called after `run`, a `RECEIPT` block prints, stderr carries the `interrupted by SIGTERM` line, exit 143. | M1: delete the `process.on(sig, …)` registrations. | `{T12a, T12b}` (T13 when opted in) |
| AC-2 | Group-delivered SIGINT (script + docker child, `detached` + `kill(-pid)`): `down` still runs after `run`, receipt prints with `run exit=null`, stderr carries `interrupted by SIGINT`, exit non-zero. | M3: drop the `setImmediate` yield so the deferred handler never fires before reporting. | `{T12a, T12b}` |
| AC-3 | An interrupted run whose lib exit is 0 exits `128 + signum`, never 0. | M2: drop the `128 + signum` override. | `{T12a}` only — T12b's lib exit is already 1 |
| AC-4 | Existing suite unchanged: T1–T11 green; `--check` and the guard paths install no handler (T10b's read-only property holds; a signal before the run still terminates by default). | — (floor check; no new mutant) | — |
| AC-5 | T13 (opt-in, real docker, throwaway compose without `network_mode`): SIGTERM mid-container → zero `<project>_*` networks and zero `<project>-*` images afterwards, receipt printed. | M1 under `AS106_REAL=1` | `{T13}` plus the AC-1 set |

Proof burden (low): host suite green; compose run via `bin/compose-run.mjs --project asc-impl-as121`
with the `Image … Built` receipt; one observed red per M1/M2/M3 with the exact set recorded in
`scratchpad/agent-developer-lena/AS-121/`.

## Review Cycle 1 Findings (qa-priya, 2026-09-12, tick watcher:79108 loop 2 tick 3)

Verdict: implementation-level rework. Full comment on AS-121 (`--role review`); battery at
`scratchpad/agent-qa-priya/AS-121/`.

- **F1 (blocking, behaviour):** the handler is registered *before* `runCounted`, whose
  observe/preflight/guard steps (`network ls`, `compose ls`) run first. A SIGINT/SIGTERM in that
  window is swallowed and `compose run --build` then *starts* — observed with a stub docker
  sleeping on `network ls`: SIGTERM there → run → down → exit 143 → stderr says "interrupted …
  during the run" (false). §2.1 ("not before the guard"), AC-4 ("a signal before the run still
  terminates by default") and the README sentence all claim the opposite. Under the watcher's 15 s
  SIGTERM→SIGKILL grace, a cutoff landing in that window starts a multi-minute build that is then
  SIGKILLed — the original leak. Fix shape (bin-only): install the handler in the `exec` wrapper
  only when argv includes `run` (keep main's post-run yield + `off`); correct the README/stderr
  wording; add a stub test (docker sleeps on `network ls`, expect death by signal and no `run`
  line) whose falsifier is the handler moving back before the guard.
- **R1 (non-blocking, test hygiene):** under M1 with `AS106_REAL=1`, T13's `t.after` `compose
  down` races the container still held by the orphaned `compose run` client; network + image
  survive. Never triggers with the fix intact; folds into the next task touching the file.
- Probes that held: SIGINT/SIGINT/SIGTERM mid-run (first wins, exit 130); `--check` under
  SIGTERM dies by default. Floor check 4/5 (AC-4 fails on its before-the-run clause). Host
  627/624/0/3; `AS106_REAL=1` 19/19; `Image asc-review-as121-test Built` 627/618/0/9; mutants
  M1 {T12a,T12b,T13}, M2 {T12a}, M3 {T12a,T12b} — exact to §5.

## Reset 2026-09-12 by agent:cto-owen
