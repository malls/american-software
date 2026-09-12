# States ledger — Lanes pane, AS-99

**Task:** Lattice AS-99, UX half of `in_planning`. **Author:** Jonah Reyes
(`agent:ux-jonah`). **Method:** the states ledger before the drawing
(`personnel/ux-jonah-reyes.md`) — this file is the source of truth; `lanes.html` renders
the states named in its own header comment, not all of them (this is a planning-stage
wireframe of one composite state, per the task prompt, not the full AS-30-style
one-page-per-screen render of every row).

Each row: state, trigger, what the pane/card shows, what it must **not** imply. Row IDs
are prefixed `LANES-`.

## Pane-level states

| Row ID | Trigger | What shows | Must NOT imply |
|---|---|---|---|
| `LANES-EMPTY` | Zero linked worktrees exist (WIP 0) | Pane opens with one message: "No lanes running." Whole-tick liveness line still renders independently (a tick can be between tasks) | Must not read as an error or a loading state — zero lanes is a normal, valid company state, not a failure |
| `LANES-ONE` | Exactly one linked worktree | One card, full width on desktop | Must not imply the WIP limit is 1 — the pane never states a denominator it isn't given; "1 of 3" phrasing only where the technical plan confirms the limit is a known constant, not inferred from the snapshot |
| `LANES-THREE` | Three linked worktrees (the WIP limit) | Three cards, no fourth slot drawn, no "add lane" affordance (read-only, no write action) | Must not imply a hard visual ceiling of exactly 3 baked into the layout — if the WIP limit changes (as it already has once, 1→3), the pane lays out N cards, it does not hardcode three columns |
| `LANES-STALE` | A card's worktree still exists but its task is `done`/`cancelled`, or its branch is already merged into master | STALE badge on that card, all other fields render normally (the worktree/branch/commit data is still real and still worth showing) | Must not hide or grey out the rest of the card — stale means "this should probably be cleaned up," not "this data is no longer trustworthy." Must not imply the pane can clean it up (no write action) |
| `LANES-UNKNOWN-TASK` | A `.worktrees/` entry with no `lattice branch-link` and no `AS-<n>` parseable from the branch name | Card renders with branch name and worktree path in place of the Task field, labeled "no linked task" rather than left blank | Must not omit the card — an unlinked worktree existing is itself a finding the board should see, not something to filter out because it doesn't fit the join |
| `LANES-NO-WORKTREE-YET` | Task is `in_planning`, assigned, but no branch/worktree cut yet (plan-stage lanes, per this very task's own lifecycle) | Card renders with Task, Stage (`in_planning`), Employee filled in; Worktree/Branch/Ahead/Dirty/Last-commit fields all show an explicit "not cut yet" placeholder, not blank cells | Must not show a 0 for "commits ahead" or a false "clean" for dirty — those are answers to a question that doesn't apply yet, and a 0/clean reads as a real measurement |
| `LANES-SNAPSHOT-MISSING` | The feed file is absent or fails to parse (host watcher hasn't written it yet, or a read error) | Pane-level banner: "Lane data unavailable" with no card list underneath at all — no stale cached list either, since a silently-stale render is worse than an honest gap | Must not fall back to showing the last successful render without labeling it as such — an unlabeled stale list masquerades as current |
| `LANES-SNAPSHOT-STALE` | The feed parses, but its `generatedAt` timestamp is older than the freshness guarantee the technical plan sets | Pane renders normally but with a visible age caption at the top ("data from 4m ago" or similar), styled with the same muted treatment as a warning, not hidden | Must not render as if current — a stale-but-present snapshot is more dangerous than a missing one, because it looks fine at a glance. The exact threshold and its M4 falsifier are the technical plan's to set; this row exists so the plan has a UI state to land the number in |
| `LANES-MOBILE-NARROW` | Viewport at or below the phone-over-tailnet width (375px floor, per the AS-30 mould's own verified floor) | Cards stack single column, full width; the whole-tick liveness line wraps to two lines rather than truncating; no field is dropped to save space | Must not hide any of the eight durable fields or either placeholder slot on narrow width — "mobile" here means re-layout, never reduced content, per the task's own "phone over the tailnet" requirement |

## Transient-layer states (per card, orthogonal to the pane-level states above)

| Row ID | Trigger | What shows | Must NOT imply |
|---|---|---|---|
| `LANES-TRANSIENT-LIVE` | A live push frame (AS-103) has arrived within the decay window (15s — see rationale below) | `now:` line shows the frame's text at full contrast, updates in place on each new frame | Nothing beyond the literal text of the last frame — no inferred progress, no percentage, no ETA |
| `LANES-TRANSIENT-DECAYED` | No frame has arrived for the card's lane in >15s, but a session has been live at some point since page load | `now:` line keeps its last text but renders muted/greyed, no longer at full contrast — a visual "this may be stale" cue, text itself unchanged | Must not read as "the employee stopped" or "the lane failed" — the durable layer (stage, worktree presence) is what actually answers that; decay is silence, not a verdict |
| `LANES-TRANSIENT-BLANK-AFTER-RELOAD` | Page has loaded (or reloaded) and no frame has arrived yet for this lane in the current page session | `now:` line area renders empty — no placeholder text, no "waiting…" spinner, no dash | Must not be visually identical to decay (decay keeps greyed text; blank has none) and must not be read as "idle" or "not running" — the durable layer's Stage field is the only place that claims to know whether the lane is active. Blank means exactly one thing: "no live signal has reached this browser tab since it loaded" |

**Decay window: 15 seconds.** Chosen because AS-103's candidate source is per-tool-use
hook events, which fire on the order of seconds during active work but can legitimately
go quiet for tens of seconds during a single long tool call (a test suite run, a slow
build) without the employee having stopped. 15s is short enough that the board isn't
staring at a stale "now:" line for a full minute believing it's current, and long enough
that a normal single-tool-call pause doesn't visibly flicker into decay and back. This is
a UX default, not a measured constant — AS-103's technical plan (push cadence, whether
frames carry their own liveness heartbeat separate from content) may tighten or loosen
it; this row is where that number lands, the same way `LANES-SNAPSHOT-STALE` is where
the durable feed's freshness number lands.

## Explicitly out of this ledger (stated so the absence isn't mistaken for an oversight)

No `LOADING` category row for the pane's initial durable fetch beyond
`LANES-SNAPSHOT-MISSING`/`-STALE` above — because the source is a small static snapshot
file, not a network round trip with a meaningful in-flight duration; if the technical
plan's chosen feed does turn out to have a visible fetch latency, that's a rework note
for this ledger, not an assumption baked in twice. No `ABANDON` category — nothing in
this pane is a form or an in-progress user action to abandon (read-only view). No
`ERROR-VALIDATION` — there are no inputs. No write-permission-denied states — there are
no write actions to deny (task description, explicitly OUT for v1).
