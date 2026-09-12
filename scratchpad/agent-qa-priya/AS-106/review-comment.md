REVIEW (qa-priya, Opus under the Fable fallback; started tick watcher:26252 loop tick 17, cut by the tick timeout, completed loop tick 18). Branch feat/AS-106-compose-run-teardown at 656339e (Lena 6c8edd8, b7274a5, d18df9d + my inline trivia 656339e). VERDICT: PASS. No implementation-level or plan-level rework needed. Read cold: plan, then diff master...branch, then Lena's IMPLEMENTED/RECEIPT comments as claims to verify; no daemon note read.

FINDINGS FIRST — 6 outside the criteria list, 0 blocking. Sorted per my rule: none violates a stated criterion; two are filed as backlog tasks, four are notes.

F1 (FILED AS-121, do not re-file) — plan §2(b)4 says teardown runs "on SIGINT/SIGTERM"; bin/compose-run.mjs registers no signal handler and drives docker with spawnSync, so a signal ends node before any JS runs. Observed for real last tick (scratchpad/agent-qa-priya/AS-106/sig.mjs): SIGTERM mid-container -> node exits signal=SIGTERM, no receipt, the compose child runs on, asc-review-as106-sigterm_default and asc-review-as106-sigterm-test:latest survived until a hand down. Not a criterion: AC-5 names exit 0 / exit 1 / throw (all three hold) and plan §5 de-scopes a real-signal test — but this is the tick-timeout case in real operation, which is why it is filed rather than shelved.

F2 (FILED AS-122, do not re-file) — the image leak filter is images.filter(startsWith(project + '-')), so a project whose name + '-' prefixes a sibling's (asc-impl-as108 vs asc-impl-as108-base-test:latest, present on this daemon) reports a false LEAK exit 4. Fails safe (voids a good receipt, never passes a leaky one). The network side is anchored at ^<p>_ and T6 proves it (asc-impl-as1060_default is excluded).

F3 (note) — plan §2(b)1 says the name guard refuses with "no docker call"; the script makes two read-only calls (network ls, compose ls) before the guard because the running-project check needs compose ls. Read-only, harmless; documented in the README in 656339e. Probed live: --project asc-chat and asc-invoicing -> exit 2 "is a production compose project"; "asc-Review/as 106" -> exit 2 name-regex refusal; missing --cwd -> exit 2 usage; unknown flag -> exit 2; ADVANCE_DOCKER_BIN=/nonexistent -> exit 2 "docker not runnable (override-missing)"; asc-* network count unchanged across all probes (probes.mjs).

F4 (note) — --log is written once after the run returns (writeFileSync in onOutput), not a live tee as plan §2(b)3 says; a run cut mid-way leaves no log. Receipt semantics unaffected. Backlog-worthy only if a cut lane ever needs the partial output; not filing.

F5 (note, cosmetic) — ASC_NETWORK_CEILING=0: --check prints "ceiling 0" (string || default) while runCounted uses Number(...) || 20. Display-only inconsistency on a nonsense value.

F6 (note) — M8's red set is one wider than plan §4 predicts ({T8, T10a} vs {T8}); T10a's clean case depends on classification, so it is correctly red. Same as Lena's F4; a plan under-prediction, not a vacuous guard.

INLINE FIXES (656339e, committed as qa-priya on the branch): compose ls docstring dropped the "-a" the code never passes; guessOwner docstring examples now match what the function returns ("AS-102 review", "marcus"); README names the read-only docker calls that precede the name guard. Comment/docs only; host suite re-run after the fix: 571/569/0/2, identical (host-branch-after-inline.log).

CARDINALITY (host, node --test, FORCE_COLOR=0): master 6dbfef1 = 562 tests / 561 pass / 0 fail / 1 skipped. Branch 656339e = 571 / 569 / 0 / 2. The branch adds 17 (16 top-level in compose-run.test.js: T1 T2 T3 T4 T5a T5b T5c T6 T7a T7b T8 T9a T9b T10a T10b T11-skipped, + 1 deploy-shape pin) on its 554 base; master has since taken AS-102 (+8), so the post-merge expectation is 579/577/0/2 — the plan's 565 was written before the split was known and before AS-102 merged (Lena's F3 stands). Opt-in T11 (AS106_REAL=1, ADVANCE_DOCKER_BIN=/usr/local/bin/docker) on the worktree: compose-run.test.js 16/16/0/0, T11 green in 12.3 s (real-T11.log).

COMPOSE via the branch's own script, --project asc-review-as106-t18 --cwd .worktrees/AS-106/apps/chat:
  RECEIPT project=asc-review-as106-t18
    built: Image asc-review-as106-t18-test Built
    tests=571 pass=563 fail=0 skipped=8
    run exit=0
    down exit=0
    leak check: clean (0 networks, 0 images for this project)
    exit=0
(compose-review-as106-t18.receipt; the tee log compose-review-as106-t18.log carries the same 571/563/0/8 and the Built line.) Matches Lena's receipt exactly. Plan's 565/556/9 -> 571/563/8: +17 not +11 (F3 above) and skipped 8 not 9 (AS-87's skip was already in the 7; Lena's F2). For the record: last tick's first compose run (compose-review-as106.log) has the Built line and 571/563/0/8 but its receipt block was not captured, so I re-ran rather than cite an incomplete receipt.

AC-1 INDEPENDENTLY (ac1.mjs): branch compose, -p asc-review-as106-ac1 run --rm --build test with the command overridden to a no-op -> "Image asc-review-as106-ac1-test Built", networks ^asc-review-as106-ac1_ AFTER run BEFORE down = []; downed; images []. The contrast (a default network created when the service has no network_mode) was observed in my M11 run on the T11 compose (asc-as106-real-73484_default appeared) and in Lena's M1 measurement on the chat compose (asc-as106-m1_default). Q1 resolved as the plan's default: compose v2 creates no default network for a network_mode: none service.

