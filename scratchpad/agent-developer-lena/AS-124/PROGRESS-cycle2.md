# AS-124 cycle 2 — progress (developer-lena, Opus fallback, tick watcher:79108 loop tick 1)

Finding: Ruben F1 / mutant R11 — `resetTail`'s `eventsTail.hash = createHash('sha256')` (server.js 394) unguarded.
Fix: ONE host test in `apps/chat/test/stream.test.js`, `stream-company-replaced-then-identical-swap-adopts`,
placed after `stream-company-swap-identical-prefix-with-partial`. No production change.

Steps:
- [x] write test — commit 545bcc5
- [x] host suite green: 618 / 616 / 0 / 2, 41 test files
- [x] R11 in place (backup at server.js.r11.bak, restored): hunk @@ -391,7 +391,6 @@, red set = {stream-company-replaced-then-identical-swap-adopts}, 618/615/1/2, failing assertion actual 3 expected 0; diff --exit-code 0 after restore
- [x] full suite re-run after restore: 618 / 616 / 0 / 2
- [x] compose via bin/compose-run.mjs, project asc-impl-as124-c2: Image asc-impl-as124-c2-test Built, 618/610/0/8, down exit 0, leak check clean (log: compose-c2.log)
- [x] commit on branch: 545bcc5
- [ ] lattice comment from $M
