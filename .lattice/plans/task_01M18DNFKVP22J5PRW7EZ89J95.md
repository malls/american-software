# AS-10: Chat: AS-n refs and lattice events link out to the Lattice dashboard (#/task/<id>)

Board request via DM (chat msg 59, human:forrest): "I think we need query string to keep page context in here. also, the lattice events should link to the lattice site" — this task is the second half (lattice events link to the lattice site); the query-string half is AS-9 (done).

Plan by Owen Kessler (agent:cto-owen), 2026-08-30. Complexity: low. Explored on master @ d39593d + AS-9 tree.

## What exists already (findings that shape the plan)

1. **Resolution is a solved problem — do not rebuild it.** The server annotates every
   message (top-level, thread, unread) with a `refs` array via `lib/lattice.js
   resolveRefs`: each ref is `{shortId, exists, taskId, title, status}`. The full task
   id is *already in every message payload the client renders*. `GET /api/task/<short>`
   returns the same shape. `#lattice-events` posts are ordinary messages by
   `system:lattice` whose bodies start with the short code ("AS-10 created by …"), so
   they flow through the exact same annotate → `bodyNode` path as any other message.
   One mechanism covers both halves of the task title.
2. **`bodyNode` (public/app.js) already linkifies resolved AS-n refs** — but with
   `href="#"` and a click handler that opens the in-app task panel. The AS-9 README
   contract requires real hrefs; `href="#"` is exactly the anti-pattern to remove.
3. **CSP is `default-src 'self'`** — that governs resource *loading*, not anchor
   *navigation*. An outbound `<a>` to another origin is unaffected. No CSP change.
4. **Dashboard target verified:** `lattice dashboard` (lattice-tracker 0.2.0, host pipx
   venv at ~/.local/bin/lattice), default http://127.0.0.1:8799, task deep links via
   hash route `#/task/<full-task-id>`.

## Approach

**Resolution:** none new. Build the URL server-side as one extra field on the object
`resolveShortId` already returns: `url: <base>/#/task/<taskId>` (only when
`exists: true`; unresolvable codes stay unlinked, current behavior). Base comes from
`LATTICE_DASHBOARD_URL` env, default `http://127.0.0.1:8799`, trailing `/` trimmed,
empty string treated as unset (compose passthrough sets `""` when the host var is
absent). Every consumer gets the link for free — message refs, thread refs, unread
refs, `/api/task/<short>`, and the `chat task` CLI output. Zero new endpoints, zero
extra round trips, env knowledge stays server-side.

Note on the default: the server never dereferences this URL — it is rendered for the
*viewer's browser*, which sits on the same host as the loopback-only chat UI, so
`127.0.0.1:8799` is correct even though the server runs in a container (where
127.0.0.1 would mean something else — irrelevant, it never fetches it).

**Anchor semantics in `bodyNode`:** the ref anchor gets `href = ref.url`,
`target="_blank"`, `rel="noopener"`. Plain unmodified left-click keeps today's
behavior — `preventDefault()` + open the in-app task panel (the hover/title context is
good and the board liked it). A modified click (cmd/ctrl/shift or middle button) falls
through to the browser default → dashboard in a new tab; right-click → copy-link also
now yields a real URL. Guard: only call `preventDefault` when
`!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1)`.

**Task panel:** `showTaskPanel` adds an "Open in Lattice ↗" anchor (`task.url`,
`target="_blank"`, `rel="noopener"`) when `task.exists`. Built with the existing
`el()` helper; all text via textContent — the XSS rule at the top of app.js holds,
no innerHTML anywhere.

## Compose decision (deferred to planner — decided now)

**The dashboard does NOT join docker compose. Document-only, host-run.** Rationale on
record: the Infra rule ("all local apps should be run with Docker/Compose") governs
apps *we build*; the Lattice dashboard is vendor tooling that ships with the
board-mandated tracker, installed on the host via pipx — the same category as `git`
or `sqlite3`, which we also do not containerize. Containerizing it would mean
building and maintaining a Python image around a third-party CLI (version pinning,
.lattice mount, another service in the blast radius) — real ongoing cost — and what
it removes is a single `lattice dashboard` invocation. I evaluate infrastructure by
what it removes; this removes nothing.

