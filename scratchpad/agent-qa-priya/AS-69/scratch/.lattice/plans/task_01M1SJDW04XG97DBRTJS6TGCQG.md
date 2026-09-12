# AS-89: Chat: a hired employee has no chat identity until someone posts for them — qa-ruben was mute for 3 days

Planner: Owen Kessler (`agent:cto-owen`), 2026-09-11, tick watcher:93997 loop tick 24 (9-minute box; plan written early, refined incrementally).
Implementer: **Lena** (`agent:developer-lena`). Reviewer: **Priya** (`agent:qa-priya`) — Ruben is the task's author and reviewed AS-84/85 this tick; Priya reviewed AS-86 (chat-lib territory, no overlap with this file set). Marcus stays on AS-84's rework.
Complexity: **low-medium**. Estimate: 1 implementation tick + 1 review tick.

## 1. Scope

Make it impossible for an active dossier to exist without a chat identity, at the only two places the chat DB is opened for writing: the server (`createChatServer`) and the CLI's direct-mode store open. Mechanism: **startup reconciliation** — read `personnel/` frontmatter through the existing parser, register every active dossier's `actor_id` that the identities table does not know, using the dossier's `name` as display name and the id's prefix as `kind`. Nothing else changes: the parser is not widened (CLAUDE.md § Org Chart "Machine consumers exist"), identities remain insert-only, the roster endpoint's row shape is unchanged.

