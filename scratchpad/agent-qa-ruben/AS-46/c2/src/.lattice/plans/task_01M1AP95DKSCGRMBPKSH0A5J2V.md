# AS-26: Chat: message permalinks — expose message ids in the UI, anchor-link references

Planner: cto-owen (tech lead). Implementer: **developer-marcus**. Complexity: **high**
(raised from medium 2026-08-31: board DM msg 241 folded two more workstreams into
this task — file-reference links and inline markdown styling, §§5–6 below).
Branch: `feat/AS-26-message-permalinks`, worked in `.worktrees/AS-26/` per the
two-plane rule. Sequencing: AS-26 lands before AS-27 (loop status), which will
build on the msg-ref rendering added here.

## Origin & scope

Board DM msg 222: when a message is referenced by name ("msg 156"), it should link
to that message; expose the message number with each message in the UI; use an
anchor link. Owen's scope statement (DM msg 225): every message shows its number;
references render as anchor links that jump to and highlight the target; deep links
survive refresh by riding the AS-9 query-string URL state.

Board DM msg 241 (2026-08-31, acked msg 245 with a commitment to fold it in here):
(a) references to repo markdown files in chat messages should be links that open
the file in the chat app; (b) raw markdown ephemera (`**` etc.) in message bodies
should be stylized. Specified in §§5–6.

**What already exists (do not rebuild):** AS-9 shipped the whole anchor substrate —
`m=<id>` parses/serializes in `public/url-state.js`, `state.anchorMsg` +
`state.anchorApplied` live in `app.js`, every rendered message carries DOM id
`msg-<id>` (`messageNode`), and `renderConversation` does a one-shot
scroll-into-view + `.anchored` highlight (CSS animation already in `style.css`
line ~142). AS-26 is mostly *exposing* this substrate: visible numbers, clickable
refs, and one small server endpoint for cross-conversation resolution.

