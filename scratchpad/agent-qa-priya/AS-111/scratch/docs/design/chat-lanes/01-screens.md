# Screen inventory + lane card spec — AS-99

**Task:** Lattice AS-99, UX half of `in_planning`. **Author:** Jonah Reyes
(`agent:ux-jonah`).

## 1. Placement: one dedicated pane, not a sidebar section

**Recommendation: a "Lanes" pane, opened from a sidebar button, in the same pattern as
the existing "Org chart" button (`apps/chat/public/index.html:39`).** Not a permanently
expanded sidebar section.

**Why:** the durable card alone carries eight fields (§2 below) plus two
visibly-absent placeholder slots, and the board ruling adds a second, differently-timed
transient line on top of that. The sidebar rail (shared with conversations, identity,
loop-status) does not have the width or the vertical budget for three such cards at once
without either truncating fields (which reintroduces exactly the "guess the missing
value" failure this task exists to close) or pushing the conversation list off-screen.
A dedicated pane gives the card room to be read, not just glimpsed.

This also matches the north star directly: the lane card is named as "the component
that grows into the [foreman] floor" (NORTH STAR comment, item 2) — a future spatial
canvas needs a canvas, not a sidebar slot. Building the pane as its own surface now
means the later spatial layout is a rearrangement of the same pane's contents, not a
rebuild.

A **passive glance signal** stays in the sidebar (badge near `#loop-status`, Flow 1) so
the board doesn't have to open the pane just to see "is anything running" — this is the
sidebar's proper job (ambient status), while the pane is the proper job of "what,
exactly."

## 2. The lane card — field list and order

One card per lane. Order follows Owen's item-1 field list in the NORTH STAR comment,
unchanged:

**Durable layer** (every value has a source on disk; renders fully on load, survives
reload):

1. **Task** — `AS-<n>`, deep-linked (AS-93 pattern). If the branch carries no `AS-<n>`
   join key, see `unknown-task` (§ states ledger) — the card still renders, task field
   shows the unjoined branch name instead of a link.
2. **Stage** — from `.lattice` status (`in_planning`, `in_progress`, `review`, etc.).
3. **Employee** — the task's assignee (Lattice actor id). If the last commit's git
   author identity differs from the assignee, both are shown, assignee first, git
   author labeled — never silently picking one (see open question in the plan file: how
   the technical plan sources and reconciles this).
4. **Worktree** — path (`.worktrees/AS-<n>`) and branch name, monospace, together.
5. **Commits ahead of master** — integer count from `git log master..<branch>`.
6. **Dirty / clean** — from `git status --porcelain`, boolean badge.
7. **Last commit** — author (employee id) + relative age ("14m ago").
8. **STALE flag** — badge, shown only when true (§ states ledger).

Below the eight fields, two **visibly-absent placeholder slots**, always rendered, never
omitted, so their absence reads as "not built yet," not "forgotten":

- *Stage timer* — muted text, "no live signal yet."
- *Sub-agent alive/exited* — muted text, "no live signal yet."

Neither placeholder is styled as an error or a warning — they are not broken, they are
not sourced yet (NORTH STAR item 2: "leave an explicit slot... wireframe those as
visibly-absent placeholders, not invented data").

**Transient layer** (live push frames only, per the BOARD RULING comment): one line at
the bottom of the card, prefixed `now:` — e.g. "now: running tests." Three possible
renderings, detailed in `02-states-ledger.md`: **live** (a frame arrived recently),
**decayed** (quiet past the chosen window — muted/greyed, text stays but visually
recedes), **blank-after-reload** (nothing rendered at all until the first frame since
page load). The line is never scrollable, never a list, never counted — one line,
replaced in place, or empty.

## 3. Whole-tick liveness line

One line at the **top of the pane**, above all cards, not per-card: sourced from
`apps/chat/data/advance.lock` (pid, startedAt, source, nonce) — "Tick running since
02:43Z (pid 17217)" or "No tick running." Labeled explicitly as tick-level, e.g. a
small caption "(whole company, not per-lane)" — this is the one honesty requirement the
NORTH STAR comment states outright: "do not fake per-lane liveness from it."

## 4. Screen count

**One screen** (the Lanes pane) against this task's v1 scope. No second screen for
per-lane detail: the `AS-n` deep link *is* the detail view — Lattice already owns the
task's full history, comments, and diff; duplicating that inside the lane pane would be
exactly the scope-growth this role exists to resist, and nothing in the task
description or the north star asks for it. If a future cut wants an expanded per-lane
view, that is a screen-budget conversation for the technical plan or a later task, not
assumed here.

## 5. Assumptions (narrower reading, stated rather than silent)

1. **Lane order is slot order, not priority or age.** No ranking signal exists in the
   snapshot; inventing one (e.g. "oldest first") would be presenting derived judgment as
   fact.
2. **The pane shows only linked worktrees** — `.worktrees/AS-<n>` entries with a
   `lattice branch-link`. A worktree with no such link is `unknown-task` (states
   ledger), not filtered out silently — an unlinked worktree existing at all is itself
   information the board should see.
3. **No auto-refresh interval is specified here.** That is a technical-plan decision
   (feed freshness guarantee, M4 falsifier) — this document only specifies that the
   durable layer is drawn from *a* snapshot with a visible age, and the transient layer
   is push-driven, never polled.
4. **Mobile is a narrower layout of the same pane, not a separate screen** — cards stack
   single-column, nothing is cut (see `mobile-narrow-width` in the states ledger).
