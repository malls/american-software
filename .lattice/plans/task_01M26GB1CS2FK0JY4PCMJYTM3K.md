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
