Lattice-Reviewed-Commit: 4eda7db3fbb8e02b0ad30874ec9120cfe2b07553

# Code Review: AS-99 — Chat: git worktree observability in the chat UI

> **Provenance.** This is the Lattice auto-fired review (generic `claude` actor), which
> CLAUDE.md § "The Review Gate" says is third-party tooling output and **not** the company's
> review gate. The named `qa-*` employee's `--role review` comment governs. Per the anchoring
> rule, the QA reviewer should form their own findings before reading this.
>
> **What was reviewed.** The prompt's embedded diff was truncated by Lattice (the
> `advance-watcher.mjs` hunk was cut after the `DEFAULTS` change), so the review was done
> against the branch directly: `feat/AS-99-lane-view` at `688496f` vs `master`, 11 commits,
> 15 files, +2527/−13. Worktree `.worktrees/AS-99` was clean.

## 1. Verdict

**PASS** — with two minor findings outside the acceptance list that the QA employee should
fix inline or carry into the same cycle (Issue 1 is a wording defect on the exact STALE case
the feature exists to flag). Nothing here is plan-level.

Findings first (M5): **2 minor defects, 4 observations** outside the criteria list. Sweep
second, labelled as a floor check: 14/14 acceptance criteria have a named test and were
observed live where a live probe was possible (below). The counted `docker compose run --rm
--build test` receipt is **not** produced by this review and remains owed before `done`.

## 2. Summary

The branch implements the plan as written: a watcher-side `makeLanesOps` factory writing
`apps/chat/data/worktrees.json` every poll, a pure server-side composer joining it to
`.lattice/tasks` read live, `GET /api/lanes` plus a change-only `event: lanes` SSE frame, and
a pure label module driving a DOM-only pane. Quality is high — the split of pure parser /
classifier / composer / label module from effects is consistent with the existing
`makeDeployOps` / `loop-status.js` patterns, and every reason enum has a sentence. Both
cycle-1 findings (F1 git-error-as-zero, F2 absolute-path leak) are verifiably fixed. The key
new finding is that a merged branch's card says "no commits on branch yet" next to its own
"STALE — merged" badge.

**Runs and probes performed (cardinality before quantification):**

| Check | Result |
|---|---|
| Host run `node --test` in the worktree (labelled HOST, not the compose receipt) | 420 tests, 420 pass, 0 fail |
| `makeLanesOps.evaluate()` against the real host repo (`/usr/bin/git`) | 190 ms, 3 rows (main + AS-28 + AS-99), all fields populated, `errors: []` |
| `composeLanes` over that snapshot + real `.lattice` | 3 lanes: AS-28 and AS-99 `branch-link`, AS-100 `task-only`; AS-99 shows `assignee agent:cto-owen` / `lastCommitAuthor developer-marcus` / `agree:false` |
| Branch server on an ephemeral port, `GET /api/lanes` | lane key set exactly `key,task,joinedBy,worktree,employee,stale,stageStartedAt,subAgent`; `/lanes.js` 200 |
| Copied snapshot (fresh mtime, old `generatedAt`) | `reason: stale-snapshot`, `stale: true`, count kept — AC-11's falsifier observed live |
| File removed | `reason: no-snapshot`, `lanes: null` |
| `/api/stream?me=human:forrest` | on-connect frames `loop, lanes` in that order; 0 lanes frames over ~6 idle polls; exactly 1 after one `generatedAt` rewrite; 1 more on file removal (AC-12 observed live) |
| Throwaway `git worktree add --detach /tmp/as99-probe-wt master` on the host, then removed | snapshot row `relPath: "<outside repo>/as99-probe-wt"`, `detached: true`; lane `task: null`, `joinedBy: null`; card renders as unknown-task; `JSON.stringify(projection).includes('/tmp/as99')` → `false` (F2 fix observed) |
| `describeLane` over a merged + done lane | see Issue 1 |

## 3. Issues