**Key data fact:** message ids are globally unique (single `messages` table,
`INTEGER PRIMARY KEY` across all conversations — `lib/store.js` schema). So
"msg 156" is unambiguous company-wide, and cross-conversation references are
well-defined. The board's own usage proves the cross-conversation case is the
common one ("DM msg 222" cited in #engineering), so v1 includes it.

## Approach

Six pieces, smallest possible surface each (§§1–4 original scope; §§5–6 added
from board DM msg 241):

### 1. Visible message number = the permalink anchor (client)

In `messageNode` (`public/app.js`), add a `#<id>` element to the `.meta` row,
rendered as a real `<a class="msg-permalink">`:

- `href` = the canonical deep link for that message, built with
  `serializeChatUrl` against an **empty** current search (foreign params are a
  copy-link's problem, not ours): `?c=<conv>&m=<id>` for top-level messages,
  `?c=<conv>&t=<root>&m=<id>` for thread replies (see §3).
- Plain click: `preventDefault()`, set `state.anchorMsg = m.id`,
  `state.anchorApplied = false`, re-apply the anchor (scroll + highlight),
  `syncUrl('push')`. Modified clicks (cmd/ctrl/shift/alt/middle) fall through to
  the href — exactly the AS-10 ref-link affordance, same guard expression.
  Net effect: right-click → Copy Link gives a durable permalink; plain click
  puts the permalink in the address bar for copying.
- `title="Permalink"`. Content via `textContent` only (house rule).
- Small CSS: muted color like `.time`, no underline until hover.

### 2. "msg 156" references become anchor links (client-only linkify)

New pure module `public/msg-refs.js` (same pattern as `url-state.js` /
`live.js`: no DOM, no fetch, importable from browser and node:test):

- `export function tokenizeMsgRefs(text)` → ordered array of
  `{ type: 'text', text }` and `{ type: 'msgref', text, id }` tokens.
- Pattern, case-insensitive: `\b(?:msg|message)s?\s*#?\s*(\d+)\b` for the first
  id, then continue consuming a separator list (`/`, `,`, `and`, whitespace)
  of bare integers so board idioms like "msgs 218/220/221" and
  "msgs 218, 220 and 221" yield one msgref token per number. Each token's
  `text` is the exact source slice (linkified text must round-trip verbatim).
  Bare numbers NOT preceded by a msg/message keyword are never matched.
- Ids must be positive safe integers (reuse the `INT_RE` discipline).

`bodyNode` in `app.js` becomes a composed pipeline. **Compose order is
re-specified in §6** (the markdown structure pass added by board msg 241 runs
first; ref passes then run over every plain-text leaf, AS-refs before msg-refs
before file-refs — the AS-first invariant survives so "AS-26" never gets its
"26" half-eaten). Msgref tokens render as `<a class="ref-link msg-ref">`
(reuse the ref-link look). AS-n refs and msg refs can never collide (patterns
are disjoint).

**Rendering is optimistic, resolution is click-time.** A `msg N` ref always
renders as a link; no per-ref network calls at render time (a channel history
has hundreds of refs — render-time fan-out is off the table). The href is
`?m=<id>` alone (parseable, but conversationless — restore treats it as
unrequested; acceptable placeholder since plain click is the primary path;
implementer may instead resolve-then-set href lazily on hover if trivial, but
that is optional polish, not scope).

Click handler (plain click, same modifier guard):
1. If `id` is present in the loaded conversation (`state.lastData.messages` or
   any `threads[root]` array) → local anchor: if it's a top-level message,
   behave like §1's click; if it's a thread reply, `openThread(root)` then
   anchor within the thread pane (§3).
2. Else `GET /api/message/<id>?me=` (§4). On success → navigate:
   `selectConversation` to the returned conversation with `state.anchorMsg`
   pre-set (and `anchorApplied = false`); if the target is a reply, also open
   its thread. Reuse the restore path's sequencing so the anchor applies after
   the fetch renders.
3. On 404/failure → neutral toast/alert: "That message isn't available." —
   byte-identical wording for nonexistent and not-visible (parity invariant).

### 3. Anchors inside threads (small grammar-policy change)

Today `restoreFromUrl` drops `m` when `t` is present ("m is ignored when t is
present"). Thread replies have DOM ids only inside the open thread modal, so a
reply permalink needs `t=<root>&m=<id>` to mean "open the thread, highlight the
reply". Change is app-policy only — `parseChatUrl`/`serializeChatUrl` already
carry both params:

- `restoreFromUrl`: when `t` is present and resolves, keep `m` too; after
  `openThread`, apply the anchor in `#thread-messages`.
- `renderThread`: same one-shot anchor logic as `renderConversation` (extract a
  tiny shared `applyAnchor(paneRootEl)` helper rather than duplicating —
  it checks `state.anchorMsg`/`anchorApplied`, scrolls, toggles `.anchored`;
  re-trigger the CSS animation on repeat anchors by removing the class,
  forcing reflow, re-adding).
- Update the grammar comment blocks in `url-state.js` and the README's
  deep-link contract section (`apps/chat/README.md`) — the comment currently
  documents the ignore rule. (README here is the app's README, which employees
  own — NOT the top-level repo files.)
- If `m`'s target is a top-level message while `t` is open: anchor applies to
  the main pane (it's visible behind/after modal close); keep it simple —
  anchor whichever pane contains `msg-<id>` after render.

### 4. One new endpoint: `GET /api/message/<id>` (server + store)

- `lib/store.js`: `getMessage(id, me)` — SELECT the row by id; if no row **or**
  `!visibleTo(row.conversationId, me)`, throw the same
  `StoreError('No such message.', 'not_found')` for both (nonexistent parity —
  a private-channel message must 404 byte-identically to a made-up id).
  On success return `{ id, conversationId, threadRootId, conversation: { id,
  type, name } }` — exactly enough for the client to build `c=`/`t=` navigation
  (`c=<name>` for channels, `c=dm:<convId>` for DMs). No body, no author: the
  resolver is for navigation, not preview (keeps the leak surface minimal —
  don't return content the viewer will fetch through the gated
  `/api/messages` anyway).
- `server.js` `handleApi`: route `GET /^\/api\/message\/(\d+)$/` with required
  `me` (same pattern as `/api/messages`). Note the existing
  `/api/task/<shortId>` route as the template.
- SSE/live path needs **zero** changes: numbers and msg-ref links are pure
  render-time client work, so push frames merged via `applyMessage` get both
  for free on re-render. Verify, don't modify.
- CLI (`bin/chat.js`): out of scope. AS-24 parity concerns *existing* CLI
  verbs; a resolver endpoint used only by UI navigation has no CLI story yet.
  Note it in the review comment if QA disagrees.

## Scope addition (board DM msg 241, folded in 2026-08-31)

Provenance: Forrest, DM msg 241 — "references to markdown files in the chat app
should be links that open the file here. also, I'm seeing markdown syntax
ephemera, such as \*\*. we should stylize these — this work can be done
together." Acked in DM msg 245; folded in here during the plan's migration to
master. This is the added complexity that moves the task from medium to high.
Marcus may sequence the implementation as two commit series on the branch
(permalinks §§1–4 first, then §§5–6) — but it is one task and one review.

### 5. Markdown file references open in-app (msg 241a)

**Tokenizer (client, pure):** add `export function tokenizeFileRefs(text)` to
`public/msg-refs.js` (same token shape: `{ type: 'fileref', text, path }`).
Match repo-relative `*.md` paths in body text: segments of
`[A-Za-z0-9._-]+` joined by `/`, ending in `.md`, with `.lattice/` as the only
permitted dot-leading segment (plan/note files are legitimately cited in chat).
Post-filter: reject any candidate containing a `..` segment. Bare filenames
(`README.md`, `PHILOSOPHY.md`) match. This pass runs on plain-text leaves like
the msg-ref pass — **including inside backtick code spans**, because
`` `apps/chat/README.md` `` is the dominant idiom in our chat history; a
`<code>`-wrapped `<a>` composes fine.

**Server endpoint:** `GET /api/file?path=<repo-relative>` in `handleApi`,
returning `{ path, content }` (JSON envelope, house pattern). No `me` gate and
no store involvement: everything servable under the gate below is repo-public
by construction. Recorded invariant that keeps this true: private-channel chat
content lives only in the DB and manual dumps (JSONL), and the AS-5 export
excludes private channels — **nobody may ever write private-channel content to
a `*.md` file in the repo** (this endpoint is one more reason the AS-6 rule
stays load-bearing).

**Path gate — every check, in order (path-traversal hardening):**
1. `path` present, length ≤ 512, matches `^[A-Za-z0-9._/-]+$` in full
   (rejects `%`-escapes surviving decode, whitespace, backslashes), ends in
   `.md` (case-sensitive), no leading `/`, no `//`.
2. Split on `/`: no empty segments, no `.` or `..` segments, no segment
   starting with `.` **except** a first segment exactly `.lattice`.
3. `join(root, path)`, then `realpathSync` both the repo root and the target;
   the target's realpath must start with the root's realpath + separator —
   this defeats symlink escape (a symlink inside the repo pointing outside
   fails the prefix check on its *resolved* path).
4. Must be a regular file (`statSync().isFile()`).
5. Size cap 512 KB.

Failure parity: checks 1–4 all throw one byte-identical
`StoreError('No such file.', 'not_found')` — a probe cannot distinguish
"outside the gate" from "doesn't exist". Check 5 alone returns a 400
`'File too large.'` (the file already passed the gate; nothing leaks).

**Viewer UI:** a new `#file-modal` in `index.html`, patterned on the thread
modal — title bar shows the path, close button + Esc, scrollable body. Content
rendered by the safe block renderer (§6 primitives): headings (`#`–`######` →
`el('div','md-h<level>')`, styled, not real h1s), fenced code blocks →
`<pre><code>` via textContent, everything else paragraphs (blank-line splits)
with the §6 inline pass applied and hard line breaks preserved. List lines
render as plain lines with their bullet/number characters intact (no
`<ul>`/`<ol>` construction in v1).

**Click handling:** `.file-ref` plain click (same modifier guard) → fetch
`/api/file`, open the modal; on failure, neutral "That file isn't available."
No `href` target for modified clicks in v1 (there is no standalone page for a
file); a `f=<path>` URL-state param is explicitly **out of scope**.

**Out of scope for §5:** non-`.md` files, directory listings, images, tables,
blockquotes, nested lists, editing, URL-state deep links to files, CLI story.

### 6. Inline markdown styling in message bodies (msg 241b)

**Pure module `public/markdown.js`** (no DOM, node:test-able):
- `tokenizeInline(text)` → ordered tokens:
  `{ type: 'text', text }`,
  `{ type: 'code' | 'strong' | 'em', text, inner }`,
  `{ type: 'link', text, inner, href }`.
  Supported syntax, by precedence: `` `code` `` first (its `inner` receives no
  further styling), then `**strong**`, then `*em*` / `_em_`, then
  `[text](href)` with an http/https-only scheme allowlist — any other scheme
  (`javascript:` etc.) fails the match and stays literal text. Single level,
  non-greedy, delimiters must hug non-space content (`** x **` stays literal);
  unmatched delimiters stay literal. Styled tokens drop their delimiters by
  design (that is the entire point); `text` still carries the exact source
  slice for tests.
- `parseBlocks(text)` → `{ type: 'heading', level, text }`,
  `{ type: 'code', text }` (fenced), `{ type: 'para', text }` — used only by
  the §5 file viewer. Message bodies get inline styling only; block markdown
  typed into chat (headings, lists) intentionally stays literal in v1.

**Compose order (supersedes §2's original two-pass note):** `bodyNode` becomes
structure-first:
1. `tokenizeInline(message.body)` over the whole body.
2. Every plain-text leaf — top-level text tokens AND the `inner` of
   strong/em/code/link tokens — runs the ref passes in order: AS-refs
   (existing server-annotated `message.refs`, `exists` only — same regex, now
   applied per-leaf; no server change), then `tokenizeMsgRefs`, then
   `tokenizeFileRefs`. AS-first preserved.
3. DOM assembly in `bodyNode`: strong → `<strong>`, em → `<em>`, code →
   `<code>`, link → `<a target="_blank" rel="noopener">`, refs → their
   existing anchor classes. Everything through `el()`/`textContent` /
   `createTextNode`. **Zero innerHTML anywhere — the house rule is
   non-negotiable; the tokenizers emit text and structure, never markup.**

Message input box stays plain text; no preview pane; no escaping syntax
(`\*`) in v1 — literal asterisks that must not style belong in code spans.

**Serving note (fixes an omission in the original §2):** every new
`public/*.js` module must be added to the `STATIC_FILES` map in `server.js` or
it 404s — add `/msg-refs.js` **and** `/markdown.js`.

### Key files added by §§5–6

| File | Change |
|---|---|
| `apps/chat/public/markdown.js` | NEW — pure `tokenizeInline` + `parseBlocks` |
| `apps/chat/test/markdown.test.js` | NEW — inline + block tokenizer unit tests |
| `apps/chat/public/msg-refs.js` | also `tokenizeFileRefs` (tests in `msg-refs.test.js`) |
| `apps/chat/server.js` | `GET /api/file` route + path gate; `STATIC_FILES` entries for `/msg-refs.js`, `/markdown.js` |
| `apps/chat/public/index.html` | `#file-modal` markup |
| `apps/chat/public/app.js` | structure-first `bodyNode` pipeline; file-ref click handler; file viewer render |
| `apps/chat/public/style.css` | strong/em/code styling in bodies; `.file-ref`; file-modal + `md-h*` viewer styles |
| `apps/chat/test/api.test.js` | `/api/file`: 200, traversal probes, parity 404s, size cap |

## Key files (original §§1–4)

| File | Change |
|---|---|
| `apps/chat/public/msg-refs.js` | NEW — pure tokenizer `tokenizeMsgRefs` |
| `apps/chat/test/msg-refs.test.js` | NEW — tokenizer unit tests (node:test, like `url-state.test.js`) |
| `apps/chat/public/app.js` | `messageNode` meta permalink; `bodyNode` composed pipeline (order per §6); msg-ref click handler w/ local-vs-remote resolution; thread-anchor policy in `restoreFromUrl`/`renderThread`; shared `applyAnchor` helper |
| `apps/chat/public/url-state.js` | comment/grammar doc update only (t+m now compose) |
| `apps/chat/public/style.css` | `.msg-permalink` styling; `.msg-ref` if it needs to differ from `.ref-link` |
| `apps/chat/lib/store.js` | `getMessage(id, me)` + export |
| `apps/chat/server.js` | `GET /api/message/<id>` route |
| `apps/chat/test/store.test.js` | `getMessage` cases incl. visibility parity |
| `apps/chat/test/api.test.js` | endpoint cases (200, 404 nonexistent, 404 non-member — assert identical bodies) |
| `apps/chat/README.md` | deep-link grammar: `t`+`m` composition; permalink feature note; file-viewer + markdown-styling notes |

## Edge cases (implement + test)

1. **Nonexistent id** ("msg 99999"): renders as link; click → neutral
   "That message isn't available." No crash, no console error, URL unchanged.
2. **Hidden/private conversation target**: non-member clicking a ref to a
   `#board` message gets the *identical* path/wording as (1). API responses for
   the two cases are byte-identical 404s (test asserts this).
3. **Same-conversation ref**: no network request at all; scroll + highlight;
   `m=` pushed to URL; refresh reproduces the view (AS-9 restore).
4. **Cross-conversation ref (visible)**: one `/api/message/<id>` call, then
   navigation + anchor; resulting URL is a durable deep link.
5. **Thread-reply target**: thread modal opens (`t=<root>`), reply highlighted
   inside the modal; `?c=..&t=..&m=..` restores the same view after refresh.
6. **Repeat click on the same ref**: highlight animation re-fires
   (anchorApplied reset + class re-add w/ reflow).
7. **AS-n adjacency**: "see AS-26 and msg 156" linkifies both, correctly
   segmented; "AS-26" alone produces no msg-ref; "26 messages" produces none.
8. **List idiom**: "msgs 218/220/221" → three links; "message 12, 14 and 15" →
   three links; each link's text is its exact source slice.
9. **Live/SSE**: a message arriving over the stream shows its number and
   linkified refs identically to cold-loaded history (render-time only —
   verify in stream/live tests or manually, no annotate() change).
10. **User navigation still drops anchors**: existing behavior (`url:'push'`
    paths null `anchorMsg`) must survive unchanged — permalink click is the
    only new writer of `anchorMsg`.
11. **XSS discipline**: everything through `textContent`/`el()`; no innerHTML.
    Tokenizer output is text slices, never markup.
12. **Traversal probes** (`../../etc/passwd`, `foo/../../x.md`, `/etc/x.md`,
    `.env`, `personnel/./x.md`, a 600-char path): all 404 byte-identical to a
    nonexistent `.md` (api.test.js asserts equality of bodies).
13. **Symlink escape**: a repo-internal symlink pointing outside the root is
    rejected by the realpath prefix check. Test with a temp symlink if the
    harness allows; if the CI filesystem can't, assert the realpath logic in a
    unit test against a fixture dir and note it in the review comment.
14. **Markdown false positives**: `2 * 3 * 4` stays literal (space-hugging
    rule); `snake_case_name` stays literal (delimiter must open after
    non-word boundary — match `_em_` only when `_` is word-boundary-adjacent);
    unmatched `` ` `` stays literal.
15. **Refs inside styling**: `**see msg 5**` → bold span containing a working
    msg-ref link; `` `apps/chat/README.md` `` → code span containing a working
    file-ref link.
16. **`javascript:` link**: `[x](javascript:alert(1))` renders as literal
    text, not a link (scheme allowlist).

## Acceptance criteria (QA-verifiable)

- [ ] Every message in channel view, DM view, and thread modal displays its
  numeric id in the meta row; right-click → copy link yields a URL that, opened
  fresh (new tab, direct paste), lands on that conversation with the message
  centered and highlighted — including the thread-reply case.
- [ ] Plain click on the number highlights in place and puts `m=<id>` in the
  URL without a full reload; browser Back restores the prior view (AS-9
  popstate still works).
- [ ] Body text "msg 156" (and "message 156", "msgs 218/220/221") renders as
  link(s); clicking navigates to and highlights the target — same conversation
  without network, other visible conversation via the resolver, thread replies
  via opened modal.
- [ ] Nonexistent and non-visible targets produce one identical neutral
  failure ("That message isn't available."); `test/api.test.js` asserts the
  404 bodies are byte-identical.
- [ ] A repo-relative `.md` path in a body (bare or inside backticks) renders
  as a link; plain click opens the in-app file viewer with the file rendered
  (headings, fenced code, inline styles — no raw `**`/`#` ephemera); close and
  Esc dismiss it. Nonexistent path → neutral "That file isn't available."
- [ ] `/api/file` traversal and probe requests (edge case 12) all return
  byte-identical 404s; size cap returns 400; asserted in `api.test.js`.
- [ ] `**bold**`, `*italic*`, `` `code` ``, and `[text](https://…)` in message
  bodies render styled with no visible delimiters; `javascript:` links and the
  false positives in edge case 14 stay literal; refs still linkify inside
  styled and code spans (edge case 15).
- [ ] `node --test apps/chat/test/` passes; new tests cover both tokenizers
  (`msg-refs`, `markdown` — edge cases 7–8, 14–16), `store.getMessage`
  (visibility parity), `/api/message/<id>`, and `/api/file` (gate + parity).
- [ ] No regression: AS-n ref links, sticky scroll (AS-17), drawer (AS-23),
  SSE merge (AS-25) untouched in behavior; `annotate()`/stream frames
  unmodified.
- [ ] No top-level repo markdown touched. Two-plane rule (2026-08-31): code
  commits go on `feat/AS-26-message-permalinks` inside `.worktrees/AS-26/` as
  `AS-26: …` under marcus's git identity; board state (`.lattice/`) commits to
  master only.

---

## Review Cycle 1 Findings

**Reviewer:** `agent:qa-priya`, 2026-08-31. **Verdict: FAIL — implementation-level
rework needed.** Full review comment on the task (`lattice show AS-26`); board
commit `e813ea7`. Routed `review -> in_progress` by the orchestrator. Branch is
untouched at `fc78244` — Priya applied no inline fixes, deliberately, because
the finding changes behavior.

**Score: 9 of 10 acceptance criteria pass.** Tests 190/190 green in a freshly
built container (`docker compose run --rm --build test`), independently
verified, not a stale image. STATIC_FILES is clean — both `/msg-refs.js` and
`/markdown.js` are in the allowlist, confirmed served over HTTP (200,
`text/javascript`) from a scratch container built from this branch, with
`api.test.js` now pinning it. The AS-17 lesson is institutionalized here, not
merely patched. XSS review found no hole: zero `innerHTML` in `public/`
(verified in the worktree *and* in the served bundle), all assembly via
`el()`/`textContent`/`createTextNode`, markdown hrefs tokenizer-anchored to
`^https?://`, msg-ref hrefs built from validated positive integers. The
`/api/file` traversal gate survived a live probe battery with byte-identical
404s, and `/api/message` hidden-vs-nonexistent parity is byte-identical.

### BLOCKING: `/api/file` is dead for repo-root markdown in the deployed container

This is the AS-17 failure class one layer up — not the static allowlist, but the
**compose mount**.

`apps/chat/compose.yaml` (unchanged in this diff) mounts only `.lattice/` and
`personnel/` under `/repo`, and the image bakes `CHAT_REPO_ROOT=/repo`. So in
the only supported deployment, `GET /api/file` returns 404 for `README.md`,
`PHILOSOPHY.md`, `CLAUDE.md`, and `apps/chat/README.md` — the plan's own named
examples, including what plan §5 calls "the dominant idiom in our chat history."
`.lattice/**.md` and `personnel/**.md` serve correctly. Live-verified on a
scratch server (port 18347) with production-shaped mounts, built from this
branch.

Every unit test passes because the suite is mountless by design and injects a
temp `repoRoot` — so the tests cannot see this. **Acceptance criterion 5 fails
in production:** clicking a file ref yields "That file isn't available."

### Rework scope

Make the container see the repo markdown, and make the README's stated scope
truthful. Priya's assessment is that a root `:ro` mount is compatible with the
existing gate, which already blocks non-`.md` paths, dot-leading segments
(including `.worktrees/`), and symlinks.

**Design call for the implementer to make deliberately, not by default:**
mounting the whole repo root read-only puts `.git/`, `.claude/`, and every other
repo path inside the container's filesystem view, defended only by the
`/api/file` gate. Weigh that against a narrower alternative — an explicit set of
mounted paths, or an allowlist of servable roots — and state the reasoning in
the commit or a task comment. Defense-in-depth argues for the narrow option if
it covers the named examples; the gate should not be the only thing standing
between the container and `.git/`.

Add a test that would have caught this: the mountless suite cannot, so the
coverage has to assert the *deployed* shape (mount config, or a served-over-HTTP
fetch of a repo-root `.md` against a production-shaped container).

### Non-blocking

- Cosmetic: `tokenizeMsgRefs`'s JSDoc is stranded above `FILE_RE` in
  `msg-refs.js`.
- All six of Marcus's declared deviations were assessed and accepted (the
  `resolveMessage` rename is the right call).
- Residual for whoever verifies the rework: browser-gesture visuals
  (scroll+highlight one-shot, animation re-fire, popstate walk) are
  code-verified only — worth a short human UI pass.

## Reset 2026-08-31 by agent:cto-owen
