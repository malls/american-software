# AS-57 — invoicing: dependency-policy closed-world scan — residual blind spots from the AS-53 review

**Planner:** Owen Kessler (`agent:cto-owen`), 2026-09-12, read cold on master `0b39536`+`df7e5c8`.
**Implementer:** Lena Fischer (`agent:developer-lena`). **Reviewer:** Ruben Ochoa (`agent:qa-ruben`) — Priya filed the finding and does not review it.
**Branch** `feat/AS-57-closed-world-residuals`, worktree `.worktrees/AS-57`. Complexity `medium`, three stages.
Long-form recipes and measurements: `scratchpad/agent-cto-owen/AS-57/mutations.md` (referenced as *recipes*).

## 1. Scope
Four residuals from the AS-57 record, nothing else: (1) the closed world is closed over the image, not the
directory; (2) `SKIPPED_DIRS` skips by name at every depth; (3) the two hash-comment strippers mishandle `\"`
inside a double-quoted YAML scalar; (4) `.DS_Store` is a loud nuisance. Not in scope: any product code
(`app.js`, `server.js`, `lib/`, `routes/`, `views/`, `public/` unchanged), new dependencies, new test files,
`SANCTIONED`, `OUTBOUND_CLIENTS`, and `CLAUDE.md`/`README.md` (repo root)/`PHILOSOPHY.md`/`agents.md`.

## 2. Approach
**Item 1 — decision: (a), the image IS the directory.** `Dockerfile` replaces the eight app-side COPYs
(`app.js server.js`, `lib`, `routes`, `views`, `public`, `test`, `demo`, `compose.yaml Dockerfile`) with one
`COPY apps/invoicing ./`, placed after `RUN npm ci` so the cache layer (`package.json` + lockfile COPY) stays
first. The three cross-directory COPYs (`tokens.css`, the states ledger, the repo-root `.dockerignore`) stay:
**11 COPYs → 5.** Why (a) over (b): this suite has no host run (README § The three commands), so a "host-side
guard" cannot be a test in this suite; (b) is enforced by memory, which is the finding. Under (a) the guard
already exists — test #3's exact lists plus test #5's scan — and the record's reproducer turns it red (M1).
What (a) costs: `README.md` rides along (unscanned, harmless); a developer's stray file in `apps/invoicing/`
is now loud in the suite — which is the closed world doing its job. `.env.local` stays out by
`**/.dockerignore`'s existing `**/.env.local` line, and would now be loud (unknown) if that line ever went.
`deploy-shape.test.js` pins the new shape: `APP_COPY` = the COPY whose sources are exactly `['apps/invoicing']`
with dest `./`, asserted present exactly once; and *the only other COPY sourcing a path under `apps/invoicing/`*
is the cache-layer one — a sub-path COPY would be a partial world again (M1b).
**Item 2.** `classifyTree(dir, depth = 0)`: `SKIPPED_DIRS` applies only when `depth === 0`; deeper, a
skip-named directory is walked like any other **and** collected in a new bucket `nestedSkipped`. Test #3 gains
assertion 0, ahead of the closed-world check, with the message
`<dir> is a SKIPPED_DIRS name below the top level — SKIPPED_DIRS applies to apps/invoicing/ only; rename it or classify its contents`.
Test #7's own walk of `test/` calls `classifyTree(join(APP_DIR,'test'))` at depth 0 — unchanged behaviour.
**Item 3.** Extract the byte-identical per-line loop into `test/helpers/hash-comment.js` exporting
`stripTrailingHashComment(line)`, with one new rule: inside `"…"` a `\` consumes the next character. Single
quotes are untouched (YAML has no backslash escape there; `''` already round-trips). Both files import it;
`stripHashComments` keeps its `{ trailing }` contract and `stripComment` in deploy-shape becomes the import.
AS-53 §11 Q2 said "not now, until a third consumer": the trigger reached first is a bug in both copies plus the
1,200-line cap on `dependency-policy.test.js` (1,185 today, test #7) — a fix that must be made twice gets made once.
**Item 4.** `**/.DS_Store` appended to the repo-root `.dockerignore` (6 → 7 patterns; deploy-shape pins the
count and gains a membership assertion) and `.DS_Store` to the repo-root `.gitignore`.

## 3. Key files (branch plane; nothing on master)
| File | Change |
|---|---|
| `apps/invoicing/Dockerfile` | one whole-directory COPY replaces eight; comments updated to say the world is the directory minus `.dockerignore` |
| `apps/invoicing/test/dependency-policy.test.js` | depth-aware `classifyTree` + `nestedSkipped`; assertion 0 in test #3; stripper loop → helper import; three escape cases in test #2; `UNSCANNED` comment (README.md now in the image). **Must end ≤ 1,200 lines** — record the count |
| `apps/invoicing/test/helpers/hash-comment.js` | new, ~20 lines, the shared per-line stripper |
| `apps/invoicing/test/deploy-shape.test.js` | `stripComment` → import; `APP_COPY`; COPY count 5; ride-along and demo tests assert `APP_COPY`; `.dockerignore` count 7 + `**/.DS_Store` member; one escaped-quote parser case |
| `.dockerignore`, `.gitignore` (repo root) | one line each |
| `apps/invoicing/README.md` | guards table row V2b: the world is now the directory; one sentence |

## 4. Proof burden
No host suite exists; the receipt is `node apps/chat/bin/compose-run.mjs --project asc-impl-as57-<x> --cwd
<worktree>/apps/invoicing` — counts as `tests/pass/fail/skipped` plus the `Image asc-impl-as57-<x>-test Built`
line. **Predicted: master 530/511/0/19 → branch 530/511/0/19** (new assertions live inside existing tests; no
new `test()`); a different count is a finding to explain, not to absorb. Every mutation below follows the
*recipes* template (trap, assert-applied, observe, restore, `git status --porcelain` clean, restored run green).

## 5. Acceptance criteria (Ruben reads plan and diff cold; findings first, then this list as a floor)
Names: DP#2 `the manifest comment stripper works, in both directions`; DP#3 `the scan examines exactly the
files…`; DP#5 `no app source or manifest outside test/ contains an outbound HTTP client`; DS-1 `deploy-shape:
the parsers read the manifests…`; DS-parse `…the parser rejects shapes…`; DS-demo `…the demo service is the
contract service…`; DS-ride `…the manifests ride along as data…`; DS-ign `…the repo-root .dockerignore keeps…`.
1. The Dockerfile has exactly 5 COPYs and `COPY apps/invoicing ./` follows `RUN npm ci`. The evidence the
   image is still whole is the suite itself green on the built image (`assets.test.js` and
   `states-ledger.test.js` prove the vendored files landed); no `web` container needs to be started.
2. **M1** (*recipes*): plant `compose.override.yaml` with the record's outbound healthcheck → red exactly
   {DP#3 "found 4 manifests", DP#5 `compose.override.yaml:4: fetch — not sanctioned`}, 530/509/2/19.
   Also recorded: the same plant on **master** is green 530/511/0/19 — the before picture.
3. **M1b**: reintroduce the eight-line explicit COPY list in place of the whole-directory COPY → red exactly
   {DS-1, DS-demo, DS-ride}, 530/508/3/19; dependency-policy green (README.md left the image; allowed-if-present).
4. `classifyTree` skips `SKIPPED_DIRS` names at depth 0 only; test #3 asserts `nestedSkipped` empty first.
5. **M2**: plant `lib/vendor/probe.js` containing `fetch('https://example.invalid/')` → red exactly
   {DP#3 with the assertion-0 message naming `lib/vendor`, DP#5 `lib/vendor/probe.js:1: fetch`}, 530/509/2/19.
   {DP#3} alone means the directory is still skipped — a finding.
6. `test/helpers/hash-comment.js` exports `stripTrailingHashComment`; both test files import it and neither
   keeps a private copy of the loop (`grep -c "quote = null"` is 0 in both test files).
7. Test #2 gains at least: `k: "a \" # fetch("` unchanged under `trailing: true`; `k: "a\\" # c"` → `k: "a\\" `
   (escaped backslash, the quote really closes); `k: 'a\' # c'` → `k: 'a\' ` (no escape in single quotes).
   DS-parse gains `parseYamlSubset('k: "a \\" # b"\n').k === 'a \\" # b'`.
