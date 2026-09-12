# AS-86: AS-75 F2: .dockerignore determines build context but sits outside IMAGE_INPUTS and its COPY-set guard

Planner: `agent:cto-owen`, 2026-09-11, loop tick 22 (watcher:93997). Parent: AS-75
(`.lattice/plans/task_01M1M0RH7TANNAJDD26CXY6W24.md`, §3.1 for the IMAGE_INPUTS design).
Complexity: **medium** (small diff, but it changes the id scheme the live deployer runs on).

## §1 Terms (agree before arguing)

- **image input** — a tracked path under `apps/chat/` whose *committed content* can change the
  bytes of the built image. Today `IMAGE_INPUTS` means "the Dockerfile's COPY sources"; after
  this task it means the sentence above, and the COPY set is the mechanism that makes the two
  coincide.
- **context-shaping file** — a file that changes the image without being a COPY source. The
  only Docker mechanism that does this from inside the context is `.dockerignore` (it decides
  what a `COPY lib ./lib` actually copies). Compose's `build:` block also shapes the build
  (`context`, `args`) but lives in `compose.yaml`, which is already a COPY source.
- **the predicate "goes dirty"** (Ruben's acceptance wording) — the desired id computed by
  `makeDeployOps().computeDesired()` **changes** across a commit, so `decideDeploy` returns
  `{ action: 'deploy', reason: 'stale-build' }` against a container still reporting the
  pre-commit id. It does **not** mean `desired.dirty === true` — that flag is the
  uncommitted-tree refusal (`inputs-dirty`) and is unrelated. Do not conflate the two in
  tests or comments.

## §2 Verified claims (against master cef63a8, read-only)

1. `IMAGE_INPUTS` (`watch/advance-watcher.mjs:104`) is the 9 COPY sources; `.dockerignore` is
   not in it. `computeDesired()` (`:754`) runs `git ls-tree HEAD -- apps/chat/<9>` and
   `git status --porcelain -- <9>`, so a committed edit to `.dockerignore` changes neither the
   id nor the dirty flag. **Confirmed.**
2. The guard (`test/deploy-shape.test.js:291`, "IMAGE_INPUTS is exactly the set the
   Dockerfile COPYs") derives its expected set from COPY lines only, asserting literals
   7 lines / 9 sources / 9 entries. `.dockerignore` is in no COPY line, so the guard cannot
   see the omission. **Confirmed — by construction, as Ruben said.**
3. `.dockerignore` excludes `data/`, `README.md`, `.dockerignore` (itself), `chat`. None of
   those lies under a COPY source, so **today the file is inert for image content**: the
   latent hazard is a *future* edit (e.g. `test/fixtures`, `public/*.map`) silently
   shrinking a COPY'd directory with no rebuild. Ruben's "changes the resulting image" is
   true in kind, not yet in fact — which is also why it is latent.
4. Honest enumeration of everything that alters the build without being a COPY source, from
   Docker's and Compose's actual mechanisms, checked against `git ls-files apps/chat` (102
   tracked paths; the non-COPY'd tracked set is exactly `.dockerignore`, `README.md`, `chat`,
   `data/export/*`):
   - `.dockerignore` — tracked, context-shaping. **The finding.**
   - `Dockerfile.dockerignore` (BuildKit per-Dockerfile variant) — does not exist.
   - `compose.override.yaml` / `.yml`, `docker-compose.override.yaml` / `.yml` — auto-merged
     by compose if present; do not exist.
   - `apps/chat/.env` — compose interpolates `${CHAT_BUILD_ID:-unknown}` from it if present;
     does not exist and is gitignored by the user's global ignore (`*.env`), so it could never
     be tracked here anyway.
   - The base image tag `node:24-slim` — an image input that no git digest can see. **Out of
     scope; tangent parked in §9.**
   - `README.md`, `chat`, `data/**` — in context but ignored, and not COPY'd: **not** inputs.
   So the context-shaping set today has cardinality **1**, and the class Ruben named
   ("any other tracked file that alters build context") is real but currently empty beyond it.
5. No test in `apps/chat/test/` spawns a real `git`; the container test service
   (`node:24-slim`, mountless) has no git and no checkout. Any test that needs real git can
   only run on the host. **Confirmed** (grep; the AS-75 harness injects `run`).

## §3 Approach

Two moves, deliberately small, chosen for what they remove (a second list, a container-blind
guard) rather than what they add.

### §3.1 Make the context-shaping file a COPY source — one list, one guard

- `Dockerfile`: `COPY compose.yaml Dockerfile ./` becomes `COPY compose.yaml Dockerfile .dockerignore ./`.
  Same rationale the line already carries: manifests ride along **as data** so
  `deploy-shape.test.js` can read them in the mountless runner. Extend that comment.
- `.dockerignore`: remove its self-exclusion line (`.dockerignore`). With it present the COPY
  fails the build loudly (`file not found in build context`), which is the right failure
  mode, but the intended state is: the file is in the image, ~300 bytes.
- `IMAGE_INPUTS`: add `'.dockerignore'` → **10** entries. Update the comment block (`:96–103`)
  to state the §1 definition and name `.dockerignore` as the one context-shaping input.
  `computeDesired()` is **not edited** — it maps `IMAGE_INPUTS`, so the ls-tree and status
  calls widen to 10 paths by themselves.
- Existing guard literals move 9 → 10 (sources, entries); COPY lines stay **7**.

Why this and not a separate `CONTEXT_INPUTS` list: a second list is a second hand-maintained
copy of a fact, with a guard that could not read `.dockerignore` in the container (the file
excluded itself from the image). Making it a COPY source means the existing equality guard
*requires* it in `IMAGE_INPUTS` — remove it from the list and the guard fails on cardinality
before the set comparison even runs.

### §3.2 Second expected-set source: the git index, classified

The COPY guard proves `IMAGE_INPUTS == COPY set`. It cannot prove that the COPY set is *all*
of the inputs — that is the hole F2 found, and it reopens the day someone commits
`compose.override.yaml`. So add a classification guard whose source of truth is not the
Dockerfile but **the tracked file list**:

- `watch/advance-watcher.mjs`, new export placed directly after `IMAGE_INPUTS`:
  ```js
  // Tracked paths under apps/chat that are in the build context but NOT image
  // inputs. Every tracked path must be an IMAGE_INPUTS path (or under one), or
  // one of these. Anything else is unclassified, and the guard fails on it.
  export const NOT_IMAGE_INPUTS = Object.freeze(['README.md', 'chat', 'data']);
  export function classifyImagePaths(trackedPaths) // pure -> { inputs, declared, unclassified }
  ```
  Path `p` is an input if `p === x` or `p.startsWith(x + '/')` for some `x` in `IMAGE_INPUTS`;
  declared likewise against `NOT_IMAGE_INPUTS`; otherwise unclassified. Input beats declared
  (assert the two sets are disjoint in the test, so precedence never matters).
- `test/deploy-shape.test.js`, new test: run `git ls-files -- .` with `cwd: APP_DIR` via
  `spawnSync`. **Cardinality first**: exit 0, ≥ 40 lines, and the list contains `Dockerfile`
  and `.dockerignore` (a git that answered nothing must fail here, not pass an empty
  classification). Then `assert.deepEqual(classifyImagePaths(list).unclassified, [])`, with
  the offending paths in the failure message. When `git --version` cannot be spawned
  (`spawnSync` error, or non-zero), `t.skip('git not runnable here — host-only guard')`.
  The skip is a **counted** outcome (`# skipped`), never a silent pass; §6 pins the counts.
- `test/watcher.test.js`, new pure test for `classifyImagePaths` with a literal fixture that
  includes strays: `compose.override.yaml`, `.env`, `Dockerfile.dockerignore`,
  `docs/x.md` → all four in `unclassified`, in order; `lib/store.js`, `.dockerignore`,
  `Dockerfile` → inputs; `data/export/a.jsonl`, `chat`, `README.md` → declared. Assert the
  fixture length (10) before the classification.

### §3.3 `.dockerignore` parsed as data, strictly

`deploy-shape.test.js` gains `parseDockerignore(text)` in the style of `parseCopySources`:
one pattern per line, `#` comments and blanks skipped, trailing `/` stripped and recorded;
**throws** on `!` negation, `*`, `?`, `[`, `**`, leading `/` (BuildKit semantics we have not
needed and would get wrong). New test: patterns parsed = literal **3** (`data`, `README.md`,
`chat`); none equals or prefixes a manifest (`Dockerfile`, `compose.yaml`, `.dockerignore`);
none equals or prefixes any `IMAGE_INPUTS` path (an ignore under a COPY source is exactly the
silent-shrink hazard — if we ever want one, the digest now covers it, but the test should
make the author say so by editing the literal). Plus a throw-on-unrecognised test with a
literal count of forms examined (6), mirroring the COPY parser's.

### §3.4 The acceptance recipe as a test, in a scratch repo

New file `test/deploy-inputs-git.test.js` (host-only; skips as a unit when git is not
runnable, same predicate as §3.2). It builds a scratch repository in `mkdtempSync` — **never
the live tree, never the task worktree**:

1. `git init -q`, identity via `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env; write a stub at every
   `apps/chat/<p>` for `p` in `IMAGE_INPUTS` (directories get one file inside) and at
   `apps/chat/README.md`; commit.
2. `ops = makeDeployOps({ repoRoot: tmp, ..., env: {}, fetchJson: async () => ({ build: { id: A } }) })`
   with the **real** `run` (default `runSync`) — everything else injected as in the AS-75
   harness (`deploy`, `exit`, `readSources`, temp lock/state paths).
   `A = ops.computeDesired().desired.id`; assert `desired !== null` and `dirty === false`.
3. Commit a change to `apps/chat/.dockerignore`. `B = computeDesired().desired.id`.
   **Assert `A !== B`** — this is F2's acceptance line — and
   `decideDeploy({ desired: {id: B, dirty: false}, running: {id: A}, dockerBin: '/x', ... }).action === 'deploy'`.
4. **Negative control** (a test that cannot distinguish is not a test): commit a change to
   `apps/chat/README.md` only; assert the id is **unchanged** from `B`.
5. Second test in the file: commit a stray `apps/chat/compose.override.yaml` in the scratch
   repo; `git ls-files` it; assert `classifyImagePaths(list).unclassified` deep-equals
   `['compose.override.yaml']` — the classifier rejecting a real stray from a real index.

`makeDeployOps` needs no change for this: `repoRoot` and `run` are already parameters.

### §3.5 Docs

`watch/README.md` §"Deploy": "nine image inputs" → ten, name `.dockerignore` as the one
context-shaping input, and the refusals table row (`8 of 9` → `9 of 10`). Two sentences; keep
the diff minimal because AS-88 (docs) follows and will rebase over it.

## §4 Key files

| File | Change |
|---|---|
| `apps/chat/Dockerfile` | `COPY compose.yaml Dockerfile .dockerignore ./` + comment |
| `apps/chat/.dockerignore` | drop the self-exclusion line; comment says why |
| `apps/chat/watch/advance-watcher.mjs` | `IMAGE_INPUTS` +1 (10); new `NOT_IMAGE_INPUTS`, `classifyImagePaths` directly below it. **Nothing else in the file.** |
| `apps/chat/test/deploy-shape.test.js` | literals 9→10; `parseDockerignore`; +3 tests |
| `apps/chat/test/watcher.test.js` | +1 pure test, inserted **immediately after** the `AS-75 parseLsTree` test (~`:667`), not at EOF |
| `apps/chat/test/deploy-inputs-git.test.js` | new, +2 tests, host-only with counted skip |
| `apps/chat/watch/README.md` | two sentences (§3.5) |

## §5 Live-watcher consequence on merge (stated, accepted)

Changing `IMAGE_INPUTS` changes the desired id for the same tree (10 sorted ls-tree lines
instead of 9). On merge the sequence is: (a) the **running, pre-merge** watcher sees a new
9-path id anyway (the Dockerfile and `watch/` blobs changed) and rebuilds once, stamping the
image with a 9-path id; (b) its source digest changed, so once current it exits 70 and launchd
relaunches it on the new code; (c) the new watcher computes a **10-path** id ≠ the stamped
9-path id and rebuilds once more. **Two rebuilds, not one**, ~1–2 min each, once ever. This
is the same self-healing path the `unknown` stamp takes and needs no planning around; the
alternative (carrying a compatibility id) is a permanent cost for a one-time event. The
orchestrator's merge report should predict the second rebuild so nobody reads it as a loop.

## §6 Acceptance criteria (numbered; M4 — each property names its falsifier)

Counts below assume host baseline **498** (`node --test apps/chat/test/*.test.js` on master
cef63a8, this tick; see §7). Predicted host after: **504** (+6: deploy-shape +3,
watcher.test +1, deploy-inputs-git +2), `skipped 0`. Predicted compose (`--build`, Built line
present): **504**, `skipped 2` (both in `deploy-inputs-git.test.js`, git absent in
`node:24-slim`) — if git turns out to be present in the image, `skipped 0` and the report
says so; either way the number is quoted with the reason.

1. `IMAGE_INPUTS` has 10 entries and includes `'.dockerignore'`; the Dockerfile COPYs it;
   `.dockerignore` no longer excludes itself. Guard: existing COPY-set test with literals
   7 / 10 / 10.
2. `git ls-tree HEAD -- <10 paths>` on master returns 10 lines (verify by hand in the report;
   `.dockerignore` is a blob, `lib` etc. are trees — both are one line each).
3. **Mutant M1 — remove `'.dockerignore'` from `IMAGE_INPUTS`** (anchor: the frozen array at
   the `export const IMAGE_INPUTS` site; assert the diff shows 9 entries). Expected red set,
   host, exactly: `deploy-shape: IMAGE_INPUTS is exactly the set the Dockerfile COPYs`
   (cardinality 9 ≠ 10), `deploy-shape: .dockerignore is an image input and hides no
   manifest` (the direct `includes` assertion), `deploy-shape: every tracked path under
   apps/chat is an image input or declared not one` (`.dockerignore` unclassified),
   `deploy-inputs-git: a committed change to .dockerignore changes the desired id`
   (`A !== B` fails — the acceptance property's own falsifier). Four reds; anything else is a
   finding.
4. **Mutant M2 — `classifyImagePaths` swallows strays** (anchor: inside the function body,
   push unknowns to `declared` instead of `unclassified`; assert the mutated line is inside
   `classifyImagePaths`, not another classifier). Expected red set exactly:
   `watcher: AS-86 classifyImagePaths ...` (four strays expected, zero found) and
   `deploy-inputs-git: a stray compose.override.yaml is rejected by the classifier`. Two reds.
5. **Mutant M3 — digest a short set** (anchor: in `makeDeployOps`, the `const paths =`
   line, `IMAGE_INPUTS.slice(0, 9)`; assert the diff is at that line). Expected red set
   exactly: `deploy-inputs-git: a committed change to .dockerignore changes the desired id`
   (`desired` is `null`, reason `inputs-missing`, at step 2 — cardinality refusal fires
   before the digest). One red; note it is the AS-75 refusal doing the catching.
6. **Mutant M4 — `.dockerignore` ignores an image input** (scratch copy of the manifest text
   fed to the test's parser, or in-place with backup + `trap` + `git diff --exit-code`): add
   the line `test/fixtures`. Expected red exactly: `deploy-shape: .dockerignore is an image
   input and hides no manifest` (pattern under an `IMAGE_INPUTS` path). One red.
7. The `.dockerignore` parser throws on all 6 named unrecognised forms and parses the real
   file to exactly 3 patterns (literal counts asserted before comparison).
8. The negative control in §3.4 step 4 is present and green: a README-only commit leaves the
   id unchanged. Report cardinality (10 stubbed inputs, 3 commits) before the pass.
9. Host run: 504 / 504, `skipped 0`. Compose run with `--build` and the `Image ... Built`
   line quoted: 504 total with the skipped count stated and explained (§6 preamble). **No
   build line, no valid number.**
10. Implementation report states, in order: the mutant red sets observed for M1–M4 (exact
    test names, count), the `ls-tree` line count from criterion 2, both suite counts with
    receipts, and the §5 double-rebuild prediction restated for the merge tick.
11. `computeDesired`, `decideDeploy`, `parseLsTree`, `evaluate`, `shutdown` are **unchanged**
    (`git diff master...branch -- apps/chat/watch/advance-watcher.mjs` touches only the
    `IMAGE_INPUTS` block and the new exports beneath it) — the seam guarantee to AS-84/AS-87.

## §7 Baseline

Host suite on master cef63a8, run this tick from the repo root as
`node --test apps/chat/test/*.test.js`: **498 pass / 0 fail / 0 skipped** (matches the
receipt in the AS-83/AS-74 merge commit). Compose not run this tick (docker off PATH; AS-83
flake condition under concurrent builds; budget).

## §8 Seam note — parallel lanes this tick

- **AS-84** (same tick): `advance-watcher.mjs` `shutdown()`, lock release, `lastAttempt`,
  `evaluate()` (~`:830–960`, `:2270+`); tests in `watcher.test.js` around `deployHarness`
  (`:786+`) and `watcher-main.test.js`. **Overlap with AS-86: same two files, disjoint
  regions.** AS-86 touches `:96–115` of the watcher and inserts its one test right after the
  `AS-75 parseLsTree` test — never at EOF, so the two lanes' appends cannot collide.
  `deployHarness` derives its fake `lsTree` from `IMAGE_INPUTS` (`:793`), so the 10th entry
  flows into AS-84's tests automatically; AS-84 must not hard-code 9.
- **AS-85** (same tick): `server.js` `loopStateKey`, `stream.test.js`. **No overlap.**
- **AS-87** (next by age): `makeDeployOps` `persist`/`performDeploy`. AS-86 leaves
  `computeDesired` untouched; no overlap.
- **AS-88** (docs): will touch `watch/README.md`; AS-86's two sentences there should land
  first so AS-88 documents the 10-input state.
- **Recommended merge order:** AS-85 → **AS-86** → AS-84 → AS-87 → AS-88. AS-86 before AS-84
  so AS-84's rework (if any) rebases onto the final `IMAGE_INPUTS` and its test-file
  insertion point rather than the reverse; AS-85 first because it is independent and
  unblocks nothing here. Each of AS-84/AS-86/AS-87 triggers a rebuild + watcher restart on
  merge regardless of order; AS-86 alone adds the §5 second rebuild.

## §9 Parked tangent (not in scope)

`FROM node:24-slim` is an image input outside git: a tag re-point rebuilds nothing and
changes everything. Pinning by digest (`node:24-slim@sha256:…`) would turn base-image drift
into a Dockerfile edit, which the predicate then sees. Not this task; candidate follow-up,
default answer "pin when we first deploy off this laptop", to revisit at the Digital Ocean
milestone.

## §10 Staffing and branch

- **Implementer: `developer-lena`.** Self-contained medium spanning manifests, one pure
  export, and tests — her lane by doctrine — and it keeps Marcus free for AS-84, the
  watcher-internals task, so no one holds two branches on `advance-watcher.mjs` at once.
- **Reviewer: `qa-priya`.** Ruben filed F2 and wrote the acceptance sentence; he is not the
  implementer, so the developer≠reviewer gate holds either way, but he is anchored to his
  own framing of *what the context-shaping set is*, and the honest enumeration in §2.4 is
  the thing most worth a cold reader's disagreement (M6). Priya reads it cold. Ruben's seam
  strength is better spent on AS-84, the lane with the real merge seam. **Anchoring rule for
  the review tasking message:** give Priya the plan path and criteria, not the mutant red
  sets or the counts (they are in this plan, which she reads — but the tasking prompt must
  not restate them), and tell her not to read the Lattice auto-review if one has posted.
- **Branch:** `feat/AS-86-dockerignore-image-input`.
