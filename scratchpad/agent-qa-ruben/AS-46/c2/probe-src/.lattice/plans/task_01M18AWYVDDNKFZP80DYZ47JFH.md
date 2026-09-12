# AS-8 Plan: DM sidebar shows all employees with current work status

Planner: agent:cto-owen, 2026-08-30. Assumptions are explicit; open questions
got a time-box and a default, and the defaults are what's written here.

## Scope

The web UI's "Direct messages" section becomes a company roster: every
**active** employee from `personnel/` frontmatter appears, whether or not a DM
exists yet, each row carrying the employee's current work status derived from
Lattice ("AS-8 · in progress", "idle"). Clicking a row get-or-creates the DM.
Existing DM conversations with non-employees (e.g. `human:forrest`) keep
rendering below the roster. Plus a `chat roster` CLI subcommand (cheap parity,
in scope). Zero dependencies, Docker-only, all reads.

Out of scope: org-chart rendering (`reports_to` tree — that's the future
ORG.md renderer per CLAUDE.md), presence/online status, any write path to
`personnel/` or `.lattice/`.

## Decision 1 — how the container sees personnel/ : read-only bind mount

Mount `../../personnel` at `/repo/personnel:ro` in the `server` and `cli`
services (NOT `test` — it stays zero-mount by design). This is the exact
pattern `.lattice/` already uses, and `CHAT_REPO_ROOT=/repo` already names the
repo root, so no new env var is needed: the reader resolves
`join(latticeRoot(), 'personnel')`.

Alternatives rejected:
- **COPY into the image**: impossible (`personnel/` is outside the
  `apps/chat/` build context; Docker forbids `COPY ../..`) and wrong anyway —
  a hire would require an image rebuild to appear.
- **Ingest into the chat DB**: duplicates the org source of truth; drifts;
  adds a write path where a read suffices.
- **New env var / second root**: `/repo` is already the repo root. One knob.

Degradation contract: if `/repo/personnel` is missing or unreadable (old
compose file, tests, half-broken mount), the roster is empty and the UI falls
back to exactly today's behavior (DM conversations only). A malformed dossier
must never take the server down — same rule as malformed `.lattice` files.

## Decision 2 — frontmatter parsing: ~30-line YAML-subset parser, no library

New module `apps/chat/lib/personnel.js` (zero-dep, mirrors `lib/lattice.js`:
all filesystem knowledge of `personnel/` lives here, root injectable for
tests).

The schema (CLAUDE.md "Org Chart") is deliberately flat `key: value` scalars.
Parser contract:
- A dossier is a `.md` file whose first line is `---`; take lines until the
  next `---`; split each on the **first** `:`; trim key and value; strip one
  unquoted trailing ` # comment` (the documented schema example carries
  inline comments) and optional surrounding quotes.
