# AS-87 progress (Marcus)

## Rework cycle 1 (tick watcher:15881 loop tick 7, 2026-09-11)

Branch `feat/AS-87-deploy-heartbeat-and-log`, worktree `.worktrees/AS-87`, head at start 7c80e50. Master f90e7a8 = branch point 9bd5f7c + board-only commits (`git diff --stat 9bd5f7c master -- . ':!.lattice'` empty). Host had no leaked `app` project at start (`compose ls -a`: asc-chat, asc-invoicing, bettereads, whatever-sticks only).

Plan of record:
1. F1: `const app = join(dir, project)` — compose derives the project from basename(cwd) and cwd is `appDir`; naming the subdir after `project` makes the teardown's `-p project` hit. Comment at 25–27 rewritten.
2. AC-11: name-independent leak probe (containers by service label filtered on the temp dir's basename; `compose ls -a --format json` filtered on Name or ConfigFiles; images by project label). Positive control before teardown (1 container, 1 project examined), then teardown, then all three empty.
3. N2 taken: race `first` against the `isDeploying()` spin — settled before deploying = fail fast with the decision + log.
4. M9: restore `join(dir, 'app')` in a scratch copy of the test → AC-11 red; record exact set.

Status: DONE. Head ddc8833 (one rework commit). Moved to review.
- Real build unmutated: 1/1 pass, 92.8 s (as87-real-cycle2-run1.txt). Host leak-check after: no as87 containers/images, compose ls unchanged.
- M9 (scratch copy mut87/m9-app-subdir.test.mjs, mutation asserted at line 34): red in 82.4 s, exact set {AC-11: no container from this run survives teardown} with `app-as87-1 project=app working_dir=/private/tmp/asc-as87-35496-pDa20n/app`. Leaked `app` project torn down by hand (down --rmi local -v, exit 0); host clean after. Worktree diff --exit-code clean.
- N2 demo (mut87/n2-refused.test.mjs, git fake dirty): red in 0.73 s, `{"action":"noop","reason":"inputs-dirty"}`.
- Host: 535/534/1 skipped/0 fail (AC-11 is assertions inside the opt-in test, so no +1). Compose -p asc-review-as87 --build: `Image asc-review-as87-test Built`, 535/529/6 skipped/0 fail, exit 0.
- merge-tree clean; 0 .lattice paths on branch.
