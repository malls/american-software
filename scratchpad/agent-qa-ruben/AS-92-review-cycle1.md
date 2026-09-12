# AS-92 review cycle 1 — qa-ruben working notes (tick watcher:15881 loop tick 8, Opus fallback)

## Progress
- [x] Read dossier, PHILOSOPHY, plan
- [x] Diff read cold (6 files, 3 commits e0fe995 fa03e6c d7977a0, head d7977a0)
- [x] merge-tree clean; master moved only in .lattice since base 0337a54 (git diff --stat 0337a54 master -- . ':!.lattice' empty) — §7 rebase rule does not fire
- [x] Host run in worktree: 537/537/0 fail/0 skipped (T8 ran)
- [x] master baseline (git archive, scratch): 530 (529 + 1 artifact fail: deploy-shape needs a git repo; archive isn't one) → delta +7
- [x] pristine branch scratch (git-inited): 537/537/0
- [x] mutants M1..M9: 9/9 red; P1 probe survivor (corrected anchor)
- [x] probes P2..P12
- [x] compose --build -p asc-review-as92: Image asc-review-as92-test Built; 537/531/0 fail/6 skipped; torn down, no leak
- [x] AC-10: all 3 commits developer-lena; no .lattice, no top-level md, package.json unchanged; worktree clean
- [x] read implementer comment LAST — her 9 red sets == mine
- [ ] lattice comment, #engineering post

## Mutant results (observed vs predicted)
M1 {T2,T3,T7,T8} vs {T2,T4,T7,T8} — same width, different membership (T4 green by fixture: EXTRA carries /usr/local/bin; T3 red on present). Prediction error.
M2 {T2,T3,T4,T5,T7,T8} vs {T2,T7,T8} — wider by 3, all legitimate consequences. Prediction error.
M3 {T3} = predicted. M4 {T4} = . M5 {T4} = . M6 {T5} = . M7 {T6} = . M8 {T7} = (AS-82 pin green by construction, confirmed). M9 {T7} = .
P1 (TICK-PATH log moved AFTER the tick spawn, anchored on spawnFn(config.claudeBin): SURVIVOR 537/537. First P1 attempt hit :795 compose spawn → line 1604 loop evaluator → false red {T7, f3-mirror x2}; caught by re-reading mutated file; anchor fixed.

## Probes
P2 EXTRA 'bin:~/tools:./x' → passed through unexpanded (documented "absolute directories")
P3 ADVANCE_DOCKER_BIN=/usr/local/bin (a dir) → add ['/usr/local', gh dir] (parent dir; same as AS-75 accepts)
P4 PATH trailing ':' → '' in presence set, harmless; child PATH keeps trailing ':' (untouched suffix)
P5 PATH '/usr/local/bin/' (slash) → not present → re-added (harmless duplicate)
P6 PATH '' + add → '/usr/local/bin' (empty original dropped — safer; deviates from "untouched suffix" only here); PATH '' + [] → ''
P7 PATH undefined + add → '/usr/local/bin'
P8 whitespace-only extras dropped. P9 extra already on PATH → present. P10 gh override-missing → unresolved, docker still added.
P11 real host thin → add both. P12 real host process.env → add [], present both, unresolved [] (the AC-9 expected line shape).

## Verdict: PASS (merge). No commits on the branch.
N1 non-blocking test gap: "logged before the spawn" unpinned (P1 survivor). N2/N3 record-only edge cases.