- Skip files with no leading `---` (that's `personnel/README.md` — free).
- Skip entries whose `actor_id` fails the identity regex
  (`^(human|agent|system):[a-z0-9][a-z0-9._-]*$`) or that lack `name` —
  skip, never throw.
- This is NOT a YAML parser and must not grow into one. If the schema ever
  gains nesting or lists, that is a breaking change negotiated via CLAUDE.md
  (see "Proposed metawork" below).

`readRoster(root)` → array of `{ actorId, name, title, class, reportsTo,
team, hired, status }`, sorted by name. The API layer filters to
`status === 'active'`; the function itself returns everything so a future
"departed" view costs nothing.

## Decision 3 — work status derivation (lib/lattice.js addition)

New export `assignmentsByActor(root)`: read every `.lattice/tasks/*.json`
(same readdir + tolerant readJson pattern as event ingestion; ~a dozen small
files per call — cheap at our volume, no cache), keep tasks whose status is
**in flight**: `in_planning, planned, in_progress, review, blocked,
needs_human` (i.e. not `backlog`, `done`, `cancelled` — backlog assignment is
a queue, not current work). Group by `assigned_to`.

Per actor, order by status priority `in_progress > review > blocked >
needs_human > planned > in_planning`, tie-break `last_status_changed_at`
desc. The first is the **primary** task; the rest count toward `+N`.
Each entry: `{ shortId, taskId, title, status, url }` — `url` via the
existing `dashboardTaskUrl` (AS-10). Status strings keep their underscore
form in the API; the UI renders `replace('_',' ')` (matches `lattice show`).

## Decision 4 — API: one new endpoint, `GET /api/roster?me=<id>`

Not an enrichment of `/api/conversations`: the roster joins three sources
(personnel FS, lattice FS, chat DB) and only the server composes all three —
`store.js` stays SQL-only, `personnel.js` stays FS-only (the existing seam
discipline).

Response, per active employee:

```json
{ "roster": [ {
    "actorId": "agent:qa-priya", "name": "Priya Raman", "title": "QA Engineer",
    "class": "ic", "team": "engineering",
    "registered": false,            // exists in chat identities table?
    "dmConversationId": 7,          // me<->them DM if it exists, else null
    "unread": 2,                    // unread in that DM (0 when no DM)
    "self": false,                  // actorId === me
    "work": { "shortId": "AS-8", "taskId": "task_…", "title": "…",
              "status": "in_progress", "url": "http://127.0.0.1:8799/#/task/…" },
    "moreTasks": 1                  // in-flight tasks beyond the primary; 0 usual
} ] }
```

`work: null` means idle. `me` is required (same rule as conversations/unread)
because `dmConversationId`/`unread` are viewer-relative; those two fields come
only from `me`'s own memberships via existing member-gated store reads.

Store additions (small, tested): `dmConversationFor(me, other)` → existing DM
conv id or null (lookup by `dm_key`, no create), reuse `unreadCountFor`.

**Hidden-channel audit:** the endpoint reads personnel frontmatter and Lattice
assignment/status — both repo-public by design (Lattice is the board's audit
trail; `#board` content lives in neither source). It never touches channels,
so no new existence oracle for private channels; DM id/unread are the
viewer's own. Identity honor-system trust model unchanged (loopback-only app).

## Decision 5 — sidebar rendering (public/app.js, index.html, style.css)

The "Direct messages" section renders two groups from one list:

1. **Roster rows** — every active employee, sorted by name. Row = name
   (dossier `name`; `title` as hover tooltip), small status line beneath:
   `AS-8 · in progress` (+` (+1)` when `moreTasks > 0`) or `idle`, muted.
   Unread badge and `.active` highlight exactly like today's DM rows. The
   viewer's own row renders with "(you)", no click-to-DM. All content via
   `textContent` (house rule).
2. **Non-roster DMs** — existing DM conversations whose other member has no
   active dossier (`human:forrest` today; also DMs with departed employees —
   history never disappears). Rendered exactly as today, below the roster.

Click on a roster row: if `dmConversationId` → `selectConversation` (URL
`?c=dm:<id>` per the AS-9 contract, pushState — no new URL params, none
needed). Else: if `!registered`, first `POST /api/identities` with
`{ id: actorId, displayName: name, kind: 'agent' }` (registration is
mechanical bookkeeping; the dossier is the source of truth — the UI just
materializes it), then `POST /api/dms`, then select. Tolerate the 409 race
(already registered by a concurrent tab) by proceeding to `/api/dms`.

Refresh cadence: `refreshSidebar()` fetches `/api/roster` alongside
`/api/conversations` — rides the existing 5s poll. One extra request per 5s
against ~15 small files server-side; measured-by-inspection cheap. The poll
never writes the URL (AS-9 invariant untouched).

Task links: the status line's short code renders as the same ref-link
pattern as message bodies (plain click → in-app task panel, modified click →
dashboard) — reuse of the AS-10 affordance, no new scheme.

## Decision 6 — AS-6 typeahead reconciliation: subsumed for employees, kept as escape hatch

The roster subsumes the typeahead **for employees** — every active employee is
already one click away, which is strictly better than type-to-find at this
headcount. The typeahead ("+" button) **stays, unchanged**, because it is the
only way to start a DM with a non-employee identity (`human:forrest`, future
humans, anything registered but not in `personnel/`). No code removed; AS-6
tests keep passing untouched. If identities outgrow one list (the AS-8
description's own caveat), the typeahead is already there — nothing to
re-add later. Cheapest correct reconciliation; revisit only on real pain.

## Decision 7 — CLI parity: `chat roster [--json]`

One new `case` in `bin/chat.js`: table of `actor_id  name  title  work`
(work = `AS-n status (+N)` or `idle`), `--json` emits the same shape as the
API's roster array minus viewer-relative fields (no `me` required; if `--me`
given, add `dmConversationId`/`unread`). Runs in the one-off `cli` container,
which gets the same personnel mount. Missing mount → "no personnel records
found" note, exit 0 (degradation contract).

## Files

- `apps/chat/compose.yaml` — add `../../personnel:/repo/personnel:ro` to
  `server` and `cli` (not `test`).
- `apps/chat/lib/personnel.js` — NEW: frontmatter parser + `readRoster`.
- `apps/chat/lib/lattice.js` — add `assignmentsByActor` (+ status ranking).
- `apps/chat/lib/store.js` — add `dmConversationFor(me, other)`.
- `apps/chat/server.js` — `GET /api/roster`.
- `apps/chat/bin/chat.js` — `roster` subcommand + USAGE line.
- `apps/chat/public/index.html` — roster list container in the DM section.
- `apps/chat/public/app.js` — roster state/fetch/render, click-to-DM with
  auto-register, non-roster DM fallback rows.
- `apps/chat/public/style.css` — roster row + status-line styles.
- `apps/chat/test/fixtures/repo/personnel/` — NEW fixture dossiers
  (valid ×2 incl. one with inline comments + quotes, `status: departed` ×1,
  malformed ×1, README-style no-frontmatter file).
- `apps/chat/test/personnel.test.js` — NEW.
- `apps/chat/test/lattice.test.js` — assignmentsByActor cases (extend
  fixture tasks: two in-flight for one actor, backlog/done excluded, idle).
- `apps/chat/test/api.test.js` — roster endpoint cases.
- `apps/chat/test/store.test.js` — dmConversationFor.
- `apps/chat/README.md` — roster section: mount, endpoint, CLI, typeahead
  note (implementation stage; app-local doc, not top-level metawork).

## Acceptance criteria

Node-testable (all run in the mountless test container via fixtures):
1. Parser: valid dossier parsed (all 8 fields); inline ` # comment` and
   quotes stripped; README (no `---`) skipped; malformed frontmatter and bad
   `actor_id` skipped without throwing; missing `personnel/` dir → `[]`.
2. `assignmentsByActor`: in-flight statuses grouped per actor; backlog/done/
   cancelled excluded; priority ranking + tie-break ordering; unassigned
   tasks ignored; actor with nothing in flight absent from the map.
3. `GET /api/roster` without `me` → 400. With `me`: only `status: active`
   dossiers; `registered` reflects identities table; `dmConversationId` set
   iff a me↔them DM exists, with correct `unread`; `self` true on own row;
   `work` null when idle; response works when personnel fixtures absent
   (empty roster, 200).
4. `dmConversationFor` returns null pre-DM, the conv id post-`openDm`, and
   never creates.
5. Existing suites (api, store, lattice, cli, export, url-state) untouched
   and green — the export format gains nothing (roster is not stored).

Hand-walk (documented in the review, per Docker-only rule):
6. `docker compose up --build`: sidebar lists all 4 active employees with
   name + status line; employees with no DM yet appear.
7. Click `qa-priya` (unregistered, no DM) as forrest → identity registered,
   DM created and opened, URL `?c=dm:<id>`; refresh restores (AS-9).
8. Own row shows "(you)" and is inert; `human:forrest` DM row still present
   under the roster for agent viewers; "+" typeahead still starts a DM with
   forrest.
9. Status lines update within ~5s of a `lattice status` transition on the
   host (read-only mount liveness).
10. `./apps/chat/chat roster` and `--json` print the roster in the one-off
    container.

## Test plan

`docker compose run --rm --build test` (node --test, no mounts) covers 1–5.
QA hand-walks 6–10 against the running compose stack and records the result
in the review comment. Nothing requires bare node on the host.

## Proposed metawork (for the orchestrator — NOT part of this branch's implementation)

CLAUDE.md "Org Chart" rules, append one bullet:

> - **Machine consumers exist.** The chat app reads this frontmatter
>   read-only (`apps/chat/lib/personnel.js`, roster sidebar — AS-8). The
>   parser is a deliberate YAML-subset: flat `key: value` scalars with
>   optional `# comments` only. Adding nesting, lists, or multi-line values
>   to the schema is a breaking change — update the parser (and its tests)
>   in the same task.

## Risks / notes

- Roster `name` vs chat `displayName` can disagree ("Carla Voss" vs
  "Carla Voss (CEO)"). Roster rows use the dossier name (org truth);
  message authorship keeps using chat displayName. Cosmetic, accepted.
- `/api/roster` reads ~15 files per poll per open tab. Fine at this volume;
  if it ever shows up, add an mtime-keyed cache — not now (no evidence).
- The auto-register-on-click writes an identity row from a UI action. It
  uses the existing public endpoint with the existing validation; no new
  write surface.
- `test` service correctly proves personnel access is injectable: if a test
  accidentally depends on the real `personnel/`, the mountless container
  fails it. That property is worth keeping.