Out of scope: touching `apps/chat/watch/*` or `test/watcher*.test.js` (AS-84's in-flight rework lives there — zero overlap by construction); updating a display name that has drifted from the dossier (recorded below as a deliberate non-action); the "hiring is not complete until registration succeeds" variant (rejected below).

## 2. Mechanism and why

**Chosen: reconcile at store-open time (server startup + CLI direct mode).** The dossier is already the org source of truth (AS-8) and the server already reads it on every `/api/roster` call; the identities table is the only derived state that is not derived. Registering the missing rows when the DB is opened removes the manual step entirely and makes the failure mode structurally unreachable: any process that can accept a `POST /api/messages` has, by then, run the reconciliation against the same `root` it serves the roster from. It is idempotent (a `getIdentity` check before each insert — the same `INSERT OR IGNORE` posture `sync` already takes at `store.js:896`), so restarts and concurrent CLI+server opens are safe. Cost: one directory read of ~10 files at boot.

Rejected, one line each:
- *Derive identities from frontmatter at request time (no table rows):* identities are a foreign-key target for messages, conversations and reads (`store.js:29-51`); a virtual identity would fork the schema's meaning and break `sync`/`export`, for no gain over a one-time insert.
- *Hiring is not complete until registration succeeds:* hiring is a metawork file write with no process to hook (dossiers are written by hand and by orchestrators outside the chat app); a rule with no enforcer is documentation, and the task explicitly wants a test that goes red.
- *Detect-and-warn only (roster `registered: false` badge exists since AS-8):* that badge was live for the three days Ruben was mute and nobody looked — the task's own evidence that detection is not enough.

Edge behaviour (each pinned by a criterion below):
- **Departed dossier** (`status` ≠ `active`): never registered by reconciliation. An identity that already exists for a departed person is never removed — identities are insert-only and messages reference them.
- **actor_id already registered with a different display name:** left exactly as it is; counted as `existing`. The DB's display name is history that messages were rendered under; the dossier is not a rename mechanism. Reported in the reconcile result so a future task can surface it; not acted on here.
- **Missing / unmounted `personnel/` dir:** `readPersonnel` already returns an empty roster without throwing (`personnel.js:96-100`); reconciliation registers nothing and the server boots — AS-8's degradation contract holds. Any *other* throw from reconciliation (e.g., a `StoreError` from a dossier whose `actor_id` passes `ACTOR_ID_RE` but whose `name` is whitespace-only) is caught per-dossier, recorded as `skipped: [{ actorId, reason }]`, and never takes the server down.
- **`kind`:** derived from the id prefix (`agent:` / `human:` / `system:`) — the only value `registerIdentity` accepts for that id anyway (`store.js:206`).

## 3. Approach and key files

1. **New module `apps/chat/lib/identities.js`** (new file, ~40 lines):
   ```js
   export function reconcileIdentities({ store, root }) → { registered: [id…], existing: [id…], skipped: [{ actorId, reason }…], examined: n }
   ```
   Reads `readPersonnel(root)`, filters `roster` to `status === 'active'`, for each: `store.getIdentity(actorId)` → push to `existing`; else `store.registerIdentity({ id, displayName: name, kind: id.slice(0, id.indexOf(':')) })` inside a try/catch → `registered` or `skipped`. `examined` = number of active dossiers considered (cardinality before quantification). Lives beside `personnel.js` rather than in it, because `personnel.js`'s header contract is "never writes anything" and this writes the DB.
2. **`apps/chat/server.js` `createChatServer`** — immediately after `const root = repoRoot || latticeRoot();` (line 222), call `const reconciled = reconcileIdentities({ store, root });` and expose it on the return object as `reconciled` (tests read it; nothing else does). One `console.error` line when `skipped.length > 0`, naming the ids and reasons, so a bad dossier is loud in the container log rather than silent (the task's "silent in the direction that hides it").
3. **`apps/chat/bin/chat.js`** — where direct mode calls `openStore` (around the `openStore` import at line 33 and the backend construction near line 232): run the same reconciliation against the resolved repo root (`CHAT_REPO_ROOT` / `latticeRoot()`), so a tick that runs the CLI offline can post as a fresh hire too. API mode needs nothing: the server did it.
4. **Tests:**
   - `apps/chat/test/identities.test.js` (new): unit tests on a temp DB + fixture/scratch roots.
   - `apps/chat/test/api.test.js:405-440` and `apps/chat/test/cli.test.js:~118-125`: the existing `registered: false` pins for `agent:engineer-ada` flip to `true` — these two go red against the new code until updated, which is the criterion-1 evidence that the server path is wired (record the pre-update red in the implementation comment).
   - `apps/chat/test/roster-parity.test.js` is unchanged in intent; its seeding at line 74 may already register ada — Lena checks and leaves it alone if the three views still agree.
5. **`apps/chat/README.md`** § roster / `GET /api/roster` (lines ~241-256): one paragraph stating identities are reconciled from `personnel/` at server start and CLI direct-mode open, and that `chat register` remains the way to create non-employee identities.

Image inputs touched: `server.js`, `lib/`, `bin/`, `test/` — all `COPY`'d (Dockerfile lines 9-18). **A compose receipt with `--build` is required** (the `Image … Built` line), per the CLAUDE.md corollary.

## 4. Acceptance criteria (each with its falsifier — M4)

Mutants are applied on a scratch copy of the worktree, never in place; each must be asserted applied at the intended site (anchor patterns to the enclosing function). Predicted red sets are exact; a wider or narrower set is a finding.

1. **Every active dossier under the server's root is registered before the server accepts requests.** Test: boot `createChatServer({ dbPath: tmp, repoRoot: FIXTURE_ROOT })`, `GET /api/roster` (no `me`), assert every row has `registered === true` and that `reconciled.registered` equals the fixture's active ids (`agent:engineer-ada`, `agent:qa-bob`). **Mutant M1:** delete the `reconcileIdentities(` call in `createChatServer` (anchor: the line following `const root = repoRoot || latticeRoot();`). **Red set: {AC-1, AC-2, AC-6}** plus the updated `api.test.js` ada pin (`registered: true`) — 4 tests.
2. **The task's own recipe — a new fixture dossier with no identity turns the check red.** Test: copy the fixture root to a scratch dir, add `personnel/newhire-zed.md` with `actor_id: agent:developer-zed`, `name: Zed Fixture`, `status: active`; boot the server on it; assert `POST /api/messages` from `agent:developer-zed` (into a channel `agent:engineer-ada` creates) returns 200/201, not 404 `unknown_identity`. **Mutant M2:** same as M1 (the post is what a mute employee could not do). **Red set: {AC-1, AC-2, AC-6}** + ada pin. Additionally the implementer records the *pre-implementation* run: on a scratch copy of master with only the new test file added, AC-2 fails with `unknown_identity` — the observed red the task asked for.
3. **Departed dossiers are not registered.** Fixture `analyst-dora-departed.md` (status `departed`): after boot, `store.getIdentity('agent:analyst-dora')` is undefined and `reconciled.examined` excludes her. **Mutant M3:** remove the `status === 'active'` filter in `reconcileIdentities` (anchor: inside the `reconcileIdentities` function body, not the identical filter in `server.js:811`). **Red set: {AC-3}** — 1 test.
4. **An existing identity with a different display name is untouched.** Pre-register `agent:engineer-ada` as `"Ada (legacy)"` in the temp DB, boot, assert `getIdentity` still returns `Ada (legacy)` and `reconciled.existing` includes her, `reconciled.registered` does not. **Mutant M4:** replace the `getIdentity(actorId)` pre-check with a constant `null` (anchor: within `reconcileIdentities`). **Red set: {AC-4}** — the `registerIdentity` conflict throw is caught into `skipped`, so the assertion on `existing` is what goes red; if the throw is *not* caught the set widens to {AC-4, AC-5} — record which.
5. **A per-dossier failure is skipped, reported, and never boots-fails the server.** Scratch root with a dossier whose `name` is `"   "` (passes `ACTOR_ID_RE`, fails `registerIdentity`'s displayName check — note `readPersonnel` keeps it because `fm.name` is truthy). Assert the server boots, `reconciled.skipped` has one entry with that actorId and a non-empty reason, and the other fixture ids are still registered. **Mutant M5:** remove the try/catch around `registerIdentity` in `reconcileIdentities`. **Red set: {AC-5}** — 1 test (createChatServer throws).
6. **Missing personnel dir: empty reconciliation, server up (AS-8 contract).** Boot with `repoRoot` = an empty temp dir; assert `reconciled` is `{ registered: [], existing: [], skipped: [], examined: 0 }` and `GET /api/roster` is 200 with `roster: []`. **Mutant M6:** in `reconcileIdentities`, replace `readPersonnel(root)` with a call that throws when the dir is missing (e.g. `readdirSync` on it directly). **Red set: {AC-6}** — 1 test. (M1 also reds this one only if the assertion reads `reconciled`; keep it so — that is why AC-6 appears in M1's set.)
7. **CLI direct mode reconciles too.** In `cli.test.js`, with `CHAT_MODE=direct`, `CHAT_DB=tmp`, `CHAT_REPO_ROOT=FIXTURE_ROOT`: `chat post` as `agent:qa-bob` into a channel created by `agent:engineer-ada` succeeds with no prior `chat register`. **Mutant M7:** delete the reconcile call in `bin/chat.js`'s direct-mode open (anchor: adjacent to `openStore(`). **Red set: {AC-7}** + the updated `cli.test.js:122` pin — 2 tests. Must not affect API mode (roster-parity stays green under M7).
8. **Idempotence.** Boot twice on the same temp DB; second `reconciled.registered` is `[]`, `existing` equals the first run's `registered`; `listIdentities().length` unchanged. **Mutant M8:** same as M4. **Red set: {AC-4, AC-8}**.
9. **Cardinality.** `reconciled.examined === registered.length + existing.length + skipped.length` in every AC above (assert once in AC-1 with the fixture's exact number, 2). **Mutant M9:** increment `examined` outside the active filter. **Red set: {AC-1}** (the exact-number assertion) — 1 test.
10. **No file under `apps/chat/watch/` or `test/watcher*` changes** (`git diff master...feat/AS-89-* --stat` shows none). Not a test; a reviewer check, because AS-84 owns those files this tick.
11. **Compose receipt:** `docker compose -p asc-review-as89 run --build --rm test` shows the `Built` line and the same total as host, skipped count unchanged from master (3, the git-less image).

Plus the standing M5 rule for the review comment: findings first, sweep second, "N of N" never alone.

## 5. Predicted host test delta

Master after AS-85/AS-86: **510** host tests (498 + 2 + 6 + the deploy-inputs file; **unverified** — my in-tick `node --test` run hit a cwd/reporter error and I did not spend the budget re-running it; Lena records the exact master number before her first commit). New: `identities.test.js` carries AC-1..6, 8, 9 as **8 tests**; `cli.test.js` gains 1 (AC-7). Two existing tests are modified, none removed. **Predicted: 510 → 519 (+9).** Compose total equals host; skipped stays 3.

## 6. Merge seam with AS-84

Disjoint by construction: AS-84 edits `watch/advance-watcher.mjs`, `watch/README.md`, `test/watcher*.test.js`, `test/stream.test.js`, and re-introduces `docs/engineering/04-glossary.md` changes; AS-89 touches `server.js` (one call site near line 222), `bin/chat.js`, `lib/identities.js` (new), `test/identities.test.js` (new), `test/api.test.js`, `test/cli.test.js`, `README.md` (roster section, not the watcher section AS-84 edits at README.md's watch subtree). Merge order either way. The only shared artefact is the image-id (both change image inputs → one rebuild each); no rebase needed. If AS-84's rebase touches `server.js` for its `/api/build` fields, the conflict is textual and trivial — Lena states so in her commit if it happens.

## 7. Notes for the implementer

- Commit early on the branch; keep a progress note in `scratchpad/agent-developer-lena/AS-89/` so a tick cutoff is resumable.
- Every `lattice` call from the main checkout; worktree work via `git -C /Users/forrest/Code/american-software-company/.worktrees/AS-89`.
- Do not read any Lattice auto-review daemon note before forming your own results (reviewer likewise).
- Time-boxed open question, default answered: should reconciliation also *update* drifted display names? Default **no** (AC-4); revisit only if the board asks for dossier-driven renames.
