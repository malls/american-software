# AS-46 rework cycle 1 — progress (developer-lena, tick watcher:79108 loop tick 7)

Start tip: 3eb718f on feat/AS-46-invoice-screen, worktree clean.

Plan of record:
1. D1 test first (new case after the S4-ERROR-VALIDATION case in test/invoice-screen.test.js), run RED via compose --build against the unfixed template.
2. Fix: view model picks add-new copy when pickerMode === 'new'; template gets an error slot in the add-new branch.
3. Green run test + contract, project asc-rework-as46. Commit.
4. D2: 375px inspection of the eight states; record.
5. Lattice comment from main checkout; #engineering note.

Copy choice (D1): add-new mode -> "Add the client first." (select mode keeps "Select a client."). Wireframe supplies none; Jonah Q-list.

Status: [x] test written  [x] red observed (450/431/1/18, that case only)  [x] fix  [x] green (450/432/0/18, 450/450/0/0)  [x] committed 7d5751c  [x] 375px (states/, measure-results-375.json)  [x] comment on AS-46  [x] #engineering msg 985

DONE. Nothing left for this cycle. Compose projects torn down. Owen moves to review.
