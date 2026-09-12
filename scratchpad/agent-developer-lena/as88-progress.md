# AS-88 progress (developer-lena, tick watcher:53418 loop tick 9)

Worktree: .worktrees/AS-88, branch feat/AS-88-deploy-names-its-project, cut from 28a54fd (post AS-87 + AS-92).

## Host baseline (before any change)
node --test in worktree apps/chat: tests 542 / pass 541 / skipped 1 / fail 0 (as88-host-baseline.txt)
(plan predicted 537 post-AS-87; AS-92 merged after and added tests — deltas are against 542.)

## Steps
- [x] 3.1-3.5 code + tests — commit 9a61bad; host 550/549/1 skipped/0 fail (+8 vs 542)
  - extra seams the guard found (not in plan §7): AS-84 stream-error test (runDockerCompose direct call) and AS-86 deploy-inputs-git harness (makeDeployOps) — both given composeProject 'asc-test'
  - makeWatcher env/exists (AS-92) do NOT reach makeDeployOps; left as is (out of scope), noted in AC-8 test comment
- [x] 4.1 / 4.2 READMEs — commit e5a180a (head)
- [x] mutants: 10/10 red, 0 survivors (as88-mutants.log); M8 wider than predicted (+3 watcher-process entry-point tests: real main() dies on the AC-7 refusal — empirical §10 Q2)
- [x] compose -p asc-impl-as88 --build: Image asc-impl-as88-test Built; 550/543/7 skipped/0 fail; torn down, nothing left, live server untouched
- [x] merge-tree clean; tree clean; 8 files all under apps/chat
- [ ] optional AC-12 real build (AS87_REAL_BUILD=1)
- [ ] lattice comment
- [x] §10 Q2: start() has no try/catch around makeDeployOps, main() calls start() bare -> uncaught exception, exit 1, launchd relaunches => README crash-loop sentence is TRUE as written
- [ ] mutants M1 M1b M2-M9
- [ ] compose receipt -p asc-impl-as88
- [ ] merge-tree clean, lattice comment