MUTANTS — 11 named, 11 applied at the intended site (pattern anchored to the enclosing function, matched exactly once, on-disk apply asserted, restore asserted byte-identical to the worktree), 11 red, 0 survivors. Scratch copy under scratchpad/agent-qa-priya/AS-106/scratch; the scratch baseline carries one environment-only red (deploy-shape "every tracked path … is an image input" — the scratch copy is not a git tree), excluded from every set below.
  M1 remove network_mode: none -> observed (see AC-1).
  M2 delete network_mode: none (compose.yaml) -> {deploy-shape network_mode pin} EXACT.
  M3 isAllowedProject returns ok -> {T1, T2} EXACT; T3 green.
  M4 down drops --rmi local -> {T4} EXACT.
  M5 down guarded by runStatus===0 inside runCounted -> {T5b, T5c} EXACT; T5a green.
  M6 leaks always [] -> {T6} EXACT.
  M7 built defaults true -> {T7a, T7b}: one wider than the plan's {T7b} because T7a's decoy (Lena's F1 fix, d18df9d) now asserts built:false — the widening is the fix working; recorded.
  M8 everything leftover -> {T8, T10a}: one wider (F6).
  M9 ceiling < becomes <= -> {T9a} EXACT; T9b green.
  M10 --check downs each leftover -> {T10b} EXACT.
  M11 down argv -> stop, applied in the scratch bin's exec wrapper so the lib and T4 stay intact, run against T11 for real -> {T11} EXACT, red on the leak assertion: "LEAK: asc-as106-real-73484_default, asc-as106-real-73484-test:latest", exit 4 (mutant-M11.log). The test's own t.after ran the correct down; a hand down afterwards reported "No resource found"; networks [] images [] afterwards.
Logs: mutant-M2..M11.log, mutants.mjs, m11.mjs.

NETWORK LEAK, BEFORE/AFTER (docker network ls, /usr/local/bin/docker): before this tick's runs, 13 asc-* networks (3 production, 0 live, 10 leftover: the plan's nine + asc-review-as120_default from the AS-120 review lane, which runs master's unpinned compose — not mine to touch). After every run above: 14 asc-*; the one addition is asc-review-as120-m5_default, which --check classifies live (the AS-120 lane is running now) — the parallel lane's, not this one's. Zero asc-review-as106* / asc-as106-real* networks or images exist after the review; every project I created (asc-review-as106-t18, asc-review-as106-ac1, asc-as106-real-73484, and last tick's asc-review-as106, -sigterm, -sigint) was downed with -v --rmi local --remove-orphans and is absent from network ls and images. AC-13 holds: the branch added nothing to the debris; the leftover count is 10 before and 10 after, same list. --check after: "asc-* networks: 14 (ceiling 20) … 10 leftover — removed nothing". For the orchestrator's §2(d) sweep: the nine plan §1 leftovers are unchanged; asc-review-as120_default is a tenth, attributable to the AS-120 review lane (Priya, loop tick 17, cut by the timeout) — it should join the attributed list once that lane is closed.

FLOOR CHECK (AC sweep, labelled as the floor; 13 of 13 pass, alongside the 6 findings outside the list above): AC-1 pass (own probe). AC-2 pass (M2 red, exact). AC-3 pass (T1–T3 + M3 + live probes). AC-4 pass (T4 + M4). AC-5 pass (T5a–c + M5; the signal path is F1/AS-121, outside the criterion's wording). AC-6 pass (T6 + M6; the image-prefix edge is F2/AS-122, fails safe). AC-7 pass (T7a/T7b + M7; the decoy covers the Built-line false positive). AC-8 pass (T8 fixture 3/1/9 + M8; live classification also seen for real on asc-review-as120-m5). AC-9 pass (T9a/T9b + M9; refusal observed live with ASC_NETWORK_CEILING=15 at count 15: exit 3, leftovers listed with owners, no run). AC-10 pass (T10a/T10b + M10; --check run three times, removed nothing). AC-11 pass (T11 green for real; M11 red for real). AC-12 pass with the explained deltas (571 host / 571 compose, not 565; deltas are the T-split and the AS-87 skip double-count, both stated by the implementer and re-derived here). AC-13 pass (every counted run through the script, receipts pasted, --check before/after unchanged at 10 leftovers).

MERGE HYGIENE: git merge-tree --write-tree master feat/AS-106-compose-run-teardown -> clean (tree f529b20, no conflict output). Branch touches 8 files, all under apps/chat/ and docs/engineering/; zero .lattice/ paths. Worktree clean at 656339e. Authorship: 3 commits developer-lena <developer-lena@agents.american-software.local>, 1 qa-priya <qa-priya@agents.american-software.local> — actor-id form. Post-merge check for the orchestrator: host 579/577/0/2 expected, and the merge's counted run should itself go through node apps/chat/bin/compose-run.mjs (plan §8 wording is ready for CLAUDE.md).

NOT FINISHED: nothing the plan requires. Skipped by choice: a real two-writers race (two scripts with the same -p at once — the running-project guard closes only after the first container is up); worth a line in AS-121's plan, not a task of its own. Scratchpad: scratchpad/agent-qa-priya/AS-106/ (dk.mjs, host.mjs, real.mjs, run-script.mjs, mutants.mjs, m11.mjs, sig.mjs, probes.mjs, ac1.mjs, summ.mjs and the logs named above).
