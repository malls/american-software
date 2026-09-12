AS-84 review started 18:13Z — step 0: reading dossier/philosophy/plan/diff
step 1: plan + prod diff + test diffs read cold. Candidate findings so far:
 - F-A: finish() SIGKILLs only the tick child on grace expiry; deploy child not SIGKILLed (plan §2.1 "SIGKILL whatever is left").
 - AC-14 fence looks OK (ADVANCE_REPO_ROOT temp, fake docker script, IMAGE_INPUTS imported not hard-coded).
step 2: baseline host run -> host-baseline.log; then 13 mutants via mutate.mjs
step 2 result: baseline 33 files, 511/511, 0 fail (plan predicted 511). mutants running (mutate.mjs -> mutants.json).
 - F-B (M6): runDockerCompose's `out` write stream has no 'error' listener; an EACCES/ENOENT on logsDir emits 'error' -> uncaught exception, not a rejection; neither evaluate()'s try/catch nor deployPoll()'s .catch sees it. Plan §0 named this path as F6 motivation.
 - README claims "Anything still alive when the grace expires is SIGKILLed" — code only SIGKILLs the tick child (F-A corroboration).
 - master since merge-base = board-only commits; branch is against today's code.
step 3: lattice show AS-84 (implementer report last), then wait for mutants, then comment.
step 3 done: implementer report read AFTER cold pass. Marcus's own red sets: M9 {9,10,12,14}, M6a/M6b {6,14}, M12 kills as 'cancelled'. My M1-M4 exact. Waiting on M5-M13.
Findings to file: F1 (defect, non-blocking?) grace-expiry path does not SIGKILL the deploy child (README claims it does); F2 (defect, non-blocking) compose log stream has no 'error' listener — uncaught exception path outside both F6 guards; seam: nothing hard-codes 9; AC-14 builds fixture from IMAGE_INPUTS so it picks up AS-86's 10th path automatically.
step 4: post lattice comment once mutants.json lands.
posted review comment, lattice exit 0: implementation-level rework needed (F1 blocking, F2 non-blocking)