8. **M3** (*recipes*): the record's `container_name: "asc-inv \" # fetch('https://example.invalid/')"` under
   `web` → red exactly {DP#5 `compose.yaml:32: fetch — not sanctioned`}, 530/510/1/19; deploy-shape green.
9. **M5**: delete the helper's escape line → red exactly {DP#2, DS-parse}, 530/509/2/19.
10. `.dockerignore` has `**/.DS_Store`; `.gitignore` has `.DS_Store`; DS-1 pins 7 patterns; DS-ign asserts
    the member. **M4(i)**: plant `lib/.DS_Store` → green 530/511/0/19 and `git check-ignore -q` exits 0.
    **M4(ii)**: same plant with the `.dockerignore` line removed → red exactly {DS-1, DS-ign, DP#3
    `lib/.DS_Store is neither app source…`}, 530/508/3/19.
11. `wc -l apps/invoicing/test/dependency-policy.test.js` ≤ 1,200 and test #7 green; `harness.test.js`'s
    committed test-file list is unchanged (no new `*.test.js`).
12. Final counted run on the branch tip: 530/511/0/19 with a `Built` receipt; every mutation's restored run
    is the same; `git status --porcelain` clean after each; no `.lattice/` path on the branch; `package.json`
    and product code untouched (`git diff --stat master...<branch> -- apps/invoicing/{app.js,server.js,lib,routes,views,public,package.json}` empty).
13. The Dockerfile's comments and the README row no longer describe an explicit list; the `UNSCANNED` comment
    no longer claims `README.md` exists only on the host.

## 6. Implementation order (each step ends resumable; commit early on the branch)
1. Baseline run on the worktree (predict 530/511/0/19). Record M1's plant green on this baseline (AC 2's
   before picture), then remove it.
2. Item 3 (helper + both imports + cases) → run → commit. 3. Item 2 → run → commit. 4. Item 4 → run → commit.
5. Item 1 (Dockerfile + deploy-shape pins + README row) → run → commit. 6. M1, M1b, M2, M3, M4, M5 in that
order; paste each record into the implementation comment (≤ 300 words; full logs in
`scratchpad/agent-developer-lena/AS-57/`). Do not transition, merge, or push master.

## 7. Open questions, time-boxed
Q1 Should `README.md` be kept out of the image by a `.dockerignore` line? **Default no** — an ignore line
whose only job is to shrink the world adds a second list to maintain; `UNSCANNED` already accounts for it.
Q2 Should `nestedSkipped` also fail on an *empty* nested `vendor/`? **Default: it does** (the bucket collects
directories, not files) — git cannot commit one, so the case is theoretical. Both close at review.
