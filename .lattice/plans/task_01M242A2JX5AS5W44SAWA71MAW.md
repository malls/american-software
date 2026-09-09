# AS-93: Chat: Lattice deep links must infer the dashboard host from the page (tailnet :8443 vs loopback :8799)

SOURCE: board DM msg 607 (human:forrest, 2026-09-09T21:34Z): "lattice issue links should infer contextually whether to be local or tailscale. For example, I'm on my phone now via tailscale and I'd like links to work."

SYMPTOM: AS-10 deep links are built server-side as an absolute URL with a fixed base (lib/lattice.js dashboardTaskUrl -> LATTICE_DASHBOARD_URL || http://127.0.0.1:8799). A phone on the tailnet loads chat at https://forrests-newer-macbook.tail3f3c29.ts.net and gets hrefs pointing at 127.0.0.1:8799 -- the phone's own loopback. Dead link.

THE TWO-HOST MAPPING (both surfaces are reachable two ways; the dashboard's port differs per path):
  chat      local   http://127.0.0.1:8347              dashboard  http://127.0.0.1:8799
  chat      tailnet https://forrests-newer-macbook.tail3f3c29.ts.net (443, Tailscale serve -> 8347)
                                                       dashboard  https://forrests-newer-macbook.tail3f3c29.ts.net:8443 (-> 8799)
So the dashboard is ALWAYS on the same hostname as the page the user is looking at; only the port changes: 8799 when the page is on a loopback host, 8443 when it is not.

MECHANISM DECISION (Owen, CTO): derive in the CLIENT from window.location, not from the server's request Host header.
  Why not the Host header: one server fans one payload out to browsers on two different hostnames at the same time. Message refs are annotated in lib/lattice.js and shipped over both REST and the SSE broadcast; an SSE frame is composed once and pushed to every connected client, so a server-baked absolute URL is necessarily wrong for at least one audience whenever the Mac browser and the phone are both connected. Host-header derivation would also thread request context through lib/lattice.js, which is a pure module with three consumers (message refs, /api/task, the AS-8 roster work link).
  What the client does instead: one helper, used by all three link sites (public/app.js:146 asRefLink, :434 roster emp.work, :695 task-panel "Open in Lattice"), builds the href from the taskId the payload already carries (refs[].taskId; confirm the /api/task and roster payloads expose the id too -- refs do) plus window.location.
  The invariant, and the reason it fails closed: the hostname is ALWAYS location.hostname, never a constant. Only the port is inferred -- loopback hostname (127.0.0.1 / localhost / ::1) -> 8799, anything else -> 8443 -- and the protocol is the page's own. A link can therefore never point at a host the user is not already on; there is no code path that falls back to 127.0.0.1 from a non-loopback page.
  Escape hatch preserved: an explicitly set LATTICE_DASHBOARD_URL still wins over inference (explicit config beats a heuristic), but it must now reach the browser -- the server exposes it to the client (null when unset) and the client uses it verbatim when non-null. Today the env var only affects server-side string building, so a client-only fix would silently drop the documented override.
  Back-compat: refs[].url / task.url / employee.work.url stay in the API payloads (README section "deep-link URL contract" and several tests depend on them); the client simply stops using them for the href. If they stay, README must say they are the loopback form and that the client overrides. Implementer may instead retire them -- if so, update README and the API tests in the same commit.

RELATION: AS-10 introduced these links and the LATTICE_DASHBOARD_URL contract; this task changes where the base comes from. Linked depends_on AS-10.

ACCEPTANCE CRITERIA (M4: each stated property names the input that must make the mechanism report a violation; satisfied only by an OBSERVED red, never by an argument that it would be caught):
  AC-1  A test renders a task link with the page location set to https://forrests-newer-macbook.tail3f3c29.ts.net/ and asserts the href is exactly https://forrests-newer-macbook.tail3f3c29.ts.net:8443/#/task/<taskId>. Falsifier: this test must be observed RED against the current code (which emits http://127.0.0.1:8799/#/task/<taskId>) before the fix lands; quote the failure.
  AC-2  A test renders under http://127.0.0.1:8347/ and asserts http://127.0.0.1:8799/#/task/<taskId>. Falsifier: mutate the port rule (e.g. force 8443) and observe AC-2 red; restore and prove the tree with git diff --exit-code.
  AC-3  FAILS CLOSED. With the page at a third, unrelated hostname (e.g. https://example.internal:9000/), the href hostname equals example.internal -- never 127.0.0.1 or localhost. Falsifier: a mutant that adds a loopback fallback for unrecognised hosts must turn AC-3 red; observe it.
  AC-4  All three link sites go through the one helper. Falsifier: break the helper once and observe all three site-level tests go red together. Report cardinality: 3 sites examined, 3 covered.
  AC-5  An explicitly set LATTICE_DASHBOARD_URL still wins from the client's point of view (asserted at the rendered href, not just at the server), and unset restores inference. Falsifier: set it to a value that differs from what inference would produce and observe the inferred value fail the assertion.
  AC-6  Suite run per the CLAUDE.md corollary: docker compose run --rm --build test, with the "Image ... Built" line quoted in the review comment and the test count reported and compared to the expected baseline. No build line, no valid number.
  AC-7  README updated: the deep-link URL contract section now describes host inference, the port table above, and the override precedence.

OUT OF SCOPE, but on the record: the :8443 dashboard only answers while a `lattice dashboard` process is running in the board member's live session -- no launchd job was ever installed for it, unlike the advance watcher. So the phone links work only while a live session is up. Making the dashboard a supervised service is a separate task if the board wants it.
