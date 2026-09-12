# Lane view flows — AS-99 (Chat: git worktree observability)

**Task:** Lattice AS-99, UX half of `in_planning`. **Author:** Jonah Reyes
(`agent:ux-jonah`). **Method:** words before pictures, per `personnel/ux-jonah-reyes.md`
— this file and `02-states-ledger.md` are the source of truth; `lanes.html` renders a
subset of it.

**Read this alongside the three binding comments on AS-99** (ORDERING, NORTH STAR,
BOARD RULING) — this document does not restate their rulings, it applies them.

## Who and where

The **board member** (`human:forrest`), from the **chat app**, on **desktop** and on a
**phone over the tailnet** (the only two surfaces named in this task). No other actor
uses this view in v1 — it is read-only observability, not a work surface, so no
employee persona needs it to do their job. The north star (DM msg 658) names this the
first slice of the "foreman of the factory" floor: the board watching the company work,
not an employee-facing tool.

## Entry point

One entry point: a **"Lanes" button in the sidebar**, next to the existing "Org chart"
button (`apps/chat/public/index.html:39`) — same affordance family (a sidebar button
opening a dedicated pane), not a new interaction pattern. See `01-screens.md` §1 for why
a dedicated pane, not an inline sidebar section.

A passive glance signal sits in the sidebar without opening anything: a small lane-count
badge (e.g. "Lanes 2/3") near the existing `#loop-status` line, sourced from the same
durable snapshot. It answers "is anything running" at a glance; it does not answers
"what," which requires opening the pane.

## Flow 1 — Glance (no pane opened)

1. Board opens the chat app (desktop or phone).
2. Sidebar shows the loop-status line and, beside it, the lane-count badge.
3. Board reads "0/3", "2/3", etc. and closes the app, or proceeds to Flow 2.
   - **1a. Snapshot missing or unreadable** → badge shows a muted dash, never a "0" (a
     "0" implies "confirmed empty," which is not true if the feed failed — see
     `02-states-ledger.md`, snapshot-missing).

## Flow 2 — Drill in (open the pane)

1. Board clicks "Lanes" (or the badge).
2. Pane opens showing one card per lane, ordered by lane slot (not by age or priority —
   the underlying data has no ranking) — see `01-screens.md` §2 for the card spec.
3. Board reads a card: task, stage, employee, worktree/branch, ahead/dirty, last commit
   age, and (once available) the transient "now:" line.
4. Board clicks the task's `AS-n` — deep-links into that task the same way AS-93 links
   task ids elsewhere in the app. This is the only click target on the card; the pane
   itself performs no write action of any kind (task description, explicitly OUT).
5. Board closes the pane. Nothing about closing loses data — the pane holds no local
   state the board would need to preserve (durable layer re-fetches on reopen; transient
   layer legitimately resets — see Flow 4).

## Flow 3 — Watching a tick run live

1. Board has the pane open while a loop is actively ticking.
2. The whole-tick liveness line (sourced from `advance.lock`) shows a tick is running.
3. Live push frames (AS-103, when it lands) update each active lane's "now:" line in
   place — "now: reading server.js" → "now: running tests" — with no page reload.
4. A lane whose employee pauses between tool calls (e.g. waiting on a long subprocess)
   shows its "now:" line hold, then enter DECAY after the chosen silence window (§2 of
   the states ledger; N and the reasoning are in `02-states-ledger.md`).
5. Board must not read decay as "the employee stopped" — the durable layer (stage still
   `in_progress`, worktree still present) is what disambiguates "quiet" from "gone." This
   is the board ruling's explicit requirement, not a nicety.

## Flow 4 — Returning after time away (reload / new session)

1. Board reopens the chat app after being away (browser reload, new tab, next day).
2. Durable layer renders immediately and fully from the snapshot — every field has a
   value or an explicit "n/a"/"stale" marker, never a blank cell standing in for
   "unknown."
3. Transient "now:" line renders **blank** for every lane until the next live push frame
   arrives (if a loop is even running) — this is `transient-blank-after-reload`, and it
   is visually and textually distinct from decay (§2, `02-states-ledger.md`): blank
   means "no frame has arrived yet since this page loaded," not "the employee went
   quiet partway through."
4. If no loop is running at all, the whole-tick liveness line says so plainly and no
   "now:" line ever populates — this is a durable-layer fact, not a transient one.

## Deliberately excluded from this planning half

Per the north star ruling, item 4: no write action anywhere in these flows, no
per-lane detail screen beyond the AS-93 deep link (the task itself is the detail view),
no animation/spatial arrangement (that is the later foreman-floor layout, same cards,
different arrangement), no token/cost figures, no sub-agent spawn/exit history (AS-100's
job).
