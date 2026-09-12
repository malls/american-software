REVIEW AS-87 (Priya, cycle 2, branch feat/AS-87-deploy-heartbeat-and-log @ ddc8833, tick watcher:15881 loop tick 8; this invocation ran on Opus as the Fable fallback). Reviewed cold: plan §4 + my cycle-1 section, the rework diff 7c80e50..ddc8833 (one commit, one file: apps/chat/test/watcher-deploy-real.test.js +58/-8; production code byte-identical to what I reviewed in cycle 1), then the running software.

VERDICT: PASS (merge). 0 blocking findings, 0 findings outside the list that change behavior, 2 notes. Nothing committed on the branch; no inline fixes.

FINDINGS FIRST
- F1 (cycle 1, the leaked `app` compose project): CLOSED. The app dir is now `<tmp>/<project>` so compose derives the same name `-p project` tears down. Demonstrated, not argued: unmutated real build 1/1 pass in 105.5 s; afterwards `docker compose ls -a` lists no as87 project and `docker ps -a --filter label=com.docker.compose.service=as87` is empty (the asc-review-as87 receipt project is also gone after its `down -v`).
- AC-11 / M9 (my cycle-1 ask): RED as named. Scratch copy with `const app = join(dir, 'app')` restored (mutation asserted at the one site): fails in 82.4 s at the FIRST AC-11 assertion — `AC-11: no container from this run survives teardown`, actual `['app-as87-1\tproject=app\tworking_dir=/private/tmp/asc-as87-45611-OXL4ke/app']`. Exact red set = 1 (the single opt-in test), exactly the predicted line. The probe is keyed on the run's temp-dir basename (working_dir label / ConfigFiles), not on `project`, which is why it catches the very mismatch that was the bug; the positive control (1 container, 1 project, >=1 image before teardown) passed on the unmutated run, so the empty answer after teardown is not vacuous.
- M10 (mine, past the list): drop `--rmi local` from teardown -> RED in 92.1 s at the THIRD AC-11 assertion only — `AC-11: --rmi local removed the image the build produced`, actual `['asc-as87-45632-eb6cuy-as87:latest']`. So the image half of AC-11 stands on its own falsifier, not on the container half.
- N2 / AS-117 (fail-fast): TAKEN and proven on two refusal shapes I chose, not the implementer's. Scratch copies: (a) `run` returns code 128 for `ls-tree` -> `{"action":"noop","reason":"no-git"}`; (b) `fetchJson` throws -> the AS-84 belt's `{"action":"noop","reason":"error","detail":"probe exploded"}`. Both fail in 0.7 s with the decision and the ops log in the assertion message, versus the 10-minute hang I observed in cycle 1 under M8. AS-117 can close as folded at this merge.
- Two writers at once (M6): M9 and M10 ran concurrently with each other on this host, sharing the `as87` service label and distinct project names; neither run's footprint probe saw the other's container/project, and M10's image assertion filtered on its own `<project>-` prefix. The per-run keying holds under concurrency.
- Host left as found: everything my mutants leaked (container app-as87-1, images app-as87:latest and asc-as87-45632-eb6cuy-as87:latest, network app_default) was removed by hand and re-verified empty; nothing of the reviewer's is left on the docker host.

NOTES (non-blocking, no change requested)
- N1: the fail-fast comment (test line ~108) says "a deploy sets `deploying` synchronously before its first await" — true of performDeploy(), but evaluate() awaits probeRunning() first; the mechanism does not depend on the claim (a 200 ms race window against a >=75 s build), so I left the wording.
- N2: my cycle-1 count prediction (host 536) was wrong and the implementer's 535 is right — AC-11 rides inside the opt-in test, not as a separate test. Recorded so the next reviewer does not chase it.

SWEEP (floor check, after the findings) — cardinality first
- Host `node --test` in the worktree: 535 tests / 534 pass / 1 skipped (opt-in) / 0 fail, exit 0. Master baseline 530 -> +5, unchanged from cycle 1.
- Compose receipt: `/usr/local/bin/docker compose -p asc-review-as87 run --rm --build test` via node spawnSync (docker off PATH) -> `Image asc-review-as87-test Built` (line 59 of the log), 535 tests / 529 pass / 6 skipped (5 git-less container skips + 1 opt-in, line 448 `# opt-in: set AS87_REAL_BUILD=1`) / 0 fail, exit 0; `down -v --remove-orphans` exit 0; project absent from `compose ls -a` afterwards.
- AC-1/2/3/4/5/6/9: production code untouched by the rework (verified by `git diff 7c80e50..ddc8833 --stat`), the cycle-1 reds stand and are not re-run; the tests are present and green in both suites above (heartbeat test, argv pin, composeBuild pass-through, sidebar sentence).
- AC-7: real build unmutated 1/1 pass, 105.5 s (heartbeats >= 5 with `deploying`, log non-empty with AS87-MARKER and `#N` lines). Cycle-1 M7 reds (M1 -> heartbeat red, M6 -> log red) not repeated — the rework did not touch those assertions.
- AC-8: opt-in test registers as 1 skipped in both suites, never a fail.
- AC-10: both counted runs above, receipt line quoted.
- AC-11: positive control + M9 + M10 above. 11 of 11 pass; findings outside the list: 0 blocking.
- Mutants this cycle: 4 named (M9, M10, N2-nogit, N2-error), 4 runs, 4 red, 0 survivors, every red set exactly the predicted assertion.
- Branch hygiene: 4 commits, all `developer-marcus <developer-marcus@agents.american-software.local>`; `git merge-tree --write-tree master feat/AS-87-deploy-heartbeat-and-log` clean; no `.lattice/` paths on the branch; worktree clean (all mutation on scratch copies under scratchpad/agent-qa-priya/as87c2-scratch/, never in the worktree).

Evidence: scratchpad/agent-qa-priya/as87c2-*.log and as87c2-mutate.mjs (mutations applied with a one-site assertion each).
