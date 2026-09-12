# AS-135 progress (developer-lena)

Worktree `.worktrees/AS-135`, branch `feat/AS-135-incremental-dom`, fast-forwarded onto master 86f1529.
Host baseline (before any change): 663/660/0/3 (`host-baseline.log`).

- [x] Step 1: `public/message-pane.js` + `test/message-pane.test.js` — commit df1ebaa. T1–T9 green; T10 red until wiring.
- [x] Step 2: app.js wiring (`threadLinkNode`, `renderFrame`, handleFrame/sendMessage/catchUp), README line — d126e26.
- [x] Step 3: live.js R5 union + live test — fc0d3d1.
- [x] Unplanned: server.js STATIC_FILES `/message-pane.js` + AS-74 served-module pin 14 -> 15 — bb0f43a
      (first full host run went red on the pin: `expected 14 served modules, found 15`; first compose run 674/664/1/9 same cause).
- [x] Host after (tip bb0f43a): 674/671/0/3 (`host-after.log`).
- [x] Compose: `Image asc-impl-as135-test Built`, 674/665/0/9, leak check clean (`compose-run.log`).
- [x] Module-graph smoke on a worktree server (PORT 8399, CHAT_DB /tmp/as135-manual.db, killed after): app.js's 12 imports all 200,
      message-pane.js -> scroll.js 200 (`smoke.mjs`). Left /tmp/as135-manual.db behind (sandbox would not let me rm outside the repo).
- [ ] Mutant table M1–M9, M5b, M6b, M7b, M9-prepend in scratch worktree /tmp/AS-135-mutant (detached at bb0f43a) → `mutant-table.md`, `mutants.log`, `mutant-<M>.log`.
- [ ] Interactive browser check (scroll-up + frame, thread reply, permalink + frame) NOT done — noted for review.
- [ ] Lattice comment + `review --no-auto-review`.

Runner: `node run-host.mjs <chat-dir> <log>`; battery: `node mutants.mjs /tmp/AS-135-mutant [M1,M2]`.
