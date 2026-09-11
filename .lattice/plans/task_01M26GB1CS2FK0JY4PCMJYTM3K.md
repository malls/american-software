# AS-99: Chat: git worktree observability in the chat UI

SOURCE: board DM msg 651 (human:forrest, 2026-09-10T20:26Z): 'I think we need git worktree observability in the chat UI. Maybe Jonah can come up with a good look for feel for this.' Filed by the CTO on the board member's behalf. UX owner: agent:ux-jonah.

WHY NOW: the WIP limit went 1 -> 3 today (#board msg 642). Up to three tasks now run in parallel lanes, each in its own worktree under .worktrees/AS-<n> with its own employee, and none of that is visible from the chat app. The only views are 'git worktree list' and 'lattice branch-link', and both need a shell on the host. The board's stated interface with the company is the chat app; once AS-95 lands and one message drives a whole loop of ticks, the lanes are the thing the board most needs to see and cannot.

WHAT (v1, plausible scope -- the plan refines it): a READ-ONLY view of every linked worktree, one row each: path; branch; linked task (join key AS-<n> from the branch name / lattice branch-link, deep-linked the way AS-93 links task ids); commits ahead of master; dirty or clean; last commit author (employee id, per the git identity convention) and age; and a STALE flag when the worktree still exists but its task is done or cancelled (or the branch is already merged). Derived, never hand-maintained: fed from 'git worktree list --porcelain' plus 'git log master..<branch>' / 'git status --porcelain' per worktree, joined to .lattice/ read-only -- the same doctrine as the derived org chart (AS-33) and the Lattice deep links (AS-93). Explicitly NOT in v1: any write action (no remove-worktree, no merge, no status transition from the UI).

TWO-STAGE PLANNING: (1) Jonah's UX pass -- user flows, screen inventory, state spec (empty / one lane / three lanes / stale / unknown-task), and a low-fi static wireframe under docs/design/ in the AS-30 mould; it is the first half of in_planning. (2) The CTO's technical plan is the second half and consumes the wireframe. Then the normal implement / review lifecycle.

PLANNING QUESTION (decided in the plan, NOT here): the chat server runs in a container and cannot run git against the host repo today. Two candidate feeds: (a) the host watcher writes a worktrees snapshot JSON next to deploy-state.json (apps/chat/data/) on each tick / on a short interval, and the server renders that -- same pattern the deploy line already uses; (b) a read-only mount of the host checkout into the container and git run inside it. (a) keeps git off the container and reuses an existing pipe but is only as fresh as the watcher; (b) is live but adds git to the image and mounts the whole repo. The plan chooses, states the freshness guarantee, and names the falsifier for it (M4).

ORDERING: in the critical Chat set (title prefix 'Chat:', tag chat). Position within the set is the CTO's call (board delegation DM msg 614) and is recorded in a comment on this task and in CLAUDE.md section 'Scheduling priority' by the metawork layer.

## UX half (ux-jonah, 2026-09-11)

Four artifacts under `docs/design/chat-lanes/` (new directory, does not collide with the
AS-30 D1 wireframe set):

- `00-flows.md` — who/where (board, chat app, desktop + phone/tailnet), 4 flows (glance,
  drill-in, watch-a-tick-live, return-after-reload), one entry point (sidebar "Lanes"
  button, org-chart-button pattern).
- `01-screens.md` — placement call, lane card field list/order, whole-tick liveness
  line, visibly-absent placeholder slots, screen count (1).
- `02-states-ledger.md` — 11 pane/transient states incl. the 2 required by the board
  ruling (decayed, blank-after-reload) plus snapshot-missing/-stale.
- `lanes.html` (+ `lanes.css`) — one composite wireframe: three lanes, one stale, one
  "now:" state per lane (live/decayed/blank), reusing `../wireframes/wireframe.css` and
  `../tokens/tokens.css`, zero JS, opens from `file://`.

**Placement:** a dedicated "Lanes" pane opened from a sidebar button (same pattern as
the existing "Org chart" button), not an inline sidebar section — the card is too dense
for the rail, and it's the seed of the north-star foreman floor, which needs a canvas.
A passive lane-count badge stays in the sidebar for the ambient glance.

**Decay N = 15 seconds** for the transient "now:" line (rationale in
`02-states-ledger.md`): long enough that a normal single-tool-call pause doesn't
flicker into decay, short enough the board isn't trusting a minute-old line as current.
Explicitly a UX default the technical/AS-103 plan may retune, not a measured constant.

**Open questions for the technical half:**
1. Does the projection carry `generatedAt` (yes, per NORTH STAR item 3) — confirm the
   UI's snapshot-age caption (`LANES-SNAPSHOT-STALE`) reads that field directly rather
   than inferring age from file mtime, which would break if the snapshot is ever synced
   or copied.
2. How is "employee" sourced when the task's Lattice assignee and the worktree's last
   commit git author disagree (e.g. a rework cycle reassigns, or the orchestrator
   commits board state under its own identity)? The wireframe shows both, assignee
   first — confirm the projection actually carries both fields rather than one merged
   value.
3. Does `unknown-task` (a worktree with no branch-link) actually surface via
   `git worktree list --porcelain` in a form the projection can join, or does it need a
   separate no-join fallback path? The card design assumes it always gets *a* branch
   name to show even without a task join.
4. For `lane-with-no-worktree-yet` (in_planning, no branch cut): does the snapshot even
   have a row for this, or does the UI need to merge in `.lattice` in_planning/planned
   tasks itself to render that state? If the feed is worktree-sourced only, this state
   may need a second, `.lattice`-sourced input to the same projection.
5. Confirm AS-103's push frames carry no persistence/replay — if a frame is ever
   buffered even briefly server-side, `blank-after-reload` needs a "there's a backlog"
   variant instead of a flat empty line; the wireframe assumes strictly ephemeral,
   fire-once delivery.

Not built this tick: the actual sidebar badge/button wiring (implementation stage) and
any full-ledger-coverage wireframe beyond the one composite state (scoped out in
`lanes.html`'s own notice — see `02-states-ledger.md` for the rest of the rows).

---

## Technical half (cto-owen, 2026-09-11, tick watcher:76266)

Consumes Jonah's half above verbatim; nothing in it is redrawn. Terms used below, so
nobody has to guess: a **worktree** is a row of `git worktree list`; a **lane** is the
unit the pane renders (a task in flight, with or without a worktree); the **snapshot** is
the file the host watcher writes; the **projection** is the JSON the server serves and
pushes. The snapshot is a source; the projection is the contract (NORTH STAR item 3).

### T1. The feed — decision: (a), a watcher-written git snapshot, joined server-side

**Chosen:** the host watcher (`apps/chat/watch/advance-watcher.mjs`) runs git against
the real checkout and writes `apps/chat/data/worktrees.json` (tmp + rename) on its own
poll; the chat server reads it with the existing `readLoopFile` degradation contract and
composes the lane projection by joining it, at request/poll time, to `.lattice/tasks`
(read-only, via the existing `/repo` mount and `lib/lattice.js`).

**Why (b) — a read-only mount and git in the container — loses, on facts not taste:**

1. The image is `node:24-slim`; there is no git binary and the Dockerfile's contract is
   "official base only, no installs" (AS-2/AS-4). (b) adds a package to the image for one
   feature.
2. Linked worktrees do not travel. Each `.worktrees/AS-n/.git` is a *file* containing
   `gitdir: /Users/forrest/Code/american-software-company/.git/worktrees/AS-n` — an
   absolute host path. Mounted at `/repo`, `git -C /repo/.worktrees/AS-n status` fails
   before it starts. Making it work means mounting the repo at the host's exact absolute
   path inside the container, plus `safe.directory` for the uid mismatch. That is not a
   mount, it is a fiction the container has to maintain.
3. The server's file gate (AS-26) makes `.git` categorically unreachable by construction,
   and the compose comment records that as a boundary. (b) would be the first in-container
   process that reads `.git` on purpose; the container must never gain repo write access,
   and a git binary in an image is a write-capable tool one bug away from being used.
4. Precedent already exists three times over: `deploy-state.json` (AS-75),
   `advance-loop.json` (AS-95) and `advance-watcher.pid` (AS-27) are all host-watcher
   facts the container cannot compute, written to `apps/chat/data/` and read by
   `readLoopFile`. This is the fourth file in that table, not a new mechanism.

**Cost of (a), stated:** the git half is only as fresh as the watcher. That is the same
cost the build line already carries and it is bounded below (T2). When the watcher is
down the snapshot stops moving and the pane says so within 60 s; it never shows a
frozen list as current (Jonah's `LANES-SNAPSHOT-STALE`).

**Why the join is server-side, not in the watcher:** the server already reads
`.lattice/tasks` read-only (`lib/lattice.js`, `assignmentsByActor`), so the Lattice half
of every card — stage, assignee, title — is live, not snapshot-aged; the
`LANES-NO-WORKTREE-YET` rows (Q4) fall out of the same read; and AS-100's event stream
later joins as a *third input to the same composer* rather than as a rewrite of the
watcher. One projection, many sources, many views. AS-99 ships without AS-100: the
fields AS-100 will fill are present and `null` (T4), rendered as Jonah's placeholders.

**Poll cadence and the git calls.** The watcher gets a third interval beside the sentinel
poll (5 s) and the deploy poll (60 s): `DEFAULTS.lanesPollS = 15`
(`ADVANCE_LANES_POLL_S`). Per poll: one `git worktree list --porcelain`, then per linked
worktree four read-only calls — `rev-list --left-right --count master...<head>`
(ahead/behind), `--no-optional-locks status --porcelain` (dirty; the flag exists exactly
so a background status never writes a worktree's index), `log -1 --format=…` (last
commit), and `merge-base --is-ancestor <head> master` plus a first-parent membership
check (merged — see T4). At WIP 3 that is ≤ 13 spawns per 15 s on the host; nothing
runs in the container. The lanes poll is **not** gated by `busy`: a tick is when lanes
change, and every call is read-only. A snapshot taken mid-`git worktree add` or
mid-commit is tolerated per row (T4 `errors[]`), never a crash and never a skipped poll.

**When the watcher is down / pre-AS-99:** no file → `reason: 'no-snapshot'` (pane:
"Lane data unavailable", `LANES-SNAPSHOT-MISSING`); file older than the threshold →
`stale: true` with the age caption. Since AS-75 the watcher restarts itself when its
source changes, so the first snapshot appears about a minute after this merges without
anyone touching launchd.

### T2. Freshness guarantee (the M4 property) and its falsifier

**Property:** while the watcher is alive, `generatedAt` in the snapshot advances on
every lanes poll — it is written every poll whether or not content changed — so a
snapshot whose `generatedAt` is older than `LANES_STALE_MS = 60_000` (four polls; the
same figure as `WATCHER_STALE_MS`) is reported `stale` by the server, and the UI never
renders it as current. Age is computed from `generatedAt` **only** — never from file
mtime (Q1) — so a copied or synced file cannot look fresh.

**Falsifiers** (each an observed red, listed as AC-2 and AC-11 in T6): a planted
snapshot with a fresh mtime and a 61 s-old `generatedAt` must come back `stale: true`;
59 s must not; two `evaluate()` calls on an injected clock 15 s apart with identical git
output must write two files with different `generatedAt`.

### T3. Answers to the five open questions

1. **`generatedAt` — yes, directly.** The snapshot carries `generatedAt`; the projection
   copies it as `snapshot.generatedAt` and adds `snapshot.ageS` (server clock) and
   `snapshot.stale`. The client recomputes age locally from `generatedAt` on the existing
   15 s render timer (the AS-27 pattern) and never reads a mtime — there is no mtime in
   the payload to read. AC-11 is the falsifier.
2. **Employee — both fields, never merged.** The projection carries
   `employee.assignee` (Lattice `assigned_to`, may be null) and
   `employee.lastCommitAuthor` (git `%an` of the branch tip, which by the git-identity
   convention is the actor id minus `agent:`), plus `employee.agree` (`true`/`false`, or
   `null` when either side is missing). The UI shows the assignee first and the git
   author labelled when they disagree, exactly as drawn. Disagreement is information
   (a rework reassignment, or a branch someone else committed on), not noise to resolve.
   When `ahead` is 0 the branch tip *is* a master commit and its author is whoever last
   committed to master; the card states "no commits on branch yet" next to it rather than
   pretending that author worked in the lane.
3. **Unknown-task — yes, git always gives us a path and a HEAD.** `git worktree list
   --porcelain` emits `worktree <path>` and `HEAD <sha>` for every row, then `branch
   refs/heads/<name>` **or** `detached`. So a lane without a Lattice join still has
   `relPath`, `head` and either a branch name or `detached: true` with the short sha. The
   composer's no-join fallback is a first-class path: `task: null`, `joinedBy: null`,
   card rendered with branch/path in the task slot (`LANES-UNKNOWN-TASK`), never
   filtered out (AC-7 forbids the filter).
4. **No-worktree-yet — yes, a second `.lattice`-sourced input, same composer.** Lane
   membership is defined as the union of (i) every non-main worktree row and (ii) every
   task whose status is in `MID_LIFECYCLE` (`in_planning`, `planned`, `in_progress`,
   `review` — the watcher's own exported constant, so the definition cannot drift from
   the loop's) that no worktree row joined to. A `needs_human`/`blocked` task with no
   worktree is not a lane (it holds no WIP slot); with a worktree it is (the worktree
   exists and the board should see it). Such rows carry `worktree: null` and the UI
   prints "not cut yet" in the git fields — never `0` and never `clean` (AC-8, AC-14).
5. **AS-103 frames — strictly ephemeral, confirmed for the server as it stands.** The
   SSE fan-out is write-through: `store.onMessage` / the poll loops call `res.write` on
   each live connection and hold nothing; there is no `Last-Event-ID` handling, no
   replay buffer and no queue. Blank-after-reload is therefore the correct state, and
   there is nothing to build a "backlog" variant against. Recorded as a constraint on
   AS-103's plan: activity frames must be pushed the same way (no buffering, no replay),
   or Jonah's ledger needs a new row first. AS-99 reserves the join key for those frames
   (`lane.key`, T4) so AS-103 does not have to invent one.

**Also decided, because Jonah left it to this half:** the sidebar badge shows a **count**
("Lanes · 2"), not "2/3". The WIP limit lives in CLAUDE.md prose; nothing on disk carries
it as data, and a denominator the UI cannot source is invented data. When the snapshot
is missing the badge shows "Lanes · –", never "0" (Flow 1a; AC-14).

### T4. Shapes: the snapshot file and the projection

**Snapshot — `apps/chat/data/worktrees.json`, written by the watcher.** Faithful mirror
of git; the main checkout is included and flagged so the file is a complete answer to
"what does `git worktree list` say", and the projection drops it.

```json
{
  "schema": 1,
  "source": "watcher:git",
  "generatedAt": "2026-09-11T03:50:12.345Z",
  "master": { "head": "f6717b816cdc4d66539205799f779373c0f9c759" },
  "error": null,
  "worktrees": [
    { "relPath": ".", "main": true, "head": "f6717b81…", "branch": "master", "detached": false,
      "ahead": null, "behind": null, "dirtyCount": null, "dirtyLattice": null, "merged": null,
      "lastCommit": null, "errors": [] },
    { "relPath": ".worktrees/AS-99", "main": false, "head": "3c1a…", "branch": "feat/AS-99-lane-view",
      "detached": false, "ahead": 4, "behind": 2, "dirtyCount": 3, "dirtyLattice": false, "merged": false,
      "lastCommit": { "sha": "3c1a…", "authorName": "developer-marcus",
                      "authorEmail": "developer-marcus@agents.american-software.local",
                      "committedAt": "2026-09-11T03:41:07-04:00", "subject": "AS-99: lanes composer" },
      "errors": [] }
  ]
}
```

- `relPath` is relative to the repo root; the absolute host path is **not** written into
  the snapshot (nothing downstream needs it, and the nonce rule — keep host-private
  facts out of the payload — applies by analogy).
- `error` (top level) is `null`, `'no-git'`, or `'worktree-list-failed: <stderr>'`; on any
  top-level error `worktrees` is `[]` and `generatedAt` is still written — a failed poll
  is a fact with a timestamp, not a missing file.
- `errors[]` per row lists the per-worktree git calls that failed (`"status: exit 128 …"`);
  the fields those calls feed are `null`; the other fields are still filled. One broken
  worktree never blanks its neighbours (AC-4).
- `dirtyLattice` is true when any dirty path is under `.lattice/` — the two-plane-rule
  violation CLAUDE.md § "Working-directory hazard" describes, surfaced for free. The card
  shows it inside the working-tree field ("dirty · 3 files · incl. .lattice").
- `merged` is a pure classification over three git facts: `ahead === 0`, `head` is an
  ancestor of master, and `head` is **not** on master's first-parent chain
  (`git rev-list --first-parent master` does not contain it). All three are needed: a
  branch just cut from master's tip is an ancestor with `ahead 0` too, and the
  first-parent test is what separates "merged with `--no-ff`" from "never committed on".
  Known limit, recorded: a squash merge (AS-94 was one, by the board on GitHub) leaves a
  tip that is not an ancestor, so git alone cannot see it; the task-status half of the
  STALE flag covers that case once the task is `done`.

**Projection — `GET /api/lanes` → `{ lanes: <projection> }`, and `event: lanes` frames
carry the same object.** Composed by `lib/lanes.js` (`composeLanes`, pure) from the
snapshot, the task list and the clock:

```json
{
  "checkedAt": "2026-09-11T03:50:20.000Z",
  "snapshot": { "generatedAt": "2026-09-11T03:50:12.345Z", "ageS": 8, "stale": false,
                "reason": "ok", "error": null },
  "count": 2,
  "lanes": [
    { "key": "AS-99",
      "task": { "shortId": "AS-99", "taskId": "task_01M26GB1CS2FK0JY4PCMJYTM3K",
                "title": "Chat: git worktree observability in the chat UI",
                "status": "in_progress", "assignee": "agent:developer-marcus" },
      "joinedBy": "branch-link",
      "worktree": { "relPath": ".worktrees/AS-99", "branch": "feat/AS-99-lane-view", "detached": false,
                    "head": "3c1a…", "ahead": 4, "behind": 2, "dirtyCount": 3, "dirtyLattice": false,
                    "merged": false, "lastCommit": { "…": "as in the snapshot" }, "errors": [] },
      "employee": { "assignee": "agent:developer-marcus", "lastCommitAuthor": "developer-marcus", "agree": true },
      "stale": { "flag": false, "reasons": [] },
      "stageStartedAt": null,
      "subAgent": null },
    { "key": "AS-100", "task": { "…": "status in_planning" }, "joinedBy": "task-only",
      "worktree": null, "employee": { "assignee": "agent:cto-owen", "lastCommitAuthor": null, "agree": null },
      "stale": { "flag": false, "reasons": [] }, "stageStartedAt": null, "subAgent": null }
  ]
}
```

- `snapshot.reason` ∈ `ok | stale-snapshot | no-snapshot | unreadable-snapshot |
  git-error` (the last mirrors the file's own `error`). On `no-snapshot` /
  `unreadable-snapshot`, `lanes` is `null` and `count` is `null` — Jonah's ledger says a
  partial list must not masquerade as the list, and the Lattice-only half *is* partial.
  On `stale-snapshot` the lanes render with the age caption.
- **Join rule, in order:** (1) a task whose `branch_links[].branch` equals the worktree's
  branch (`joinedBy: 'branch-link'`); (2) else the first `AS-\d+` in the branch name
  resolved through `ids.json` (`'branch-name'`); (3) else `task: null`, `joinedBy: null`.
  Task-only lanes are `'task-only'`. `key` is the short id when joined, else `relPath`.
- **Order:** worktree lanes by `relPath`, then task-only lanes by short id — slot order,
  deterministic, no ranking (Jonah §5.1).
- `stale.reasons` ⊆ `['task-done', 'task-cancelled', 'merged']`; `flag` is
  `reasons.length > 0`.
- `stageStartedAt` and `subAgent` are reserved for AS-100 and are always `null` here; the
  UI renders Jonah's two placeholder slots from them. `key` is reserved as the join key
  for AS-103's transient frames. Adding those producers changes no field name.
- No `me`, no visibility gate, no store access — the same contract as `/api/loop-status`.
  The lane's `worktree` object is an exact-key whitelist (AC-13), the AS-27 rule that
  keeps a grown file from leaking a new field.

### T5. Server, watcher, client — what changes where

| File | Change |
|---|---|
| `apps/chat/watch/advance-watcher.mjs` | `DEFAULTS.lanesPollS = 15` + `ADVANCE_LANES_POLL_S` in `loadConfig`; pure `parseWorktreeList(stdout)` (porcelain → rows), pure `classifyMerged({ahead, isAncestor, onFirstParent})`; `makeLanesOps({repoRoot, statePath, gitBin, run, now, writeState, log})` as the third factory beside `makeLockOps`/`makeDeployOps` with `evaluate()` (never throws; writes every call); six lines of wiring in `main()`: construct, `setInterval(evaluate, lanesPollS*1000)`, `.unref()`, one immediate call, `clearInterval` in `shutdown`. Startup log line names the cadence. |
| `apps/chat/lib/lattice.js` | `export function listTasks(root)` → `[{id, short_id, title, status, assigned_to, branch_links}]`, tolerant read of every `tasks/*.json` (same `readJson`), plus the `ids.json` map. Read-only, as the file header promises. |
| `apps/chat/lib/lanes.js` (new) | `composeLanes({snapshot, tasks, ids, nowMs, staleMs = LANES_STALE_MS})` → projection; `LANES_STALE_MS = 60_000`; imports `MID_LIFECYCLE` from the watcher so the lane definition is the loop's. Pure: no fs, no clock, no process. |
| `apps/chat/server.js` | `WORKTREES_PATH = join(loopDir, 'worktrees.json')`; `readLanes()` = `composeLanes(readLoopFile(WORKTREES_PATH), listTasks(root), …)`; `GET /api/lanes`; `LANES_POLL_MS = 5_000` (exported, pinned) driving a `lanesPoll` interval that pushes `event: lanes` only when `lanesKey(projection)` changes — the key includes `snapshot.generatedAt` deliberately (one small frame per snapshot write, ≤ 4/min, is the honest "the feed is alive" signal and keeps the client's caption source current; it excludes `ageS`/`checkedAt`); one `lanes` frame on every new `/api/stream` connection, after the `loop` frame; `clearInterval(lanesPoll)` in `close()`; `STATIC_FILES` gains `/lanes.js`. |
| `apps/chat/public/lanes.js` (new) | Pure, DOM-free strings for the badge, the snapshot caption, the liveness line and each card field (`describeLanes(projection, nowMs)`, `describeLane(lane, nowMs)`) — the `loop-status.js` pattern; every reason enum maps to a board-readable sentence, no bare enum reaches the UI. |
| `apps/chat/public/index.html` | Sidebar: `<button id="lanes-open">Lanes</button>` + `<span id="lanes-badge">` next to `#loop-status`; `#lanes-modal`/`#lanes-dialog`/`#lanes-body` patterned on the org modal. |
| `apps/chat/public/app.js` | `state.lanes`; fetch `/api/lanes` in `refreshSidebar`; `lanes` SSE listener; `renderLanesBadge()`; `openLanes()`/`closeLanesModal()`/`renderLanes()` — `el()`/`textContent` only, task deep link via the existing `asRefLink`-shaped anchor (`dashHref` + `showTaskPanel`); Escape chain gets the lanes modal at z 37 (above org 36, below task panel 40) and the comment inventory is updated. Transient `now:` line: the element exists, empty, with the `--live/--decayed/--blank` classes from the wireframe and **no producer** — AS-103 fills it. |
| `apps/chat/public/style.css` | Lanes modal + `.lane-card` grid per `docs/design/chat-lanes/lanes.css`, tokens per `BRANDING.md`; single column ≤ 700 px (`LANES-MOBILE-NARROW`), no field dropped. |
| `apps/chat/watch/README.md` | Files table: `worktrees.json` row. |
| `apps/chat/README.md` | New section "Lanes pane (AS-99)": the feed, the freshness rule, the API and event name, the join rule, the squash-merge limit. |
| tests | `test/lanes.test.js` (composer, parser, merge classifier — pure), `test/watcher-lanes.test.js` (`makeLanesOps` on injected `run`/fs/clock — never main()), `test/lanes-label.test.js` (`public/lanes.js`), additions to `test/api.test.js` (`/api/lanes` from planted files via `loopFixture`, `/lanes.js` served, index markers, `LANES_POLL_MS` pinned) and `test/stream.test.js` (on-connect `lanes` frame; change-only push). **Known helper change:** `stream.test.js`'s `openStream` consumes exactly one initial `loop` frame; it must also consume the initial `lanes` frame (expose `initialLanes`) or every ordering test in that file goes red for the wrong reason. |
| `test/deploy-shape.test.js` | No change expected: the snapshot lives under `./data` (already rw-mounted, already pinned) and the Lattice read uses the existing `/repo` mount. If the implementer finds a mount change is needed, that is a plan-level finding, not a quiet edit. |

**Not changed:** `IMAGE_INPUTS` (`watch/`, `lib/`, `public/`, `test/` are already inputs, so
this merge rebuilds the image and restarts the watcher on its own), the Dockerfile, the
compose mounts, `advance.md`.

### T6. Acceptance criteria — each property names its falsifier (M4)

The counted run is `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm
--build test` from `apps/chat`, valid only with the `Image … Built` receipt; the current
master count is the baseline the implementer records first. Mutants run on a **scratch
copy** of the worktree, never in place; each AC below states the mutant and the predicted
red set (test names are the ids; a wider or narrower red set is itself a finding).

1. **AC-1 porcelain parse.** Input: main + two linked rows, one `detached`, one `locked`.
   Output: 3 rows, `main` true on the first only, `branch` null + `detached` true on the
   detached row. Mutant: drop the `detached` branch of the parser → red
   `lanes-parse-detached`. A row missing `HEAD` yields a row with an `errors` entry, not a
   throw → `lanes-parse-tolerant`.
2. **AC-2 generatedAt advances every poll (T2).** Two `evaluate()` calls, injected clock
   +15 s, identical git output → two writes, two distinct `generatedAt`. Mutant: skip the
   write when content is unchanged → red `watcher-lanes-generatedAt-advances`.
3. **AC-3 git down is a fact, not a crash.** `run` returns code 128 for `worktree list` →
   file written with `error: 'worktree-list-failed: …'`, `worktrees: []`, `generatedAt`
   set; `evaluate()` resolves. Mutant: rethrow → red `watcher-lanes-git-down` (and the
   assertion that `evaluate` never rejects).
4. **AC-4 per-row isolation.** `status` fails for worktree B only → B has `dirtyCount:
   null` and one `errors` entry; A and C are complete. Mutant: abort the snapshot on the
   first row error → red `watcher-lanes-row-isolation`.
5. **AC-5 the poll never writes a worktree's git dir.** Argv pin: the status call is
   exactly `['--no-optional-locks', 'status', '--porcelain']` (+ cwd), the same way
   `tickArgv` is pinned. Mutant: drop the flag → red `watcher-lanes-argv-pin`.
6. **AC-6 merged classification.** Cases: fresh branch at master tip (ahead 0, ancestor,
   on first-parent) → false; `--no-ff`-merged (ahead 0, ancestor, not first-parent) →
   true; branch with commits (not ancestor) → false. Mutant: drop the first-parent check →
   red on the fresh-branch case `lanes-merged-fresh-branch-is-not-merged`.
7. **AC-7 join rule and cardinality.** N worktree rows in → N worktree lanes out, always.
   Branch-link join wins over branch-name parse when both apply (fixture where they
   disagree); branch-name fallback when no link; no join → `task: null`, lane present.
   Mutant: filter unjoined rows → red `lanes-compose-unknown-task-kept`; mutant: parse
   before link → red `lanes-compose-link-beats-name`.
8. **AC-8 task-only lanes.** `in_planning` task with no worktree → lane with
   `worktree: null`; `done`, `needs_human`, `backlog` tasks with no worktree → no lane;
   `needs_human` *with* a worktree → lane. Mutant: use `IN_FLIGHT_RANK` statuses instead
   of `MID_LIFECYCLE` → red `lanes-compose-task-only-membership`.
9. **AC-9 STALE.** `done` + worktree → `['task-done']`; merged → `['merged']`; both →
   both; `in_progress` + unmerged → `flag: false`. Mutant: flag on `ahead === 0` → red
   `lanes-stale-reasons`.
10. **AC-10 employee is two fields.** Assignee ≠ author → both present, `agree: false`;
    no assignee → `agree: null`; no worktree → `lastCommitAuthor: null`. Mutant: coalesce
    into one field → red `lanes-employee-both-fields`.
11. **AC-11 freshness boundary (T2).** Via `/api/lanes` with `loopFixture`-style planted
    files: `generatedAt` 59 s old → `stale: false`; 61 s → `stale: true`,
    `reason: 'stale-snapshot'`; file absent → `lanes: null`, `'no-snapshot'`; garbage →
    `'unreadable-snapshot'`; file with `error` set → `'git-error'` and `lanes: []`. The
    boundary is asserted against the exported `LANES_STALE_MS`, not a literal. Mutant:
    compare against `2 * LANES_STALE_MS` → red `api-lanes-stale-boundary`. Mutant: read
    `statSync(...).mtime` instead of `generatedAt` → red on the same test (the planted
    file's mtime is fresh by construction).
12. **AC-12 push is change-only.** On connect: exactly one `lanes` frame, after the
    `loop` frame. Snapshot rewritten with a new `generatedAt` → exactly one frame within
    three polls. Snapshot untouched across 10 polls (`LANES_POLL_MS` injected small, as
    `loopPollMs` is) → zero frames. Mutant: push every poll → red
    `stream-lanes-change-only`.
13. **AC-13 payload whitelist.** `deepEqual(Object.keys(lane.worktree), [...])` and
    `deepEqual(Object.keys(lane), [...])` — no absolute path, no email beyond what the
    snapshot carries, no field that is not in T4. Mutant: spread the snapshot row → red
    `api-lanes-key-whitelist`.
14. **AC-14 the words the board reads.** `describeLanes(null)` badge is `Lanes · –`,
    never `0`; count 0 with a fresh snapshot is `Lanes · 0`; a task-only lane's git
    fields read "not cut yet" and never `0` / `clean`; every `snapshot.reason` maps to a
    sentence (exact key-set assertion over the reason table, the `BUILD_REASONS`
    pattern); index.html carries `id="lanes-open"`, `id="lanes-badge"`, `id="lanes-modal"`;
    `/lanes.js` is served and app.js imports it and references `/api/lanes`. Mutant:
    return `0` for a null payload → red `lanes-label-null-is-dash`.

**Review probes past the list (M6, budgeted):** open the pane on a phone-width viewport
and count fields (eight + two placeholders, none dropped); kill the watcher and watch
the caption turn stale at ~60 s and the badge stay a count (not a dash) until the file
is *removed*; `git worktree add` a throwaway detached worktree on the host and confirm an
unknown-task card appears within one poll and disappears after `worktree remove`;
confirm Escape closes the lanes modal before the org modal when both are open.

**What a headless tick can and cannot run.** Every new test is `node:test` over fixtures,
temp dirs and ephemeral ports, so the implementer and the reviewer can run
`cd apps/chat && node --test` on the host inside a headless tick and quote that number
**labelled as the host run**. The counted `--build` compose run is docker, which a headless
tick is denied (AS-92); it is a merge precondition performed from a live session (or by a
tick that has docker), recorded on the task with the `Image … Built` line before `done`.
A headless review that cannot produce the receipt says so in its comment and does not
move the task to `done`.

### T7. Scope, key files, implementer

**In scope:** everything in T5; the one composite wireframe state plus `LANES-EMPTY`,
`-ONE`, `-UNKNOWN-TASK`, `-NO-WORKTREE-YET`, `-SNAPSHOT-MISSING`, `-SNAPSHOT-STALE`,
`-MOBILE-NARROW` rendered from real data (no extra static wireframes needed — the ledger
is the spec). The transient `now:` line element with its three CSS states and no producer.

**Out of scope (deliberately):** any write action; a WIP denominator; per-tool activity
(AS-103); stage timers and sub-agent liveness (AS-100 — the `null` fields are the slots);
spatial/animated layout; token/cost; a `Last-Event-ID` replay for any stream; squash-merge
detection via git; changes to `advance.md` or the Dockerfile.

**Key files:** `apps/chat/watch/advance-watcher.mjs`, `apps/chat/lib/lanes.js` (new),
`apps/chat/lib/lattice.js`, `apps/chat/server.js`, `apps/chat/public/{index.html, app.js,
lanes.js (new), style.css}`, `apps/chat/test/{lanes, watcher-lanes, lanes-label}.test.js`
(new), `apps/chat/test/{api, stream}.test.js`, both READMEs, and Jonah's
`docs/design/chat-lanes/*` as the UI reference.

**Implementer: `agent:developer-marcus`.** Two of the three factories this task copies —
`makeLoopOps` (AS-95) and the mirror/settle shape — are his, and the watcher half here
is a third factory in exactly that mould; he also carries the AS-95 lesson about mutating
the intended site. Lena is free and would be a fine second choice, but she would be
reading a 75 KB watcher cold for a change whose whole risk is in that file. QA
recommendation for the orchestrator: `agent:qa-ruben` — the seams here are concurrency
(a snapshot taken mid-commit / mid-`worktree add`, a poll running under a live tick),
which is his stated strength; the tasking message must not hand him T6's predicted red
sets as results (AS-36 rule).

**Branch:** `feat/AS-99-lane-view`, worktree `.worktrees/AS-99`.

**Time-box note (my own failure mode, recorded):** the merged-classification question
could be refined for a week (reflog, squash detection by patch-id). Default answer taken:
the three-fact rule in T4 with the squash limit written down; revisit only if a review
finds a real lane misclassified.