**Accepted consequence, stated plainly:** links are always well-formed but are dead
(connection refused) whenever `lattice dashboard` is not running on the viewer's
host. That is acceptable for a loopback-only internal tool whose entire audience is
this machine. The README documents "run `lattice dashboard` to make the links live."
Follow-up flag (out of scope, park it): if chat ever deploys to DO, remote viewers
cannot reach anyone's localhost and the whole link target needs rethinking — that
revisit belongs to the deployment task.

## Changes, by file (all under apps/chat/)

1. `lib/lattice.js` — export `dashboardTaskUrl(taskId)` (reads
   `LATTICE_DASHBOARD_URL`, defaults, trims trailing `/`); `resolveShortId` adds
   `url` to the `exists: true` return. ~10 lines.
2. `public/app.js` — `bodyNode`: real href/target/rel + modified-click fallthrough;
   `showTaskPanel`: append the "Open in Lattice ↗" anchor. ~15 lines.
3. `compose.yaml` — `server` service environment gains `LATTICE_DASHBOARD_URL`
   passthrough (list form, like the cli service's `CHAT_ME`).
4. `test/lattice.test.js` — the existing `assert.deepEqual` on `resolveShortId`'s
   full return WILL fail once `url` is added; update expectations. Add cases:
   default base URL; env override (set/restore `process.env` in the test);
   trailing-slash trim; `exists: false` has no `url`.
5. `README.md` (apps/chat — not top-level, no metawork): row in the Configuration
   table for `LATTICE_DASHBOARD_URL`; short "Links to Lattice (AS-10)" note near the
   AS-9 deep-link section: link scheme, `lattice dashboard` must be running on the
   host for links to resolve, and the deliberate host-run (non-compose) decision.
   No edits to the AS-9 contract itself — chat still owns only `c`, `t`, `m`.

Out of scope / explicitly not doing: new persistence, new endpoints, client-side
short-id resolution, containerizing the dashboard, changing `#lattice-events`
message *bodies* (linkification is render-time only — stored bodies stay plain
text, so the CLI/export surfaces are untouched).

## Acceptance criteria (walkable)

1. `node --test` suite passes in-container (`docker compose run --rm --build test`),
   including new `dashboardTaskUrl` / `resolveShortId.url` cases.
2. In the web UI, a message containing a resolvable `AS-n` renders an anchor with
   `href="http://127.0.0.1:8799/#/task/<full-task-id>"`, `target="_blank"`,
   `rel="noopener"` — verifiable in devtools without the dashboard running
   (well-formed regardless of dashboard liveness).
3. `#lattice-events` system messages get the same anchors (they are the same code path).
4. Plain click on a ref still opens the in-app task panel; cmd/ctrl-click opens a
   new tab to the dashboard route.
5. The task panel shows "Open in Lattice ↗" linking to the same URL; absent for
   unresolvable codes ("No such task." unchanged).
6. Unresolvable refs (e.g. AS-999) render as plain text, exactly as today.
7. With `LATTICE_DASHBOARD_URL=http://127.0.0.1:9999` exported before
   `docker compose up`, rendered hrefs use that base.
8. With `lattice dashboard` running on the host, clicking through lands on the
   task's dashboard page.
9. README documents the env var and the host-run dashboard decision.

## Test plan

- **Unit (node:test, in-container, no mounts):** the lattice.test.js additions above —
  pure logic, fixture repo, env set/restored per test.
- **Hand-walk (implementer records results in a task comment):** bring up the stack
  (`DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose up -d --build`), then
  walk criteria 2–8 in order; criterion 8 requires `lattice dashboard` on the host —
  start it, click, confirm the task page, stop it, confirm the href is unchanged
  (dead link, by design).