**[minor] apps/chat/public/lanes.js:~233 — A merged lane's last-commit field reads "no commits on branch yet"**
`describeLane` chooses the wording on `wt.ahead === 0` alone. After a `--no-ff` merge the
branch tip is *also* `ahead 0` (every commit is now on master) and the tip's author is the
developer who worked the lane — the exact STALE case this feature was built to surface.
Observed: for `{ahead: 0, merged: true, stale: {reasons: ['task-done','merged']}}` the card
renders `no commits on branch yet (tip by developer-marcus, 2 h ago)` directly under
`STALE — its task is done and its branch is already merged into master`. The card
contradicts itself; the "tip by" author is not "whoever last committed to master" as plan
T3.2 assumes, it is the lane's own developer. The plan's T3.2 wording only holds for
`ahead 0 && merged === false`.
**Fix:** branch on `wt.merged === true` first — e.g. `merged · last commit by <who>, <when>
ago — <subject>` — and keep "no commits on branch yet" for `ahead === 0 && merged !== true`.
Add a `lanes-label-merged-last-commit` test with a site-anchored mutant (drop the `merged`
branch → red). Implementation-level, a few lines; suitable for an inline fix.

**[minor] apps/chat/lib/lanes.js:74 (`worktreeView`) — the key whitelist is one level deep; `lastCommit` passes through whole**
`LANE_WORKTREE_KEYS` stops at `lastCommit`, whose object is copied as-is from the snapshot.
The watcher (host) and the server (container image) run at different versions across a
deploy, which is precisely why AC-13's whitelist exists; a field added to
`parseLastCommit` on the host reaches a browser with no server-side decision. Today the
snapshot's `lastCommit` carries `authorEmail`, which is fine by convention
(`@agents.american-software.local`) but is already the first field a board member might not
expect to see fanned out to every viewer.
**Fix:** whitelist `['sha','authorName','authorEmail','committedAt','subject']` in
`worktreeView` and extend `api-lanes-key-whitelist` to `deepEqual(Object.keys(lane.worktree.lastCommit), [...])`.

## Observations (not defects; recorded for the next mind)

- **`relPathOf` compares raw strings, no realpath** (`watch/advance-watcher.mjs`, `relPathOf`).
  `config.repoRoot` comes from `import.meta.url` or `ADVANCE_REPO_ROOT`; git prints canonical
  paths. Verified equal on this host (`.worktrees/AS-28`, `.worktrees/AS-99`). An
  `ADVANCE_REPO_ROOT` through a symlink (or a `/tmp` → `/private/tmp` path on macOS) would mark
  every lane `<outside repo>/AS-n`. Cosmetic — the main row is dropped by `main`, not by
  `relPath` — but a one-line `realpathSync` on `repoRoot` in the factory closes it.
- **`locked` / `prunable` are parsed and then dropped.** A worktree whose directory was
  deleted without `git worktree remove` (`prunable`) renders as a lane with four
  `git could not answer` errors and `dirty: unknown` rather than "prunable". T4 does not list
  the field, so this is in-scope for a follow-up, not this task.
- **`renderLanes()` rebuilds the whole pane** on every `loop` frame, every `lanes` frame and
  the 15 s timer, so the `.lane-now` transient element is replaced each time. AS-103 must keep
  activity in `state` and render from it, never write into the node. Worth a line in AS-103's
  plan.
- **Performance (confirms cycle-1 F5).** `evaluate()` is synchronous spawns on the watcher's
  event loop: 190 ms measured for two linked worktrees (~9 spawns); ~13 spawns at WIP 3.
  The sentinel poll is 5 s, so a sub-second stall every 15 s is harmless. `rev-list
  --first-parent master` is run once per poll and its output grows with history — still
  milliseconds here.
- **Server construction primes `lastLanesKey = lanesKey(readLanes())` outside a `try`**, unlike
  the poll. No throwing path was found (`listTasks` and `readLoopFile` are tolerant, the
  composer null-checks every access), so this is symmetry, not a bug.
