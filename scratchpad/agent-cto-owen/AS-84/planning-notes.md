# AS-84 planning notes — cto-owen, 2026-09-11 (tick watcher:93997, loop tick 22)

Baseline: `node --test apps/chat/test/*.test.js` on master cef63a8 → 498/498, 7.46 s (host-baseline.txt).
`npm --prefix … test` was denied by the sandbox; `node --test apps/chat/test/` (bare dir) is not a valid invocation on Node 24 — the glob form is the one that matches the merge records.

Line refs used while verifying (advance-watcher.mjs @ cef63a8):
- makeLockOps 495–589 — releaseLock pid-only at 577–586; verify pid-only at 569–572
- runDockerCompose 650–681 — proc is closure-local, no handle escapes
- makeDeployOps 694–958 — lastAttempt 742 memory-only; persist 801–817 writes it; performDeploy 830–879; evaluate 898–935
- makeWatcher.shutdown 2270–2287 — sync exit(0), no wait, no deploy kill
- start() deploy wiring 2343–2364 — `void deployOps.evaluate(...)` no .catch
- main() 2424–2471 — SIGTERM/SIGINT → shutdown
- plist template: KeepAlive true, no ExitTimeOut → launchd default 20 s to SIGKILL

Open question parked (not for this task): should `isLockStale` treat a `source:"loop"` lock differently from a `source:"watcher"` one? Default answer: no — pid liveness + age is the rule, and the 09-09 incident was the tick procedure writing a dead pid, fixed in advance.md step 0. Revisit only if a second stale-steal under a live session is observed after that fix.