- **`fmtAge` tops out at hours** (`72 h` for a three-day-old tip). Matches `loop-status.js`;
  cosmetic.

## Acceptance-criteria sweep (floor check — a floor, not the review)

| AC | Test(s) present | Observed |
|---|---|---|
| AC-1 porcelain parse | `lanes-parse-*` in `test/lanes.test.js` | pass; live: detached row parsed correctly |
| AC-2 generatedAt advances | `watcher-lanes-generatedAt-advances` | pass |
| AC-3 git down is a fact | `watcher-lanes-git-down`, `watcher-lanes-never-rejects`, `-never-rejects-midway` | pass; second half (never rejects) closed in `971d6a1` |
| AC-4 per-row isolation | `watcher-lanes-row-isolation` | pass |
| AC-5 `--no-optional-locks` argv pin | `watcher-lanes-argv-pin` | pass; argv matches plan exactly |
| AC-6 merged classification | `watcher-lanes-merged` + composer tests | pass |
| AC-7 join rule / cardinality | `lanes-compose-*` | pass; live: `branch-link` beat name parse for AS-28/AS-99 |
| AC-8 task-only membership | `lanes-compose-task-only-membership` | pass; live: AS-100 (`planned`) task-only |
| AC-9 STALE reasons | `lanes-stale-reasons` | pass |
| AC-10 employee two fields | `lanes-employee-both-fields` | pass; live: AS-99 `agree:false` with both fields |
| AC-11 freshness boundary | `api-lanes-stale-boundary` | pass; live: copied file with fresh mtime → stale |
| AC-12 change-only push | `stream-lanes-change-only` | pass; live: 0 idle frames, 1 per rewrite |
| AC-13 key whitelist | `api-lanes-key-whitelist` | pass at lane and worktree level; see Issue 2 for `lastCommit` |
| AC-14 the words | `lanes-label-*`, `api-lanes-git-error-badge` | pass; F1 fix verified (git-error → dash badge, reason-keyed empty state) |

**Still owed before `done`, unchanged from cycle 1:** the counted `docker compose run --rm
--build test` receipt with the `Image … Built` line from a session with docker; the browser
probes (phone-width field count, kill-the-watcher stale caption at ~60 s, real-DOM Escape
ordering with both modals open). This review could not produce them.

## 4. Positive Observations

- **Effects are injected everywhere.** `makeLanesOps` takes `run`, `now`, `writeState`, `log`;
  `composeLanes` takes the clock and files as arguments; `public/lanes.js` is DOM-free. Every
  rule in the plan is a unit test rather than an argument, and the real-repo probe above needed
  no mocking to run the production path.
- **The cycle-1 fixes are principled, not patched.** F1 was fixed by introducing
  `UNMEASURED_REASONS` and keying the empty-state sentence off the reason (with the badge
  string explicitly disowned as a key, in a comment that names the failure). F2 was fixed with
  an `OUTSIDE_REPO` marker that cannot collide with a real repo-relative path, keeping the
  basename so two outside worktrees stay distinct lanes.
- **`evaluate()` never rejects, and the failure shape carries a timestamp.** Both the
  throwing-runner and the throw-mid-row cases are tested, and the mid-row case degrades to
  the error shape rather than a partial list.
- **`lanesKey` reasoning is written down.** Including `generatedAt` and `stale`, excluding
  `ageS`/`checkedAt`, with the "one small frame per snapshot is the liveness signal" rationale —
  observed live as exactly one frame per rewrite.
- **The enum-to-sentence key-set assertions** (`SNAPSHOT_REASON_CODES` vs
  `LANES_REASON_CODES`, `EMPTY_STATE_CODES`) make "a reason without a sentence" a red test.
- **Zero-dependency and container-safe.** No git in the image, no new mounts, the composer's
  only watcher import is the `MID_LIFECYCLE` constant so the lane definition cannot drift from
  the loop's.
- **`dirtyLattice`** surfaces the two-plane-rule violation from CLAUDE.md's working-directory
  hazard for free — a good example of observability that reads the company's own rules.
