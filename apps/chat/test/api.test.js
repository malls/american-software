// Integration tests: real server on an ephemeral port, temp DB, driven by fetch.
// repoRoot points at the fixture .lattice/ so lattice behavior is deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync, mkdirSync, symlinkSync, unlinkSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createChatServer, LOOP_POLL_MS, LANES_POLL_MS, composeBuild } from '../server.js';
import { LANES_STALE_MS, LANE_WORKTREE_KEYS } from '../lib/lanes.js';
import { describeLanes, EMPTY_STATES } from '../public/lanes.js';
import { DEFAULTS } from '../watch/advance-watcher.mjs';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

async function bootServer(t, repoRoot = FIXTURE_ROOT, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-api-'));
  // AS-27: scratch (non-existent) data dir by default — the loop-status reads
  // must never touch the real apps/chat/data. Tests that care pass their own.
  const { server, store, close } = createChatServer({
    dbPath: join(dir, 'chat.db'), repoRoot, dataDir: join(dir, 'loop-data'), ...opts,
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
  };
  const post = async (path, body) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  return { base, get, post, store };
}

test('api: identities, CSP header, static page', async (t) => {
  const { base, get, post } = await bootServer(t);
  const ids = await get('/api/identities');
  assert.equal(ids.status, 200);
  assert.equal(ids.data.identities.length, 4);
  assert.equal(ids.headers.get('content-security-policy'), "default-src 'self'");

  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-security-policy'), "default-src 'self'");
  assert.match(await page.text(), /ASC Chat/);

  const reg = await post('/api/identities', {
    id: 'agent:qa-priya',
    displayName: 'Priya Raman (QA)',
    kind: 'agent',
  });
  assert.equal(reg.status, 200);
  const dup = await post('/api/identities', { id: 'agent:qa-priya', displayName: 'x', kind: 'agent' });
  assert.equal(dup.status, 409);
  const bad = await post('/api/identities', { id: 'nope', displayName: 'x', kind: 'agent' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Invalid identity id/);
});

test('api: startup ingestion fills lattice-events; channel guarded from non-system posts', async (t) => {
  const { get, post } = await bootServer(t);
  const convs = await get('/api/conversations?me=human:forrest');
  const events = convs.data.conversations.find((c) => c.name === 'lattice-events');
  const msgs = await get(`/api/messages?conversation=${events.id}&me=human:forrest`);
  assert.equal(msgs.data.messages.length, 4, 'fixture events ingested at startup');
  const denied = await post('/api/messages', {
    conversation: events.id,
    author: 'human:forrest',
    body: 'manual top-level',
  });
  assert.equal(denied.status, 403);
  // …but replying in a thread on an event is allowed.
  const reply = await post('/api/messages', {
    conversation: events.id,
    author: 'human:forrest',
    body: 'discussing',
    threadRoot: msgs.data.messages[0].id,
  });
  assert.equal(reply.status, 200);
});

test('api: channels, messages, threads, refs, unread, read watermark', async (t) => {
  const { get, post } = await bootServer(t);
  // Create a channel.
  const ch = await post('/api/channels', { name: 'qa', purpose: 'QA chatter', actor: 'human:forrest' });
  assert.equal(ch.status, 200);
  const badCh = await post('/api/channels', { name: 'Bad Name', actor: 'human:forrest' });
  assert.equal(badCh.status, 400);
  const convId = ch.data.conversation.id;

  // Post with a ref + a script body (stored raw; UI escapes at render).
  const m1 = await post('/api/messages', {
    conversation: convId,
    author: 'human:forrest',
    body: 'Tracking AS-7 here. <script>alert(1)</script>',
  });
  assert.equal(m1.status, 200);
  assert.equal(m1.data.message.body, 'Tracking AS-7 here. <script>alert(1)</script>');
  assert.deepEqual(m1.data.message.refs.map((r) => [r.shortId, r.exists, r.status]), [
    ['AS-7', true, 'in_progress'],
  ]);

  // Thread reply; reply-to-reply flattens to the root.
  const r1 = await post('/api/messages', {
    conversation: convId, author: 'agent:cto-owen', body: 'on it', threadRoot: m1.data.message.id,
  });
  const r2 = await post('/api/messages', {
    conversation: convId, author: 'human:forrest', body: 'thanks', threadRoot: r1.data.message.id,
  });
  assert.equal(r2.data.message.threadRootId, m1.data.message.id);
  const view = await get(`/api/messages?conversation=${convId}&me=human:forrest`);
  assert.equal(view.data.messages.length, 1, 'replies never top-level');
  assert.equal(view.data.messages[0].replyCount, 2);
  assert.equal(view.data.threads[m1.data.message.id].length, 2);

  // DM get-or-create.
  const dm1 = await post('/api/dms', { me: 'human:forrest', other: 'agent:ceo-carla' });
  const dm2 = await post('/api/dms', { me: 'agent:ceo-carla', other: 'human:forrest' });
  assert.equal(dm1.data.conversation.id, dm2.data.conversation.id);
  await post('/api/messages', { conversation: dm1.data.conversation.id, author: 'human:forrest', body: 'hi Carla' });

  // Unread for Carla: the qa-channel traffic (3) + the DM (1); reading clears.
  const unread = await get('/api/unread?me=agent:ceo-carla');
  const byConv = Object.fromEntries(unread.data.unread.map((g) => [g.conversationId, g.messages.length]));
  assert.equal(byConv[convId], 3);
  assert.equal(byConv[dm1.data.conversation.id], 1);
  const mark = await post('/api/read', { me: 'agent:ceo-carla', conversation: convId });
  assert.equal(mark.status, 200);
  const after = await get('/api/unread?me=agent:ceo-carla');
  assert.ok(!after.data.unread.some((g) => g.conversationId === convId));

  // Non-member cannot read-mark or post into someone else's DM.
  const forbidden = await post('/api/messages', {
    conversation: dm1.data.conversation.id, author: 'agent:cto-owen', body: 'intruding',
  });
  assert.equal(forbidden.status, 403);
});

test('api: AS-3 — POST /api/read with over-max upTo is 400 and moves nothing', async (t) => {
  const { get, post } = await bootServer(t);
  const ch = await post('/api/channels', { name: 'bounds', purpose: 'AS-3', actor: 'human:forrest' });
  const convId = ch.data.conversation.id;
  const m = await post('/api/messages', { conversation: convId, author: 'human:forrest', body: 'only message' });
  const maxId = m.data.message.id;

  const over = await post('/api/read', { me: 'agent:ceo-carla', conversation: convId, upTo: maxId + 999 });
  assert.equal(over.status, 400);
  assert.match(over.data.error, /Invalid upTo/);

  const unread = await get('/api/unread?me=agent:ceo-carla');
  const group = unread.data.unread.find((g) => g.conversationId === convId);
  assert.equal(group.messages.length, 1, 'rejected upTo did not move the watermark');

  // In-bounds still works and clears the unread.
  const ok = await post('/api/read', { me: 'agent:ceo-carla', conversation: convId, upTo: maxId });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.read.lastReadId, maxId);
  const after = await get('/api/unread?me=agent:ceo-carla');
  assert.ok(!after.data.unread.some((g) => g.conversationId === convId));
});

test('api: task resolution endpoint and clear 4xx errors', async (t) => {
  const { get, post } = await bootServer(t);
  const hit = await get('/api/task/AS-7');
  assert.deepEqual(hit.data.task, {
    shortId: 'AS-7', exists: true, taskId: 'task_TESTAAAA',
    title: 'Fixture task seven', status: 'in_progress',
    url: 'http://127.0.0.1:8799/#/task/task_TESTAAAA', // AS-10
  });
  const miss = await get('/api/task/AS-404');
  assert.deepEqual(miss.data.task, { shortId: 'AS-404', exists: false });

  assert.equal((await get('/api/conversations?me=agent:ghost')).status, 404);
  assert.equal((await get('/api/messages?conversation=9999&me=human:forrest')).status, 404);
  // AS-6: 'me' is now required on GET /api/messages.
  const noMe = await get('/api/messages?conversation=9999');
  assert.equal(noMe.status, 400);
  assert.match(noMe.data.error, /Missing query parameter 'me'/);
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await post('/api/messages', { conversation: 1, author: 'human:forrest' })).status, 400);
});

test('api: AS-6 — #board is hidden from non-members, byte-identically to nonexistent', async (t) => {
  const { get, post } = await bootServer(t);
  await post('/api/identities', {
    id: 'agent:developer-marcus', displayName: 'Marcus Webb (Engineer)', kind: 'agent',
  });
  const N = 'agent:developer-marcus';

  // Members see #board in /api/conversations; the non-member does not.
  const forMember = await get('/api/conversations?me=human:forrest');
  const board = forMember.data.conversations.find((c) => c.name === 'board');
  assert.ok(board, 'member sees #board');
  assert.equal(board.visibility, 'private');
  const forN = await get(`/api/conversations?me=${encodeURIComponent(N)}`);
  assert.equal(forN.status, 200);
  assert.ok(!forN.data.conversations.some((c) => c.name === 'board' || c.id === board.id));

  // Member traffic on #board (also proves member happy path over HTTP).
  const posted = await post('/api/messages', {
    conversation: board.id, author: 'agent:ceo-carla', body: 'board only',
  });
  assert.equal(posted.status, 200);

  // Probe parity: hidden vs nonexistent — same status, same body modulo the
  // echoed id (the error template echoes the id the prober already supplied).
  const norm = (body, id) => JSON.stringify(body).replaceAll(`'${id}'`, "'<id>'");
  const pairs = [
    [
      await get(`/api/messages?conversation=${board.id}&me=${encodeURIComponent(N)}`),
      await get(`/api/messages?conversation=99999&me=${encodeURIComponent(N)}`),
    ],
    [
      await post('/api/messages', { conversation: board.id, author: N, body: 'probe' }),
      await post('/api/messages', { conversation: 99999, author: N, body: 'probe' }),
    ],
    [
      await post('/api/read', { me: N, conversation: board.id }),
      await post('/api/read', { me: N, conversation: 99999 }),
    ],
  ];
  for (const [hidden, missing] of pairs) {
    assert.equal(hidden.status, 404, 'never 403 — that would prove existence');
    assert.equal(missing.status, 404);
    assert.deepEqual(Object.keys(hidden.data), Object.keys(missing.data));
    assert.equal(norm(hidden.data, board.id), norm(missing.data, 99999));
  }

  // Board messages never reach the non-member's unread feed.
  const unread = await get(`/api/unread?me=${encodeURIComponent(N)}`);
  assert.ok(!unread.data.unread.some((g) => g.conversationId === board.id));
  // …but they do reach a member's.
  const memberUnread = await get('/api/unread?me=agent:cto-owen');
  assert.ok(memberUnread.data.unread.some((g) => g.conversationId === board.id));

  // Channel-name collision: uninformative for the non-member (409, no
  // existence confirmation), ordinary message for a member.
  const squatted = await post('/api/channels', { name: 'board', actor: N });
  assert.equal(squatted.status, 409);
  assert.equal(squatted.data.error, "Channel name 'board' is unavailable.");
  assert.ok(!/exist/i.test(squatted.data.error));
  const memberCollision = await post('/api/channels', { name: 'board', actor: 'human:forrest' });
  assert.equal(memberCollision.status, 409);
  assert.match(memberCollision.data.error, /already exists/);

  // Member read path over #board works end to end.
  const view = await get(`/api/messages?conversation=${board.id}&me=human:forrest`);
  assert.equal(view.status, 200);
  assert.equal(view.data.messages.at(-1).body, 'board only');
  assert.equal((await post('/api/read', { me: 'human:forrest', conversation: board.id })).status, 200);
});

test('api: AS-11 — cross-conversation threadRoot rejection is type-blind over HTTP', async (t) => {
  // Pins the accepted-residual contract at the wire level: same status (400,
  // never 403) and byte-identical body whether the invisible root lives in
  // #board or in a foreign DM; nonexistent roots keep their distinct,
  // documented wording.
  const { get, post } = await bootServer(t);
  await post('/api/identities', {
    id: 'agent:developer-marcus', displayName: 'Marcus Webb (Engineer)', kind: 'agent',
  });
  const N = 'agent:developer-marcus';

  const convs = await get('/api/conversations?me=human:forrest');
  const eng = convs.data.conversations.find((c) => c.name === 'engineering');
  const board = convs.data.conversations.find((c) => c.name === 'board');
  const boardRoot = await post('/api/messages', {
    conversation: board.id, author: 'agent:ceo-carla', body: 'board root',
  });
  const dm = await post('/api/dms', { me: 'human:forrest', other: 'agent:ceo-carla' });
  const dmRoot = await post('/api/messages', {
    conversation: dm.data.conversation.id, author: 'human:forrest', body: 'dm root',
  });

  const probe = (rootId) =>
    post('/api/messages', { conversation: eng.id, author: N, body: 'probe', threadRoot: rootId });
  const viaBoard = await probe(boardRoot.data.message.id);
  const viaDm = await probe(dmRoot.data.message.id);

  // Identical status: 400 for both — a 403 here would type-mark the root.
  assert.equal(viaBoard.status, 400);
  assert.equal(viaDm.status, 400);

  // Exact bodies pinned — byte-identical modulo the echoed prober-supplied id,
  // carrying no conversation id or name of the root's conversation.
  const expected = (id) => ({
    error: `Message ${id} belongs to a different conversation; thread replies stay in their conversation.`,
  });
  assert.deepEqual(viaBoard.data, expected(boardRoot.data.message.id));
  assert.deepEqual(viaDm.data, expected(dmRoot.data.message.id));
  const norm = (r, id) => JSON.stringify(r.data).replaceAll(`Message ${id} `, 'Message <id> ');
  assert.equal(norm(viaBoard, boardRoot.data.message.id), norm(viaDm, dmRoot.data.message.id));

  // Nonexistent root: same 400, the OTHER wording — a documented, deliberate
  // split (it reveals only that real ids are allocated, which sequential ids
  // plus the git export already publish).
  const missing = await probe(999999);
  assert.equal(missing.status, 400);
  assert.deepEqual(missing.data, { error: "Unknown thread root message '999999'." });
});

test('api: AS-9 — url-state.js is served; query string never affects static routing', async (t) => {
  const { base } = await bootServer(t);
  const mod = await fetch(base + '/url-state.js');
  assert.equal(mod.status, 200);
  assert.equal(mod.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await mod.text(), /parseChatUrl/);

  // Deep links land on the same index.html — the query is client-side state.
  for (const path of ['/?c=general', '/?c=dm:7&t=42&m=9', '/?c=no-such-channel&junk=1']) {
    const page = await fetch(base + path);
    assert.equal(page.status, 200, path);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await page.text(), /ASC Chat/);
  }
});

test('api: AS-17 — scroll.js is served (app.js module graph must not 404)', async (t) => {
  const { base } = await bootServer(t);
  const mod = await fetch(base + '/scroll.js');
  assert.equal(mod.status, 200);
  assert.equal(mod.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await mod.text(), /renderPreservingScroll/);
});

test('api: AS-19 — thread-modal.js is served; index.html ships the modal, not the sidebar', async (t) => {
  const { base } = await bootServer(t);
  const mod = await fetch(base + '/thread-modal.js');
  assert.equal(mod.status, 200);
  assert.equal(mod.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await mod.text(), /shouldCloseOnEscape/);

  // The served page carries the modal skeleton (dialog semantics + the inner
  // ids renderThread/AS-9 depend on) and no trace of the retired sidebar.
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /id="thread-modal"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  for (const id of ['thread-title', 'thread-messages', 'thread-composer', 'thread-input', 'thread-close']) {
    assert.match(html, new RegExp(`id="${id}"`), `inner id ${id} kept verbatim`);
  }
  assert.doesNotMatch(html, /thread-panel/, 'narrow thread sidebar is gone from the DOM');
});

test('api: AS-23 — served page and CSS carry the mobile layout artifacts', async (t) => {
  const { base } = await bootServer(t);

  // index.html: safe-area viewport + the two new mobile-only elements.
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /viewport-fit=cover/, 'viewport meta covers the safe area');
  assert.match(html, /id="sidebar-toggle"/, 'hamburger toggle in the header');
  assert.match(html, /id="sidebar-scrim"/, 'drawer scrim present');

  // style.css: the mobile block and its load-bearing rules.
  const cssRes = await fetch(base + '/style.css');
  assert.equal(cssRes.status, 200);
  assert.equal(cssRes.headers.get('content-type'), 'text/css; charset=utf-8');
  const css = await cssRes.text();
  assert.match(css, /@media \(max-width: 700px\)/, 'mobile breakpoint');
  assert.match(css, /translateX\(-100%\)/, 'off-canvas drawer transform');
  assert.match(css, /hover: none/, 'touch unhides message actions');
  assert.match(css, /100dvh/, 'dvh viewport fallback');
  assert.match(css, /--app-height/, 'visualViewport pin variable');
  assert.match(css, /overflow-x: hidden/, 'no-horizontal-scroll invariant');
  assert.match(css, /safe-area-inset-bottom/, 'home-indicator clearance');
  assert.doesNotMatch(css, /width: 300px/, 'task panel width is clamped via min(), never bare');
});

test('api: AS-8 — roster joins personnel, lattice work status, and DM state', async (t) => {
  const { get, post } = await bootServer(t);

  // 'me' is optional since AS-24 (CLI parity): without it the viewer-relative
  // fields (dmConversationId/unread/self) are omitted entirely.
  const noMe = await get('/api/roster');
  assert.equal(noMe.status, 200);
  assert.deepEqual(noMe.data.roster.map((r) => r.actorId), ['agent:eng-ada', 'agent:qa-bob']);
  for (const row of noMe.data.roster) {
    for (const k of ['dmConversationId', 'unread', 'self']) {
      assert.ok(!(k in row), `viewer-relative field ${k} absent without me`);
    }
  }

  const first = await get('/api/roster?me=human:forrest');
  assert.equal(first.status, 200);
  // Only status: active dossiers, sorted by name — departed/malformed/bad
  // actor_id/README fixtures never appear.
  assert.deepEqual(
    first.data.roster.map((r) => r.actorId),
    ['agent:eng-ada', 'agent:qa-bob']
  );
  const ada = first.data.roster[0];
  assert.deepEqual(ada, {
    actorId: 'agent:eng-ada',
    name: 'Ada Fixture',
    title: 'Fixture Engineer',
    class: 'ic',
    team: 'engineering',
    reportsTo: 'agent:cto-owen', // AS-33: the reporting edge rides the roster row
    registered: false, // not in the identities table yet
    dmConversationId: null,
    unread: 0,
    self: false,
    work: {
      shortId: 'AS-22',
      taskId: 'task_TESTC2',
      title: 'Ada primary in-progress',
      status: 'in_progress',
      url: 'http://127.0.0.1:8799/#/task/task_TESTC2',
    },
    moreTasks: 2, // AS-21 and AS-23 beyond the primary
  });
  // Bob's only assignments are done/backlog: idle.
  assert.equal(first.data.roster[1].work, null);
  assert.equal(first.data.roster[1].moreTasks, 0);

  // Register + open a DM + one message from ada: registered flips, the DM id
  // appears with the correct viewer-relative unread.
  await post('/api/identities', { id: 'agent:eng-ada', displayName: 'Ada Fixture', kind: 'agent' });
  const dm = await post('/api/dms', { me: 'human:forrest', other: 'agent:eng-ada' });
  await post('/api/messages', {
    conversation: dm.data.conversation.id, author: 'agent:eng-ada', body: 'hello from ada',
  });
  const second = await get('/api/roster?me=human:forrest');
  const ada2 = second.data.roster.find((r) => r.actorId === 'agent:eng-ada');
  assert.equal(ada2.registered, true);
  assert.equal(ada2.dmConversationId, dm.data.conversation.id);
  assert.equal(ada2.unread, 1);
  // The other party sees the same DM id but their own unread (0 — they wrote it).
  const forAda = await get('/api/roster?me=agent:eng-ada');
  const selfRow = forAda.data.roster.find((r) => r.actorId === 'agent:eng-ada');
  assert.equal(selfRow.self, true);
  assert.equal(selfRow.dmConversationId, null, 'no DM with yourself');
  const bobRow = forAda.data.roster.find((r) => r.actorId === 'agent:qa-bob');
  assert.equal(bobRow.dmConversationId, null, "ada has no DM with bob — forrest's DM never leaks");

  // Unknown viewer: same 404 as /api/conversations.
  assert.equal((await get('/api/roster?me=agent:ghost')).status, 404);
});

test('api: AS-8 — roster degrades to empty when personnel/ is absent', async (t) => {
  // Repo root with no personnel/ (and no .lattice/): 200 + [], never a crash.
  const bareRoot = mkdtempSync(join(tmpdir(), 'chat-bare-root-'));
  t.after(() => rmSync(bareRoot, { recursive: true, force: true }));
  const { get } = await bootServer(t, bareRoot);
  const res = await get('/api/roster?me=human:forrest');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { roster: [] });
});

// --- AS-24: API parity endpoints (the CLI's API mode drives exactly these) ---

test('api: AS-24 — POST /api/channels honors visibility/members; members-without-private is a store-level 400', async (t) => {
  const { get, post } = await bootServer(t);
  await post('/api/identities', {
    id: 'agent:developer-marcus', displayName: 'Marcus Webb (Engineer)', kind: 'agent',
  });
  const N = 'agent:developer-marcus';

  // Private create round-trip: creator + one member see it, others don't.
  const priv = await post('/api/channels', {
    name: 'warroom', purpose: 'private over HTTP', actor: 'agent:ceo-carla',
    visibility: 'private', members: ['agent:ceo-carla', 'human:forrest'],
  });
  assert.equal(priv.status, 200);
  assert.equal(priv.data.conversation.visibility, 'private');
  assert.ok(!('members' in priv.data.conversation), 'AS-6 conversation shape: no members key');
  const forMember = await get('/api/conversations?me=human:forrest');
  assert.ok(forMember.data.conversations.some((c) => c.name === 'warroom'));
  const forN = await get(`/api/conversations?me=${encodeURIComponent(N)}`);
  assert.ok(!forN.data.conversations.some((c) => c.name === 'warroom'));
  // Member posts fine; non-member probe 404s like a nonexistent id.
  const id = priv.data.conversation.id;
  assert.equal((await post('/api/messages', { conversation: id, author: 'human:forrest', body: 'hi' })).status, 200);
  assert.equal((await post('/api/messages', { conversation: id, author: N, body: 'probe' })).status, 404);

  // The AS-22 rule now lives in the store: HTTP enforces it identically.
  const bad = await post('/api/channels', {
    name: 'oops', actor: 'human:forrest', members: ['human:forrest'],
  });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /members list requires visibility 'private'/);
  const badPublic = await post('/api/channels', {
    name: 'oops', actor: 'human:forrest', visibility: 'public', members: ['human:forrest'],
  });
  assert.equal(badPublic.status, 400);
  // Nothing was created: the name is still free.
  assert.equal((await post('/api/channels', { name: 'oops', actor: 'human:forrest' })).status, 200);
});

test('api: AS-24 — POST /api/catchup marks everything read', async (t) => {
  const { get, post } = await bootServer(t);
  const ch = await post('/api/channels', { name: 'noise', actor: 'human:forrest' });
  await post('/api/messages', { conversation: ch.data.conversation.id, author: 'human:forrest', body: 'one' });
  const before = await get('/api/unread?me=agent:ceo-carla');
  assert.ok(before.data.unread.length > 0, 'precondition: something unread');

  const noMe = await post('/api/catchup', {});
  assert.equal(noMe.status, 400);
  assert.match(noMe.data.error, /Missing body field 'me'/);

  const done = await post('/api/catchup', { me: 'agent:ceo-carla' });
  assert.equal(done.status, 200);
  assert.ok(done.data.conversations >= 1, 'counts conversations swept');
  const after = await get('/api/unread?me=agent:ceo-carla');
  assert.deepEqual(after.data.unread, []);
  assert.equal((await post('/api/catchup', { me: 'agent:ghost' })).status, 404);
});

test('api: AS-24 — POST /api/sync ingests new lattice events immediately (no 10s throttle)', async (t) => {
  // Mutable copy of the fixture repo so an event can land after startup.
  const root = mkdtempSync(join(tmpdir(), 'chat-sync-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  const { get, post } = await bootServer(t, root);

  // Startup already ingested the fixture events; a re-sync posts nothing.
  const idle = await post('/api/sync');
  assert.equal(idle.status, 200);
  assert.deepEqual(idle.data, { posted: 0 });

  // New event lands on disk after startup: /api/sync posts it NOW — well
  // inside the 10s ingest throttle window that gates ordinary API traffic.
  writeFileSync(
    join(root, '.lattice', 'events', 'task_TESTSYNC.jsonl'),
    JSON.stringify({
      actor: 'agent:cto-owen', data: { from: 'planned', to: 'in_progress' },
      id: 'ev_SYNC1', schema_version: 1, task_id: 'task_TESTAAAA',
      ts: '2026-08-30T12:00:00Z', type: 'status_changed',
    }) + '\n'
  );
  const synced = await post('/api/sync');
  assert.deepEqual(synced.data, { posted: 1 });
  const convs = await get('/api/conversations?me=human:forrest');
  const events = convs.data.conversations.find((c) => c.name === 'lattice-events');
  const msgs = await get(`/api/messages?conversation=${events.id}&me=human:forrest`);
  assert.ok(msgs.data.messages.some((m) => /AS-7: planned → in_progress/.test(m.body)));
});

test('api: AS-24 — GET /api/messages honors ?limit= (CLI history --limit parity)', async (t) => {
  const { get, post } = await bootServer(t);
  const ch = await post('/api/channels', { name: 'lim', actor: 'human:forrest' });
  const convId = ch.data.conversation.id;
  for (const body of ['m1', 'm2', 'm3']) {
    await post('/api/messages', { conversation: convId, author: 'human:forrest', body });
  }
  const all = await get(`/api/messages?conversation=${convId}&me=human:forrest`);
  assert.equal(all.data.messages.length, 3);
  const last2 = await get(`/api/messages?conversation=${convId}&me=human:forrest&limit=2`);
  assert.deepEqual(last2.data.messages.map((m) => m.body), ['m2', 'm3'], 'keeps the newest, like the CLI');
});

test('api: AS-24 — GET /api/dump and /api/export are byte-faithful to the store', async (t) => {
  const { get, post, base, store } = await bootServer(t);
  await post('/api/channels', { name: 'ops', actor: 'human:forrest' });
  const convs = await get('/api/conversations?me=human:forrest');
  const ops = convs.data.conversations.find((c) => c.name === 'ops');
  await post('/api/messages', { conversation: ops.id, author: 'human:forrest', body: 'dump me | 日本語' });
  const board = convs.data.conversations.find((c) => c.name === 'board');
  await post('/api/messages', { conversation: board.id, author: 'human:forrest', body: 'private board note' });

  // /api/dump: text/plain JSONL, byte-identical to store.dumpLines(). Operator
  // endpoint: includes private-channel rows, exactly like direct DB access.
  const res = await fetch(base + '/api/dump');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  const text = await res.text();
  assert.equal(text, store.dumpLines().join('\n') + '\n');
  assert.match(text, /private board note/, 'dump bypasses visibility (documented operator surface)');

  // /api/export: exportFiles() as JSON, deep-equal to the store's own output
  // (which still excludes private channels per AS-6 — no channel-board file).
  const exp = await get('/api/export');
  assert.equal(exp.status, 200);
  assert.deepEqual(exp.data, { files: store.exportFiles() });
  assert.ok(exp.data.files.every((f) => f.filename !== 'channel-board.jsonl'));
  assert.ok(exp.data.files.some((f) => f.filename === 'channel-ops.jsonl'));
});

test('api: malformed JSON body is a 400 with a clear message', async (t) => {
  const { base } = await bootServer(t);
  const res = await fetch(base + '/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /valid JSON/);
});

test('api: AS-25 — GET /api/messages?since= returns the flat delta; hidden-channel parity holds for since=', async (t) => {
  const { get, post } = await bootServer(t);
  const ch = await post('/api/channels', { name: 'delta', actor: 'human:forrest' });
  const convId = ch.data.conversation.id;
  const m1 = await post('/api/messages', { conversation: convId, author: 'human:forrest', body: 'm1 re AS-7' });
  const m2 = await post('/api/messages', { conversation: convId, author: 'agent:cto-owen', body: 'm2' });
  const r1 = await post('/api/messages', {
    conversation: convId, author: 'human:forrest', body: 'r1', threadRoot: m1.data.message.id,
  });
  const me = 'human:forrest';

  // Delta: exactly id > since, flat (replies inline), id-ordered, annotated,
  // and NO threads key — the client merges.
  const delta = await get(`/api/messages?conversation=${convId}&me=${me}&since=${m1.data.message.id}`);
  assert.equal(delta.status, 200);
  assert.deepEqual(delta.data.messages.map((m) => m.id), [m2.data.message.id, r1.data.message.id]);
  assert.equal(delta.data.messages[1].threadRootId, m1.data.message.id, 'replies included, inline');
  assert.ok(!('threads' in delta.data), 'delta shape has no threads key');
  assert.ok(delta.data.messages.every((m) => Array.isArray(m.refs)), 'delta rows are annotated');
  assert.equal(delta.data.conversation.id, convId);

  // since = max -> empty; since=0 -> everything; without since -> unchanged
  // structured shape (threads key present).
  const empty = await get(`/api/messages?conversation=${convId}&me=${me}&since=${r1.data.message.id}`);
  assert.deepEqual(empty.data.messages, []);
  const all = await get(`/api/messages?conversation=${convId}&me=${me}&since=0`);
  assert.equal(all.data.messages.length, 3);
  const cold = await get(`/api/messages?conversation=${convId}&me=${me}`);
  assert.ok('threads' in cold.data, 'cold-load shape unchanged');

  // Bad since on a visible channel: 400 (bare Number() coercion, store rejects).
  const bad = await get(`/api/messages?conversation=${convId}&me=${me}&since=abc`);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Invalid since/);

  // Hidden channel with since=: byte-identical 404 to a nonexistent id — even
  // with a malformed since (the gate runs before validation).
  await post('/api/identities', {
    id: 'agent:developer-marcus', displayName: 'Marcus Webb (Engineer)', kind: 'agent',
  });
  const N = 'agent:developer-marcus';
  const convs = await get('/api/conversations?me=human:forrest');
  const board = convs.data.conversations.find((c) => c.name === 'board');
  const norm = (body, id) => JSON.stringify(body).replaceAll(`'${id}'`, "'<id>'");
  for (const since of ['0', 'abc']) {
    const hidden = await get(`/api/messages?conversation=${board.id}&me=${encodeURIComponent(N)}&since=${since}`);
    const missing = await get(`/api/messages?conversation=99999&me=${encodeURIComponent(N)}&since=${since}`);
    assert.equal(hidden.status, 404, 'never 400/403 for the hidden channel');
    assert.equal(missing.status, 404);
    assert.equal(norm(hidden.data, board.id), norm(missing.data, 99999));
  }
});

test('api: AS-25 — live.js is served (app.js module graph must not 404); the 5s poll is retired', async (t) => {
  const { base } = await bootServer(t);
  const mod = await fetch(base + '/live.js');
  assert.equal(mod.status, 200);
  assert.equal(mod.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await mod.text(), /applyMessage/);

  // Poll retirement (acceptance criterion 5), pinned against the served
  // app.js — the exact bits the browser runs:
  const app = await (await fetch(base + '/app.js')).text();
  assert.match(app, /new EventSource\(`\/api\/stream\?me=/, 'push transport wired');
  assert.match(app, /from '\.\/live\.js'/, 'frames/catch-up merge through live.js');
  assert.doesNotMatch(app, /,\s*5000\)/, 'no 5s interval remains');
  // AS-27 widened this guard rather than loosening it. A second interval now
  // exists — a LOCAL re-render that keeps the loop-status age text honest —
  // so counting timers no longer expresses the AS-25 property. What AS-25
  // actually pinned is "nothing refetches on a short cadence", and that is
  // now asserted directly: exactly one interval issues requests, and it is
  // the slow one; the other must touch no network at all.
  const intervals = [...app.matchAll(/setInterval\(([\s\S]*?),\s*([\d_]+)\)/g)].map((m) => ({
    body: m[1],
    ms: Number(m[2].replaceAll('_', '')),
  }));
  assert.equal(intervals.length, 2, 'exactly two intervals: the reconcile poll and the local age tick');
  const fetching = intervals.filter((i) => /refreshSidebar|\bapi\(|fetch\(/.test(i.body));
  assert.equal(fetching.length, 1, 'exactly one interval issues requests');
  assert.ok(fetching[0].ms >= 30_000, `reconcile cadence >= 30s (got ${fetching[0].ms})`);
  const local = intervals.filter((i) => !fetching.includes(i));
  assert.equal(local.length, 1, 'exactly one render-only interval');
  assert.doesNotMatch(local[0].body, /refreshSidebar|\bapi\(|fetch\(/, 'the age tick never hits the network');
  // sendMessage applies the POST response locally — no full-history refetch.
  const sendFn = app.slice(app.indexOf('async function sendMessage'), app.indexOf('function wireComposer'));
  assert.ok(sendFn.length > 0, 'sendMessage found');
  assert.doesNotMatch(sendFn, /selectConversation|\/api\/messages\?conversation/, 'send does not refetch');
  assert.match(sendFn, /applyMessage/, 'send merges its own POST response');
});

test('api: AS-18 — dm-sort.js is served (app.js module graph must not 404)', async (t) => {
  const { base } = await bootServer(t);
  const mod = await fetch(base + '/dm-sort.js');
  assert.equal(mod.status, 200);
  assert.equal(mod.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await mod.text(), /rosterOrder/);

  // The served app.js actually imports it — the whitelist entry is load-bearing.
  const app = await (await fetch(base + '/app.js')).text();
  assert.match(app, /from '\.\/dm-sort\.js'/, 'sidebar ordering goes through dm-sort.js');
});

// --- AS-26: message permalinks --------------------------------------------

test('api: AS-26 — msg-refs.js and markdown.js are served; index.html ships the file modal', async (t) => {
  const { base } = await bootServer(t);
  for (const [path, marker] of [
    ['/msg-refs.js', /tokenizeMsgRefs/],
    ['/markdown.js', /tokenizeInline/],
  ]) {
    const mod = await fetch(base + path);
    assert.equal(mod.status, 200, path);
    assert.equal(mod.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.match(await mod.text(), marker);
  }

  // The served app.js actually imports both and ships the permalink affordance.
  const app = await (await fetch(base + '/app.js')).text();
  assert.match(app, /from '\.\/msg-refs\.js'/, 'body pipeline goes through msg-refs.js');
  assert.match(app, /from '\.\/markdown\.js'/, 'inline styling goes through markdown.js');
  assert.match(app, /msg-permalink/, 'meta row carries the permalink anchor');
  assert.doesNotMatch(app, /\.innerHTML/, 'zero innerHTML use — the house rule holds');

  // The served page carries the file-viewer modal skeleton.
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /id="file-modal"/);
  for (const id of ['file-dialog', 'file-title', 'file-body', 'file-close']) {
    assert.match(html, new RegExp(`id="${id}"`), `viewer id ${id} present`);
  }
});

test('api: AS-26 — GET /api/message/<id> resolves navigation data; hidden = nonexistent byte-identically', async (t) => {
  const { get, post } = await bootServer(t);
  const convs = await get('/api/conversations?me=human:forrest');
  const eng = convs.data.conversations.find((c) => c.name === 'engineering');
  const board = convs.data.conversations.find((c) => c.name === 'board');
  const root = await post('/api/messages', {
    conversation: eng.id, author: 'human:forrest', body: 'root msg',
  });
  const reply = await post('/api/messages', {
    conversation: eng.id, author: 'agent:cto-owen', body: 'reply', threadRoot: root.data.message.id,
  });

  // Top-level: exactly the navigation shape, nothing else.
  const hit = await get(`/api/message/${root.data.message.id}?me=human:forrest`);
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.data, {
    message: {
      id: root.data.message.id,
      conversationId: eng.id,
      threadRootId: null,
      conversation: { id: eng.id, type: 'channel', name: 'engineering' },
    },
  });

  // Thread reply carries its root for t= navigation.
  const replyHit = await get(`/api/message/${reply.data.message.id}?me=human:forrest`);
  assert.equal(replyHit.data.message.threadRootId, root.data.message.id);

  // me is required, like /api/messages.
  const noMe = await get(`/api/message/${root.data.message.id}`);
  assert.equal(noMe.status, 400);
  assert.match(noMe.data.error, /Missing query parameter 'me'/);

  // Parity: a #board message and a made-up id 404 with byte-identical bodies
  // for a non-member (edge case 2 — the wording carries no id echo at all).
  await post('/api/identities', {
    id: 'agent:developer-marcus', displayName: 'Marcus Webb (Engineer)', kind: 'agent',
  });
  const N = 'agent:developer-marcus';
  const boardMsg = await post('/api/messages', {
    conversation: board.id, author: 'agent:ceo-carla', body: 'board only',
  });
  const hidden = await get(`/api/message/${boardMsg.data.message.id}?me=${encodeURIComponent(N)}`);
  const missing = await get(`/api/message/99999?me=${encodeURIComponent(N)}`);
  assert.equal(hidden.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(hidden.data, { error: 'No such message.' });
  assert.equal(JSON.stringify(hidden.data), JSON.stringify(missing.data));

  // A member still resolves the board message (and gets no content fields).
  const member = await get(`/api/message/${boardMsg.data.message.id}?me=human:forrest`);
  assert.equal(member.status, 200);
  assert.ok(!('body' in member.data.message) && !('authorId' in member.data.message));
});

// --- AS-26 §5: /api/file — gated repo markdown reads ------------------------

test('api: AS-26 — GET /api/file serves allowlisted repo markdown; every probe 404s byte-identically', async (t) => {
  // Mutable repo root: fixture copy + markdown/symlink/oversize artifacts.
  const root = mkdtempSync(join(tmpdir(), 'chat-file-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'chat-file-outside-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Hello\n\nsome **body** text\n');
  mkdirSync(join(root, '.lattice', 'plans'), { recursive: true });
  writeFileSync(join(root, '.lattice', 'plans', 'task_TEST.md'), 'plan body\n');
  writeFileSync(join(root, 'big.md'), '#'.repeat(600 * 1024)); // over the 512 KB cap
  mkdirSync(join(root, 'dir.md')); // a directory that passes the syntax gate
  writeFileSync(join(outside, 'secret.md'), 'outside the repo\n');
  symlinkSync(join(outside, 'secret.md'), join(root, 'escape.md')); // symlink escape
  // AS-34 artifacts: in-repo symlinks (absolute in-scratch targets) + control.
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'ok.md'), 'docs ok\n');
  symlinkSync(join(root, '.lattice'), join(root, 'latticelink')); // non-dot alias of a dot dir
  symlinkSync(join(root, 'docs'), join(root, 'docslink')); // dir symlink to a servable target
  symlinkSync(join(root, 'README.md'), join(root, 'alias.md')); // file symlink to a servable target
  const { get } = await bootServer(t, root);

  // Happy paths: plain repo file, nested fixture file, .lattice plan file.
  const hit = await get('/api/file?path=README.md');
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.data, { path: 'README.md', content: '# Hello\n\nsome **body** text\n' });
  assert.equal((await get('/api/file?path=personnel/README.md')).status, 200);
  const plan = await get('/api/file?path=.lattice/plans/task_TEST.md');
  assert.equal(plan.status, 200);
  assert.equal(plan.data.content, 'plan body\n');
  // AS-34 positive control: a symlink target serves under its real name, so
  // the symlink probes below 404 because of the alias alone, not the target.
  const direct = await get('/api/file?path=docs/ok.md');
  assert.equal(direct.status, 200);
  assert.equal(direct.data.content, 'docs ok\n');

  // Probe battery (edge case 12 + symlink edge case 13): all 404, all with
  // the byte-identical body of a nonexistent .md — no leaked distinctions.
  const missing = await get('/api/file?path=no-such-file.md');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.data, { error: 'No such file.' });
  const probes = [
    '../../etc/passwd', // traversal, no .md
    '../outside.md', // traversal
    'foo/../../x.md', // interior traversal
    '/etc/x.md', // absolute
    '.env', // dotfile, no .md
    '.env.md', // dot-leading segment
    'personnel/.hidden.md', // dot-leading inner segment
    'personnel/./x.md', // '.' segment
    'a//b.md', // empty segment
    'a'.repeat(600) + '.md', // over the 512-char path cap
    'personnel/README.MD', // case-sensitive suffix
    'personnel', // directory, no .md
    'dir.md', // directory that ends in .md (fails isFile)
    'escape.md', // repo-internal symlink pointing outside (realpath prefix)
    'apps/chat/data/chat.db', // non-md repo file
    encodeURIComponent('..%2f..%2fetc/passwd.md'), // double-encoded separators -> '%' fails charset
    'latticelink/plans/task_TEST.md', // AS-34: non-dot symlink laundering a dot dir (served 200 pre-fix)
    'docslink/ok.md', // AS-34: dir symlink to a servable target — symlinks are refused outright
    'alias.md', // AS-34: file symlink to a servable target — symlinks are refused outright
  ];
  for (const p of probes) {
    const res = await get(`/api/file?path=${encodeURIComponent(p)}`);
    assert.equal(res.status, 404, p);
    assert.equal(JSON.stringify(res.data), JSON.stringify(missing.data), p);
  }
  // Missing param: same byte-identical 404.
  const noParam = await get('/api/file');
  assert.equal(noParam.status, 404);
  assert.equal(JSON.stringify(noParam.data), JSON.stringify(missing.data));

  // Size cap alone is a 400 with its own wording (the gate already passed).
  const big = await get('/api/file?path=big.md');
  assert.equal(big.status, 400);
  assert.deepEqual(big.data, { error: 'File too large.' });
});

test('api: AS-54 — served app.js autolinks through markdown.js and never inside a markdown link', async (t) => {
  const { base } = await bootServer(t);

  // The file the browser actually runs, not the one on disk beside this test.
  const app = await (await fetch(base + '/app.js')).text();

  assert.match(app, /import \{[^}]*tokenizeUrls[^}]*\} from '\.\/markdown\.js'/,
    'the bare-URL pass comes from markdown.js — one scheme allowlist, one module');
  assert.ok(app.includes('appendRefLeaf(a, tok.inner, refs, { autolink: false })'),
    'the markdown-link call site opts out of autolinking verbatim');

  // Pass order (§3.3): inside appendRefLeaf the URL pass runs before the ref
  // chain, which is what makes url tokens terminal. The comparison is scoped
  // to that function body on purpose — tokenizeAsRefs is DEFINED above
  // appendRefLeaf, so a whole-file index comparison is true no matter what
  // order the calls are in.
  const start = app.indexOf('function appendRefLeaf(');
  assert.ok(start !== -1, 'appendRefLeaf is present in the served app.js');
  const leaf = app.slice(start, app.indexOf('\n}\n', start));
  const urlAt = leaf.indexOf('tokenizeUrls(');
  const asAt = leaf.indexOf('tokenizeAsRefs(');
  assert.ok(urlAt !== -1, 'appendRefLeaf calls the URL pass');
  assert.ok(asAt !== -1, 'appendRefLeaf calls the AS-ref pass');
  assert.ok(urlAt < asAt, 'the URL pass runs first among the leaf passes');

  // Terminality (§3.3): the url branch appends the anchor and `continue`s, so a
  // url token's text is never handed to the ref chain. Pass order alone does
  // not give that — dropping the `continue` leaves urlAt < asAt true while the
  // URL text falls through into three more passes. Scoped to the branch and
  // asserted as the whole branch body, so a fall-through cannot hide in it.
  const branchAt = leaf.indexOf("if (u.type === 'url') {");
  assert.ok(branchAt !== -1, 'appendRefLeaf has a url branch');
  assert.ok(branchAt < asAt, 'the url branch precedes the ref chain: moved below it, the branch keeps this exact text while every URL falls through three more passes and renders twice');
  const urlBranch = leaf.slice(branchAt, leaf.indexOf('\n    }', branchAt));
  assert.deepEqual(
    urlBranch.split('\n').slice(1).map((l) => l.trim()).filter(Boolean),
    ['parent.appendChild(urlLink(u));', 'continue;'],
    'url tokens are terminal: the branch appends the anchor and continues',
  );

  // The anchor: verbatim href, no transformation between token and attribute.
  // Scoped to urlLink's OWN body on purpose. `a.href = tok.href;` occurs three
  // times in app.js, so an unbounded /function urlLink\(tok\) \{[\s\S]*?…/ run
  // is a whole-file assertion wearing this function's name: with the assignment
  // removed it simply spans on and resolves against the markdown-link branch's
  // identical line, and the guard passes against an anchor with no href at all
  // (AS-54 review cycle 1, D1). Listing every a.href assignment in the body and
  // comparing the whole list also catches a transformed or an extra one.
  const urlLinkAt = app.indexOf('function urlLink(tok) {');
  assert.ok(urlLinkAt !== -1, 'urlLink is present in the served app.js');
  const urlLinkBody = app.slice(urlLinkAt, app.indexOf('\n}\n', urlLinkAt));
  assert.deepEqual(
    urlLinkBody.match(/a\.href\s*=[^\n]*/g) || [],
    ['a.href = tok.href;'],
    'urlLink assigns the token href unchanged, and makes no other assignment to a.href',
  );

  assert.doesNotMatch(app, /\.innerHTML/, 'zero innerHTML use — the house rule holds');
});

// --- AS-33: the org chart endpoint, the served module, and CLI/API parity ---

test('api: AS-33 — /api/org reports violations from the fixture root', async (t) => {
  const { get } = await bootServer(t);
  const res = await get('/api/org');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.data).sort(), ['employees', 'violations']);

  // Active only, name-sorted, with the reporting edge and nothing
  // viewer-relative (no me, no DM state, no Lattice work).
  assert.deepEqual(res.data.employees, [
    {
      actorId: 'agent:eng-ada',
      name: 'Ada Fixture',
      title: 'Fixture Engineer',
      class: 'ic',
      team: 'engineering',
      reportsTo: 'agent:cto-owen',
    },
    {
      actorId: 'agent:qa-bob',
      name: 'Bob Fixture',
      title: 'QA Engineer',
      class: 'ic',
      team: 'quality',
      reportsTo: 'agent:cto-owen',
    },
  ]);

  // LOAD-BEARING FIXTURE PROPERTY (plan §10.5): test/fixtures/repo has never
  // been a valid org — ada and bob both point at agent:cto-owen, who has no
  // dossier there, and two of its six files are fenced but unparseable. That
  // is precisely why it is the on-disk dirty case. Do not "fix" the fixture.
  // The whole array is asserted, not a subset: extra output is a finding too.
  assert.deepEqual(res.data.violations, [
    {
      rule: 'orphan_reports_to',
      actorId: 'agent:eng-ada',
      file: 'engineer-ada-fixture.md',
      detail: 'reports to agent:cto-owen, who has no dossier',
    },
    {
      rule: 'orphan_reports_to',
      actorId: 'agent:qa-bob',
      file: 'qa-bob-fixture.md',
      detail: 'reports to agent:cto-owen, who has no dossier',
    },
    {
      rule: 'unparsed_dossier',
      actorId: null,
      file: 'bad-actor-eve.md',
      detail: 'dossier yielded no employee (invalid_actor_id)',
    },
    {
      rule: 'unparsed_dossier',
      actorId: null,
      file: 'broken-mallory.md',
      detail: 'dossier yielded no employee (malformed_frontmatter)',
    },
  ]);
});

test('api: AS-33 — /api/org degrades to empty on a root with no personnel/', async (t) => {
  // Same contract as the roster endpoint: a missing mount or a malformed
  // dossier is an empty org and a 200, never a 500 and never a refusal to
  // boot. One bad frontmatter line must not take out chat for everyone.
  const bareRoot = mkdtempSync(join(tmpdir(), 'chat-org-bare-'));
  t.after(() => rmSync(bareRoot, { recursive: true, force: true }));
  const { get } = await bootServer(t, bareRoot);
  const res = await get('/api/org');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { employees: [], violations: [] });
});

test('api: AS-33 — /api/roster keeps its envelope while gaining the reporting edge', async (t) => {
  // §3.8: violations were NOT bolted onto /api/roster. That endpoint is
  // fetched by every client every 60s and joined against Lattice and DM state;
  // the org view is opened occasionally and needs neither join.
  const { get } = await bootServer(t);
  const res = await get('/api/roster');
  assert.deepEqual(Object.keys(res.data), ['roster']);
  assert.deepEqual(
    res.data.roster.map((r) => r.reportsTo),
    ['agent:cto-owen', 'agent:cto-owen']
  );
  assert.ok(!('violations' in res.data), 'violations live on /api/org, not here');
});
test('api: AS-33 — org-chart.js is served, imported, and holds the no-innerHTML line', async (t) => {
  const { base } = await bootServer(t);
  const mod = await fetch(base + '/org-chart.js');
  assert.equal(mod.status, 200);
  assert.equal(mod.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const org = await mod.text();
  assert.match(org, /validateOrg/);
  assert.match(org, /buildOrgTree/);

  // The served app.js actually imports it — the STATIC_FILES entry is
  // load-bearing (AS-18/AS-26 module-graph pattern).
  const app = await (await fetch(base + '/app.js')).text();
  assert.match(app, /from '\.\/org-chart\.js'/, 'the chart view goes through org-chart.js');

  // The house rule is structural, not sanitising, and its ONLY enforcement is
  // this guard. A new public/ module that no guard covers is how an absolute
  // rule quietly becomes a convention, so the line is drawn on the new file
  // too — not merely on the one that existed when the guard was written.
  assert.doesNotMatch(app, /\.innerHTML/, 'zero innerHTML use — the house rule holds');
  assert.doesNotMatch(org, /\.innerHTML/, 'zero innerHTML use in org-chart.js too');
  // org-chart.js is pure: it emits text and structure and knows nothing about
  // the DOM. app.js turns its plain objects into elements with el().
  for (const dom of [/\bdocument\b/, /\bwindow\b/, /createElement/, /createTextNode/]) {
    assert.doesNotMatch(org, dom, `org-chart.js must contain no DOM API (${dom})`);
  }
});

test('api: AS-33 — index.html ships the org chart control and modal skeleton', async (t) => {
  const { base } = await bootServer(t);
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /id="org-chart-open"/, 'the sidebar control exists');
  for (const id of ['org-modal', 'org-dialog', 'org-title', 'org-body', 'org-close']) {
    assert.match(html, new RegExp(`id="${id}"`), `org chart id ${id} present`);
  }
  // The control sits with the thing it explains: above the roster list.
  assert.ok(
    html.indexOf('id="org-chart-open"') < html.indexOf('id="roster-list"'),
    'the org chart button precedes the roster list in the sidebar'
  );
});

test('api: AS-33 — check-org --json matches GET /api/org for the same root', async (t) => {
  // The CLI is the gate and the endpoint is the view; if they can disagree,
  // one of them is lying. Parity is asserted against the dirty fixture root so
  // both the employee list and a non-empty violation array are compared.
  const { get } = await bootServer(t);
  const api = (await get('/api/org')).data;
  const bin = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'check-org.js');
  const env = { ...process.env };
  delete env.CHAT_REPO_ROOT;
  const cli = spawnSync(process.execPath, [bin, '--root', FIXTURE_ROOT, '--json'], {
    env,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 1, cli.stderr); // violations present: non-zero
  assert.deepEqual(JSON.parse(cli.stdout), api);
});

// --- AS-32: the employee title in the roster rows -------------------------

test('api: AS-32 — served app.js renders the roster title through el() and shows title alone', async (t) => {
  const { base } = await bootServer(t);

  // The file the browser actually runs, not the one on disk beside this test.
  const app = await (await fetch(base + '/app.js')).text();

  // Scoped to rosterRow's OWN body (AS-54 precedent, api.test.js:866): every
  // class literal in this file is unique to some row builder, so a whole-file
  // assertion would pass against a title rendered from any other function.
  const start = app.indexOf('function rosterRow(emp) {');
  assert.ok(start !== -1, 'rosterRow is present in the served app.js');
  const region = app.slice(start, app.indexOf('\n}\n', start));

  // The COMPLETE set, not merely the presence of the new one. Bounding alone
  // let a wrong extra line through on AS-54 (review cycle 1): with `includes`
  // a stray el('div', 'roster-team', …) is invisible. deepEqual on the whole
  // sorted set fails on a missing class AND on an extra one.
  assert.deepEqual(
    [...region.matchAll(/el\('[a-z]+',\s*'([^']+)'/g)].map((m) => m[1]).sort(),
    ['badge', 'pin-toggle', 'ref-link', 'roster-name', 'roster-row',
     'roster-status', 'roster-title', 'roster-top'],
    'rosterRow builds exactly these classes — a missing one and a stray extra one both fail',
  );

  // §3.1/§3.4: the sidebar shows the title ALONE. orgNodeItem's meta line
  // joins title · class · team; that divergence is deliberate, so it is
  // pinned here rather than left to drift into an accidental match.
  assert.equal((region.match(/emp\.class/g) || []).length, 0,
    'the sidebar row never reads emp.class — class is the org chart\'s subject, not the DM list\'s');
  assert.equal((region.match(/emp\.team/g) || []).length, 0,
    'the sidebar row never reads emp.team — same');

  // Structure-first: the title becomes an element via el(), whose third
  // argument goes to textContent. This is the ONLY defence against markup in
  // a dossier field (see the hostile-root leg below) — nothing between the
  // file and the DOM escapes it.
  assert.ok(region.includes("el('div', 'roster-title', emp.title)"),
    'the title element is built by el(), so its text goes through textContent');

  // The house rule, extended to the sinks a third rendering path could reach
  // for — not just the one that existed when the guard was written.
  for (const sink of ['.innerHTML', 'insertAdjacentHTML', 'outerHTML', 'document.write']) {
    assert.equal(app.split(sink).length - 1, 0,
      `zero ${sink} use in the served app.js — the house rule holds`);
  }

  // The server does not escape, and a test that expected it to would be
  // asserting a defence that does not exist. Proven on a scratch root: the
  // shared fixture's roster membership is asserted on by other tests.
  const hostileRoot = mkdtempSync(join(tmpdir(), 'chat-as32-hostile-'));
  t.after(() => rmSync(hostileRoot, { recursive: true, force: true }));
  cpSync(FIXTURE_ROOT, hostileRoot, { recursive: true });
  const HOSTILE = '<img src=x onerror="alert(1)">';
  writeFileSync(join(hostileRoot, 'personnel', 'hostile.md'),
    ['---',
     'actor_id: agent:hostile-hank',
     'name: Hank Hostile',
     `title: ${HOSTILE}`,
     'class: ic',
     'reports_to: agent:cto-owen',
     'team: engineering',
     'hired: 2026-09-03',
     'status: active',
     '---',
     '',
     '# Hank Hostile',
     ''].join('\n'));
  const { get: hostileGet } = await bootServer(t, hostileRoot);
  const roster = await hostileGet('/api/roster');
  assert.equal(roster.status, 200);
  const hank = roster.data.roster.find((r) => r.actorId === 'agent:hostile-hank');
  assert.ok(hank, 'the hostile dossier is an active employee on this root');
  assert.equal(hank.title, HOSTILE,
    'the endpoint ships the field verbatim — el()/textContent is the only defence, so it must be the one under test');
});

test('api: AS-32 — style.css truncates the roster title to one line', async (t) => {
  const { base } = await bootServer(t);
  const css = await (await fetch(base + '/style.css')).text();

  // Scoped to the .roster-title rule BODY. The file already carries an older
  // text-overflow (#sidebar li, L50), so a whole-file assertion passes with
  // this rule deleted outright.
  const at = css.indexOf('\n.roster-title {');
  assert.ok(at !== -1, 'style.css declares a .roster-title rule');
  const rule = css.slice(at, css.indexOf('}', at));

  // Load-bearing, not decoration: #roster-list li.roster-row sets
  // white-space: normal, so the #sidebar li ellipsis never reaches these rows
  // and a long title wraps the row taller instead of clipping.
  assert.match(css, /#roster-list li\.roster-row \{[^}]*white-space: normal/,
    'the premise of this rule: roster rows opt out of the sidebar-wide nowrap');
  for (const decl of ['white-space: nowrap', 'overflow: hidden', 'text-overflow: ellipsis']) {
    assert.ok(rule.includes(decl), `.roster-title declares ${decl}`);
  }
});

// --- AS-28: the favicon ------------------------------------------------------

test('api: AS-28 — /favicon.svg is served with the SVG content type', async (t) => {
  const { base } = await bootServer(t);
  const res = await fetch(base + '/favicon.svg');

  // The STATIC_FILES allowlist is the only route to a static file (the server
  // 404s everything else), so this is a load-bearing-entry test, not a file
  // test: drop the entry and this goes red even with the file on disk.
  assert.equal(res.status, 200);
  assert.ok(
    (res.headers.get('content-type') || '').startsWith('image/svg+xml'),
    `content-type is image/svg+xml, got ${res.headers.get('content-type')}`
  );
  const body = await res.text();
  assert.ok(body.startsWith('<svg'), 'the body is an SVG document');
  assert.ok(body.includes('viewBox="0 0 32 32"'), 'the documented 32-unit viewBox');
});

test('api: AS-28 — index.html links the favicon', async (t) => {
  const { base } = await bootServer(t);
  const page = await (await fetch(base + '/')).text();

  // Exact substring: the wiring is what is under test, not the file's
  // existence. A served favicon nothing points at is an unfindable tab.
  assert.ok(
    page.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg">'),
    'the served page carries the rel="icon" link'
  );
});

test('api: AS-28 — the favicon uses only palette hex values', async (t) => {
  const { base } = await bootServer(t);
  const svg = await (await fetch(base + '/favicon.svg')).text();

  // BRANDING.md §3.1: --color-accent-500 and --color-ink-white. Raw hex is
  // unavoidable in a standalone SVG, so the token discipline is enforced here.
  //
  // Cycle-1 F1: the first cut matched /#[0-9a-fA-F]{6}/g over the whole file,
  // which (a) counted the two hex strings in the SVG's XML *comment* toward the
  // cardinality floor — so artwork repainted `red`/`lime` passed with zero
  // palette colours, the exact vacuous shape the floor exists to prevent — and
  // (b) matched any 6-hex prefix, so `#1C41E3FF` passed. Both are closed by
  // dropping comments and comparing WHOLE paint-attribute values.
  const allowed = new Set(['#1c41e3', '#ffffff']);
  const artwork = svg.replace(/<!--[\s\S]*?-->/g, '');

  // Paint can only arrive through the attributes examined below, so the two
  // doors that would smuggle a colour past them must stay shut. If this icon
  // ever needs CSS, this guard learns to parse it in the same change.
  assert.ok(!/<style[\s>]/i.test(artwork), 'the artwork declares no <style> element');
  assert.ok(!/\sstyle\s*=/i.test(artwork), 'the artwork declares no style="" attribute');

  const paints = [...artwork.matchAll(
    /\b(fill|stroke|stop-color|flood-color|lighting-color)\s*=\s*"([^"]*)"/g
  )];

  // Cardinality before quantification: this artwork paints one path and three
  // circles, so anything under four paint attributes means the guard is looking
  // at the wrong set (or the artwork lost its colour) — red, never a pass.
  assert.ok(paints.length >= 4,
    `${paints.length} paint attributes examined, expected at least 4`);
  for (const [, attr, value] of paints) {
    // Whole value, not a substring: `#1C41E3FF`, `#F00`, `red`, `rgb(...)` are
    // all non-tokens and all fail here.
    assert.ok(
      allowed.has(value.trim().toLowerCase()),
      `${paints.length} paint attributes examined: ${attr}="${value}" is not a ` +
        'palette token (#1C41E3 --color-accent-500, #FFFFFF --color-ink-white)'
    );
  }
});

// --- AS-27: the advance-loop status endpoint --------------------------------

/** A scratch data dir standing in for apps/chat/data — the two files the host
 *  watcher and the tick lock write. Never the real one: this suite is
 *  mountless by design and must not read live company state. */
function loopFixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'chat-loopdata-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const lock = join(dataDir, 'advance.lock');
  const pid = join(dataDir, 'advance-watcher.pid');
  const deploy = join(dataDir, 'deploy-state.json');
  const loopState = join(dataDir, 'advance-loop.json'); // AS-95
  const worktrees = join(dataDir, 'worktrees.json'); // AS-99
  const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
  return {
    dataDir,
    /** Plant one of the file configurations (AS-75 adds a third file, AS-95 a
     *  fourth, AS-99 a fifth). An omitted key deletes its file, so every call
     *  states the whole world and no test inherits a neighbour's leftovers. */
    plant({ lockBody = null, pidBody = null, deployBody = null, loopBody = null, worktreesBody = null }) {
      for (const [path, body] of [[lock, lockBody], [pid, pidBody], [deploy, deployBody], [loopState, loopBody], [worktrees, worktreesBody]]) {
        if (body === null) {
          try { unlinkSync(path); } catch { /* already absent */ }
        } else {
          writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
        }
      }
    },
    freshLock: (source = 'loop', over = {}) => ({ pid: 5285, startedAt: iso(-60_000), source, ...over }),
    staleLock: (source = 'loop') => ({ pid: 5285, startedAt: iso(-(DEFAULTS.lockStaleMin * 60 * 1000) - 60_000), source }),
    livePid: () => ({ pid: 96123, startedAt: iso(-3_600_000), heartbeatAt: iso(-2_000) }),
    /** A watcher whose heartbeat stopped: killed, crashed, or the host slept. */
    stalePid: () => ({ pid: 96123, startedAt: iso(-3_600_000), heartbeatAt: iso(-10 * 60_000) }),
    legacyPid: () => ({ pid: 96123, startedAt: iso(-3_600_000) }),
    /** AS-75: what the watcher last decided, as it writes it. */
    deployState: (over = {}) => ({
      desiredId: 'aaaaaaaaaaaaaaaa', dirty: false, reason: 'current',
      dockerBin: '/usr/local/bin/docker', computedAt: iso(-5_000), lastAttempt: null, ...over,
    }),
    /** AS-95: advance-loop.json, exactly as the watcher's writeLoopState()
     *  writes it — a live loop by default. */
    loopFile: (over = {}) => ({
      active: true, startedAt: iso(-600_000), ticks: 3, armedBy: 651, lastTick: null, lastLoop: null, ...over,
    }),
    /** AS-99: worktrees.json, exactly as makeLanesOps writes it. The default is
     *  one main row plus one linked worktree whose branch carries AS-7's short
     *  code — the fixture repo's ids.json resolves it, so the lane joins by
     *  branch name (the fixture's task files carry no branch_links). */
    worktreesFile: (over = {}) => ({
      schema: 1,
      source: 'watcher:git',
      generatedAt: iso(-8_000),
      master: { head: 'f6717b8' },
      error: null,
      worktrees: [
        { relPath: '.', main: true, head: 'f6717b8', branch: 'master', detached: false, ahead: null, behind: null,
          dirtyCount: null, dirtyLattice: null, merged: null, lastCommit: null, errors: [] },
        { relPath: '.worktrees/AS-7', main: false, head: '3c1a000', branch: 'feat/AS-7-thing', detached: false,
          ahead: 4, behind: 2, dirtyCount: 3, dirtyLattice: false, merged: false,
          lastCommit: { sha: '3c1a000', authorName: 'eng-ada', authorEmail: 'eng-ada@agents.american-software.local',
            committedAt: iso(-600_000), subject: 'AS-7: a commit' },
          errors: [] },
      ],
      ...over,
    }),
  };
}

test('api: AS-27 — GET /api/loop-status reports each of the four states from its own file configuration', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir });

  // Cardinality first: four configurations planted, four answers asserted.
  const cases = [
    ['loop', { lockBody: fx.freshLock('loop'), pidBody: fx.livePid() }],
    ['tick', { lockBody: fx.freshLock('watcher'), pidBody: fx.livePid() }],
    ['idle', { lockBody: null, pidBody: fx.livePid() }],
    ['off', { lockBody: null, pidBody: null }],
  ];
  assert.equal(cases.length, 4);
  const seen = [];
  for (const [expected, files] of cases) {
    fx.plant(files);
    const res = await get('/api/loop-status');
    assert.equal(res.status, 200, expected);
    assert.deepEqual(Object.keys(res.data), ['status'], expected);
    const st = res.data.status;
    assert.equal(st.state, expected, `${expected}: state`);
    assert.ok(st.checkedAt, `${expected}: checkedAt present`);
    assert.ok(Number.isFinite(Date.parse(st.checkedAt)), `${expected}: checkedAt is a real timestamp`);
    seen.push(st.state);
  }
  // The four really are distinguishable — a single-valued indicator would
  // pass every per-case assertion above if they all agreed.
  assert.deepEqual(seen, ['loop', 'tick', 'idle', 'off']);
  assert.equal(new Set(seen).size, 4);

  // No 'me': the answer is identical for every viewer, and asking as an
  // unknown identity changes nothing (there is no identity gate to fail).
  fx.plant({ lockBody: fx.freshLock('manual'), pidBody: fx.livePid() });
  const anon = await get('/api/loop-status');
  const ghost = await get('/api/loop-status?me=agent:ghost');
  assert.equal(anon.status, 200);
  assert.equal(ghost.status, 200);
  assert.equal(anon.data.status.state, 'tick');
  assert.equal(ghost.data.status.state, 'tick');
  assert.equal(anon.data.status.tick.source, 'manual');
});

test('api: AS-95 — a watcher loop is observable over /api/loop-status, with its tick count and its stop reason', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir });

  // Cardinality first: five configurations planted, five answers asserted —
  // the four AS-27 states plus the one AS-95 adds.
  const cases = [
    ['watcher-loop', { lockBody: fx.freshLock('watcher', { loop: { ticks: 3 } }), pidBody: fx.livePid(), loopBody: fx.loopFile() }],
    // The mirror file alone, lock unmarked: still a loop.
    ['watcher-loop', { lockBody: fx.freshLock('watcher'), pidBody: fx.livePid(), loopBody: fx.loopFile({ ticks: 5 }) }],
    // Same lock, no loop anywhere: the plain AS-27 tick. This is the pair that
    // proves the endpoint is reading the loop file at all.
    ['tick', { lockBody: fx.freshLock('watcher'), pidBody: fx.livePid(), loopBody: null }],
    // A /loop session's own lock is untouched by AS-95.
    ['loop', { lockBody: fx.freshLock('loop'), pidBody: fx.livePid(), loopBody: fx.loopFile() }],
    // Between two loop ticks the lock is released; the loop is still live, and
    // since the cycle-1 F5 fix the endpoint says so instead of reporting idle.
    ['watcher-loop', { lockBody: null, pidBody: fx.livePid(), loopBody: fx.loopFile() }],
    // The same file with no live watcher behind it is NOT a loop: an
    // `active: true` mirror outlives the watcher that was killed mid-loop.
    ['off', { lockBody: null, pidBody: fx.stalePid(), loopBody: fx.loopFile() }],
  ];
  assert.equal(cases.length, 6);
  const seen = [];
  for (const [expected, files] of cases) {
    fx.plant(files);
    const res = await get('/api/loop-status');
    assert.equal(res.status, 200, expected);
    assert.equal(res.data.status.state, expected, `${expected}: state`);
    seen.push(res.data.status.state);
  }
  assert.deepEqual(seen, ['watcher-loop', 'watcher-loop', 'tick', 'loop', 'watcher-loop', 'off']);

  // The tick count the sidebar renders reaches the client from both witnesses.
  fx.plant({ lockBody: fx.freshLock('watcher', { loop: { ticks: 4 } }), pidBody: fx.livePid(), loopBody: fx.loopFile({ ticks: 3 }) });
  const live = (await get('/api/loop-status')).data.status;
  assert.equal(live.tick.loopTicks, 4, 'the running tick says which loop tick it is');
  assert.equal(live.loop.ticks, 3, 'and the mirror file reports the last EVALUATED tick');
  assert.equal(live.loop.active, true);

  // Why the last loop stopped survives the loop. This is the whole point of
  // the file for the board: "dry" and "cap-hit" are very different news.
  fx.plant({
    lockBody: null, pidBody: fx.livePid(),
    loopBody: fx.loopFile({ active: false, ticks: 0, lastLoop: { stoppedAt: new Date(Date.now() - 60_000).toISOString(), reason: 'no-progress', ticks: 2, detail: { headBefore: 'abc' } } }),
  });
  const after = (await get('/api/loop-status')).data.status;
  assert.equal(after.state, 'idle', 'a stopped loop is idle again — `active: false` is what ends it');
  assert.equal(after.loop.active, false);
  assert.equal(after.loop.lastLoop.reason, 'no-progress');
  assert.equal(after.loop.lastLoop.ticks, 2);
  assert.equal(Object.hasOwn(after.loop.lastLoop, 'detail'), false, 'the derivation ships named fields, not the file');

  // A garbage loop file is a 200 and a null loop, never a 500 — the same
  // degradation contract as the other three files in this directory.
  for (const bad of ['not json{', '', '[]', 'null']) {
    fx.plant({ lockBody: fx.freshLock('watcher'), pidBody: fx.livePid(), loopBody: bad });
    const r = await get('/api/loop-status');
    assert.equal(r.status, 200, `loop file ${JSON.stringify(bad)}`);
    assert.equal(r.data.status.state, 'tick', `loop file ${JSON.stringify(bad)}: no invented loop`);
    assert.equal(r.data.status.loop, null, `loop file ${JSON.stringify(bad)}: null, not a throw`);
  }
});

test('api: AS-27 — the AS-16 nonce never leaves the server, and malformed files never 500', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir });

  const NONCE = 'deadbeefcafef00d';
  fx.plant({ lockBody: fx.freshLock('watcher', { nonce: NONCE }), pidBody: fx.livePid() });
  const live = await get('/api/loop-status');
  assert.equal(live.data.status.state, 'tick');
  const body = JSON.stringify(live.data);
  assert.equal(body.includes(NONCE), false, 'nonce value never served');
  assert.equal(body.includes('nonce'), false, 'nor the key');

  // C7: unparsable JSON in either file is a reason string and a 200, never a
  // 500 and never a crashed server. Four malformed configurations.
  const malformed = [
    ['both files garbage', { lockBody: 'not json{', pidBody: '<<<' }],
    ['lock garbage, watcher live', { lockBody: '{', pidBody: fx.livePid() }],
    ['lock stale, watcher garbage', { lockBody: fx.staleLock(), pidBody: 'nope' }],
    ['empty files', { lockBody: '', pidBody: '' }],
  ];
  for (const [name, files] of malformed) {
    fx.plant(files);
    const r = await get('/api/loop-status');
    assert.equal(r.status, 200, name);
    assert.equal(r.data.status.tick, null, `${name}: never reports a tick`);
    assert.ok(['idle', 'off'].includes(r.data.status.state), `${name}: state ${r.data.status.state}`);
  }

  // And the server is still alive and correct afterwards.
  fx.plant({ lockBody: fx.freshLock('loop'), pidBody: fx.livePid() });
  assert.equal((await get('/api/loop-status')).data.status.state, 'loop');
});

test('api: AS-27 — a pre-AS-27 watcher pid file (no heartbeatAt) reads as off, honestly', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir });

  // This is the production state on the day AS-27 ships: pid 96123 has been
  // running since before the heartbeat existed. The indicator must not claim
  // a listening watcher it has no evidence for; restarting the watcher on the
  // new code is what corrects it.
  fx.plant({ lockBody: null, pidBody: fx.legacyPid() });
  const legacy = await get('/api/loop-status');
  assert.equal(legacy.data.status.state, 'off');
  assert.equal(legacy.data.status.watcher.listening, false);
  assert.equal(legacy.data.status.watcher.reason, 'no-heartbeat');

  // Same file, one heartbeat added: self-corrects with no server restart.
  fx.plant({ lockBody: null, pidBody: fx.livePid() });
  const beating = await get('/api/loop-status');
  assert.equal(beating.data.status.state, 'idle');
  assert.equal(beating.data.status.watcher.listening, true);
});

test('api: AS-27 — loop-status.js is served and imported; the production poll cadence is 2s', async (t) => {
  const { base } = await bootServer(t);
  const mod = await fetch(base + '/loop-status.js');
  assert.equal(mod.status, 200);
  assert.equal(mod.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const src = await mod.text();
  assert.match(src, /describeLoopStatus/);
  assert.doesNotMatch(src, /\.innerHTML|insertAdjacentHTML|outerHTML|document\.write/,
    'the label module builds strings, never markup');

  // The served app.js actually imports it and ships the indicator wiring —
  // the STATIC_FILES entry is load-bearing, not decoration.
  const app = await (await fetch(base + '/app.js')).text();
  assert.match(app, /from '\.\/loop-status\.js'/, 'the label logic comes from the pure module');
  assert.match(app, /addEventListener\('loop'/, 'push frames are applied');
  assert.match(app, /\/api\/loop-status/, 'and the fetch path exists for reconnects/degradation');

  // The knob the suite uses to observe ten polls quickly must not have moved
  // the shipping cadence.
  assert.equal(LOOP_POLL_MS, 2_000);
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /loopPollMs = LOOP_POLL_MS/, 'the default is the exported constant');

  // The served page carries the indicator skeleton (AC-10).
  const html = await (await fetch(base + '/')).text();
  for (const marker of ['id="loop-status"', 'id="loop-label"', 'role="status"', 'class="loop-dot"']) {
    assert.ok(html.includes(marker), `index.html ships ${marker}`);
  }
});

// --- AS-75: the build endpoint and the merged-vs-deployed indicator ----------

test('api: AS-75 — GET /api/build reports the baked id, and "unknown"/absent as not-an-id', async (t) => {
  // Cardinality first: three images' worth of build stamps.
  const cases = [
    ['a real id', 'a1b2c3d4e5f60718', 'a1b2c3d4e5f60718', 'a1b2c3d4e5f60718'],
    ['a hand build', 'unknown', null, 'unknown'],
    ['a pre-AS-75 image', null, null, null],
  ];
  assert.equal(cases.length, 3, 'three build stamps examined');
  for (const [name, baked, expectedId, expectedRaw] of cases) {
    const { get } = await bootServer(t, FIXTURE_ROOT, { buildId: baked });
    const res = await get('/api/build');
    assert.equal(res.status, 200, name);
    assert.deepEqual(Object.keys(res.data), ['build'], name);
    assert.equal(res.data.build.id, expectedId, `${name}: id`);
    assert.equal(res.data.build.raw, expectedRaw, `${name}: raw keeps the distinction visible`);
    assert.ok(Number.isFinite(Date.parse(res.data.build.startedAt)), `${name}: startedAt is a real timestamp`);
  }

  // No 'me' gate, exactly like /api/loop-status: the answer is the same for
  // everyone and there is no identity to fail.
  const { get } = await bootServer(t, FIXTURE_ROOT, { buildId: 'a1b2c3d4e5f60718' });
  const anon = await get('/api/build');
  const ghost = await get('/api/build?me=agent:ghost');
  assert.deepEqual(anon.data, ghost.data);
});

test('api: AS-75 — /api/loop-status carries build, and current is null (never false) whenever we cannot know', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir, buildId: 'aaaaaaaaaaaaaaaa' });

  // Cardinality first: six configurations, five of which must answer null.
  const cases = [
    ['no deploy-state.json', { pidBody: fx.livePid(), deployBody: null }, null, 'no-state'],
    ['unparsable deploy-state.json', { pidBody: fx.livePid(), deployBody: 'not json{' }, null, 'unreadable-state'],
    ['empty deploy-state.json', { pidBody: fx.livePid(), deployBody: '' }, null, 'unreadable-state'],
    ['watcher not listening', { pidBody: null, deployBody: fx.deployState() }, null, 'no-watcher'],
    ['deploy report gone stale', { pidBody: fx.livePid(), deployBody: fx.deployState({ computedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString() }) }, null, 'stale-state'],
    ['everything present and matching', { pidBody: fx.livePid(), deployBody: fx.deployState() }, true, 'current'],
  ];
  assert.equal(cases.length, 6, 'six configurations examined');
  const seen = [];
  for (const [name, files, expectedCurrent, expectedReason] of cases) {
    fx.plant(files);
    const res = await get('/api/loop-status');
    assert.equal(res.status, 200, name);
    const b = res.data.status.build;
    assert.ok(b, `${name}: the build key is present`);
    assert.equal(b.current, expectedCurrent, `${name}: current`);
    assert.equal(b.reason, expectedReason, `${name}: reason`);
    assert.equal(b.id, 'aaaaaaaaaaaaaaaa', `${name}: the running id is first-hand and always known here`);
    seen.push(b.current);
  }
  // Five nulls and one true — if `false` had leaked into any of the five, the
  // sidebar would have told the board it is behind on the strength of a dead
  // reporter. That is the whole point of the tri-state.
  assert.equal(seen.filter((c) => c === null).length, 5);
  assert.equal(seen.filter((c) => c === false).length, 0);

  // A genuinely behind build — the ONE case that may report false.
  fx.plant({ pidBody: fx.livePid(), deployBody: fx.deployState({ desiredId: 'bbbbbbbbbbbbbbbb', reason: 'stale-build' }) });
  const behind = (await get('/api/loop-status')).data.status.build;
  assert.equal(behind.current, false);
  assert.equal(behind.desiredId, 'bbbbbbbbbbbbbbbb');
  assert.equal(behind.reason, 'stale-build');

  // And an image with no baked id cannot claim currency, even against a fresh
  // report that happens to agree with nothing.
  const unstamped = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir, buildId: 'unknown' });
  const u = (await unstamped.get('/api/loop-status')).data.status.build;
  assert.equal(u.id, null);
  assert.equal(u.current, null);
  assert.equal(u.reason, 'unknown-build');
});

test('api: AS-75 — a malformed deploy-state.json never throws and never changes state', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir, buildId: 'aaaaaaaaaaaaaaaa' });

  // Same degradation contract as the AS-27 files: four malformed bodies, four
  // 200s, and the four loop states must be exactly what they would have been
  // with no deploy-state.json at all.
  const malformed = ['not json{', '', '[]', '{"desiredId": 42, "computedAt": "yesterday"}'];
  assert.equal(malformed.length, 4, 'four malformed bodies examined');
  for (const body of malformed) {
    fx.plant({ lockBody: fx.freshLock('watcher'), pidBody: fx.livePid(), deployBody: body });
    const r = await get('/api/loop-status');
    assert.equal(r.status, 200, body);
    assert.equal(r.data.status.state, 'tick', `${body}: the loop state is untouched by the deploy report`);
    assert.equal(r.data.status.build.current, null, `${body}: never a claim we cannot support`);
  }

  // Still alive and correct afterwards.
  fx.plant({ lockBody: null, pidBody: fx.livePid(), deployBody: fx.deployState() });
  const ok = await get('/api/loop-status');
  assert.equal(ok.data.status.state, 'idle');
  assert.equal(ok.data.status.build.current, true);
});

test('api: AS-75 — composeBuild is pure and tri-state at the unit level', () => {
  const now = Date.parse('2026-09-04T12:00:00.000Z');
  const state = (over = {}) => ({
    desiredId: 'aaaaaaaaaaaaaaaa', dirty: false, reason: 'current',
    computedAt: new Date(now - 5_000).toISOString(), ...over,
  });
  const call = (over = {}) =>
    composeBuild({ buildId: 'aaaaaaaaaaaaaaaa', deployState: state(), watcherListening: true, nowMs: now, ...over });

  assert.equal(call().current, true);
  assert.equal(call({ deployState: state({ desiredId: 'bbbbbbbbbbbbbbbb' }) }).current, false);
  assert.equal(call({ deployState: null }).reason, 'no-state');
  assert.equal(call({ deployState: { error: 'unparsable' } }).reason, 'unreadable-state');
  assert.equal(call({ watcherListening: false }).reason, 'no-watcher');
  assert.equal(call({ buildId: null }).reason, 'unknown-build');
  assert.equal(call({ deployState: state({ computedAt: null }) }).reason, 'stale-state');
  assert.equal(call({ deployState: state({ desiredId: null, reason: 'no-git' }) }).current, null);
  assert.equal(call({ deployState: state({ desiredId: null, reason: 'no-git' }) }).reason, 'no-git');

  // Purity: the same arguments give the same answer, and nothing about the
  // inputs is mutated.
  const frozen = Object.freeze(state());
  assert.deepEqual(call({ deployState: frozen }), call({ deployState: frozen }));
});

test('api: AS-93 — /api/config exposes exactly the dashboard override; dashboard-link.js is served, imported, and pure', async (t) => {
  const { base, get } = await bootServer(t);

  const cfg = await get('/api/config');
  assert.equal(cfg.status, 200);
  // Deliberately brittle: this is THE guard against /api/config growing into
  // an env dump. A new client-visible setting is a deliberate edit here.
  assert.deepEqual(Object.keys(cfg.data), ['config']);
  assert.deepEqual(Object.keys(cfg.data.config), ['latticeDashboardUrl']);
  assert.equal(cfg.data.config.latticeDashboardUrl, null, 'unset -> null, never ""');

  // The server half of AC-5: an explicitly set override reaches the browser.
  // (The client half — that the browser then USES it for the href — is
  // dashboard-link.test.js T4; there is no DOM in this suite.)
  const saved = process.env.LATTICE_DASHBOARD_URL;
  try {
    process.env.LATTICE_DASHBOARD_URL = 'http://127.0.0.1:9999';
    const boot = await bootServer(t);
    const withEnv = await boot.get('/api/config');
    assert.equal(withEnv.data.config.latticeDashboardUrl, 'http://127.0.0.1:9999');
  } finally {
    if (saved === undefined) delete process.env.LATTICE_DASHBOARD_URL;
    else process.env.LATTICE_DASHBOARD_URL = saved;
  }

  // AC-8: the STATIC_FILES entry is load-bearing, not bookkeeping. app.js
  // imports this as an ES module — an unregistered file 404s, the module graph
  // dies, and the app is a blank page that no other test would notice.
  const mod = await fetch(base + '/dashboard-link.js');
  assert.equal(mod.status, 200);
  assert.equal(mod.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const src = await mod.text();
  assert.match(src, /dashboardTaskHref/);

  const app = await (await fetch(base + '/app.js')).text();
  assert.match(app, /from '\.\/dashboard-link\.js'/, 'the import edge is real');

  // Purity, mirroring the AS-33 rule: the helper is a pure function of a
  // location-shaped object, which is what makes its unit tests behavioural.
  for (const dom of [/\.innerHTML/, /\bwindow\b/, /\bdocument\b/, /createElement/]) {
    assert.doesNotMatch(src, dom, `dashboard-link.js must contain no DOM API (${dom})`);
  }
});

test('api: AS-93 — all four dashboard link sites go through the helper (4 examined, 4 covered)', async (t) => {
  const { base } = await bootServer(t);
  const app = await (await fetch(base + '/app.js')).text();

  // AC-4. There is no DOM in this suite and app.js exports nothing, so this
  // source-text guard is what stands between a bypassed site and a green
  // suite. Named per site so a failure says WHICH one was bypassed.
  const sites = [
    ['message refs (asRefLink)', /a\.href = dashHref\(ref\.taskId\)/],
    ['roster row (rosterRow)', /a\.href = dashHref\(emp\.work\.taskId\)/],
    ['task panel (showTaskPanel)', /open\.href = dashHref\(task\.taskId\)/],
    // AS-99 added the fourth site; the count below is the deliberate edit the
    // guard asks for, not a relaxation of it.
    ['lane card (laneCard)', /a\.href = dashHref\(c\.taskId\)/],
  ];
  assert.equal(sites.length, 4, '4 dashboard link sites examined');
  for (const [name, re] of sites) {
    assert.match(app, re, `4 sites examined, 4 must be covered: ${name} goes through dashHref()`);
  }
  assert.equal(
    (app.match(/dashHref\(/g) || []).length,
    5,
    '4 call sites + 1 definition — a fifth call site is a deliberate edit here'
  );
  // msgRefLink's `?m=` template-literal href and the AS-26 file refs do not
  // match this and must stay green: the ban is on server-baked .url bases.
  assert.doesNotMatch(
    app,
    /\.href = [A-Za-z_$][\w.$]*\.url\b/,
    'no href is assigned from a server-baked .url (AS-93)'
  );

  // AC-9, host-literal ban: the backstop for a FOURTH link site added later.
  // The directory is enumerated rather than listed — a hard-coded list is how
  // the next new module escapes the ban.
  const publicDir = new URL('../public/', import.meta.url);
  const files = readdirSync(publicDir).filter((f) => f !== 'dashboard-link.js');
  assert.ok(files.length >= 10, `${files.length} public/ files examined (dashboard-link.js excluded)`);
  for (const file of files) {
    const body = readFileSync(new URL(file, publicDir), 'utf8');
    for (const literal of ['8799', '8443', '127.0.0.1']) {
      assert.ok(
        !body.includes(literal),
        `${files.length} public/ files examined: ${file} must not hard-code ${literal} — ` +
          'dashboard-link.js is the only place a dashboard host or port may appear'
      );
    }
  }
});

// --- AS-99: the lanes projection endpoint -----------------------------------

test('api: AS-99 — GET /api/lanes joins the watcher snapshot to the live board', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir });
  fx.plant({ worktreesBody: fx.worktreesFile() });

  const res = await get('/api/lanes');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.data), ['lanes'], 'one key, same envelope shape as /api/loop-status');
  const p = res.data.lanes;
  // AS-100 adds exactly one top-level sibling of `snapshot` (the event
  // stream's own reason block); the LANE CARD's key set is untouched, which is
  // what api-lanes-key-whitelist below pins.
  assert.deepEqual(Object.keys(p), ['checkedAt', 'snapshot', 'count', 'lanes', 'events']);
  assert.deepEqual(Object.keys(p.snapshot), ['generatedAt', 'ageS', 'stale', 'reason', 'error']);
  assert.equal(p.snapshot.reason, 'ok');
  assert.equal(p.snapshot.stale, false);

  // Cardinality: 1 non-main worktree row + the fixture board's mid-lifecycle
  // tasks that no worktree joined (AS-21 planned, AS-22 in_progress, AS-23
  // planned; AS-7 is the joined one, AS-8/AS-25 backlog, AS-24 done, AS-26
  // cancelled).
  assert.equal(p.count, 4, `4 lanes expected, got ${p.count}: ${p.lanes.map((l) => l.key).join(',')}`);
  // key is the short id when the lane joined a task, the path when it did not.
  assert.deepEqual(p.lanes.map((l) => l.key), ['AS-7', 'AS-21', 'AS-22', 'AS-23']);

  const [lane] = p.lanes;
  assert.equal(lane.joinedBy, 'branch-name');
  assert.equal(lane.task.shortId, 'AS-7');
  assert.equal(lane.task.status, 'in_progress', 'the Lattice half is read live, never snapshot-aged');
  assert.equal(lane.worktree.ahead, 4);
  assert.equal(lane.employee.lastCommitAuthor, 'eng-ada');
  assert.equal(lane.stale.flag, false);
  for (const taskOnly of p.lanes.slice(1)) {
    assert.equal(taskOnly.joinedBy, 'task-only');
    assert.equal(taskOnly.worktree, null, 'a lane with no branch cut yet has no worktree object');
  }
});

test('api: AS-99 — api-lanes-stale-boundary: age comes from generatedAt, never the file mtime', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir });
  const lanes = async () => (await get('/api/lanes')).data.lanes;

  // Both files below are written NOW, so their mtime is fresh by construction:
  // a reader that stat()ed the file instead of reading generatedAt would call
  // the second one current.
  fx.plant({ worktreesBody: fx.worktreesFile({ generatedAt: new Date(Date.now() - (LANES_STALE_MS - 1_000)).toISOString() }) });
  const fresh = await lanes();
  assert.equal(fresh.snapshot.stale, false, `${LANES_STALE_MS - 1_000}ms old must not be stale`);
  assert.equal(fresh.snapshot.reason, 'ok');

  fx.plant({ worktreesBody: fx.worktreesFile({ generatedAt: new Date(Date.now() - (LANES_STALE_MS + 1_000)).toISOString() }) });
  const stale = await lanes();
  assert.equal(stale.snapshot.stale, true, `${LANES_STALE_MS + 1_000}ms old must be stale`);
  assert.equal(stale.snapshot.reason, 'stale-snapshot');
  assert.ok(stale.count >= 1, 'a stale snapshot still renders its lanes, with the caption');
  assert.ok(stale.snapshot.ageS >= 60);
});

test('api: AS-99 — every degraded feed is a named reason, never a short list', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir });
  const lanes = async () => (await get('/api/lanes')).data.lanes;

  fx.plant({});
  const absent = await lanes();
  assert.equal(absent.snapshot.reason, 'no-snapshot');
  assert.equal(absent.lanes, null, 'the board sees "unavailable", not a Lattice-only half-list');
  assert.equal(absent.count, null);

  fx.plant({ worktreesBody: 'not json at all' });
  const garbage = await lanes();
  assert.equal(garbage.snapshot.reason, 'unreadable-snapshot');
  assert.equal(garbage.lanes, null);

  fx.plant({ worktreesBody: fx.worktreesFile({ error: 'worktree-list-failed: exit 128', worktrees: [] }) });
  const gitDown = await lanes();
  assert.equal(gitDown.snapshot.reason, 'git-error');
  assert.equal(gitDown.snapshot.error, 'worktree-list-failed: exit 128');
  assert.deepEqual(gitDown.lanes, []);
});

test('api: AS-99 — api-lanes-git-error-badge: a refused git enumeration reaches the board as a dash, not a zero', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir });
  // End to end on the real payload: the server's own bytes, through the module
  // that decides the words. The unit test proves the words; this proves the
  // server actually produces the shape those words are decided from (F1).
  fx.plant({ worktreesBody: fx.worktreesFile({ error: 'worktree-list-failed: exit 128', worktrees: [] }) });
  const p = (await get('/api/lanes')).data.lanes;
  assert.equal(p.snapshot.reason, 'git-error');

  const view = describeLanes(p, Date.now());
  assert.equal(view.badge, 'Lanes · –', 'the sidebar badge does not report a count git never gave us');
  assert.match(view.caption, /^Lane data unavailable — /);
  assert.notEqual(view.emptyText, EMPTY_STATES.ok, 'and the pane does not say nothing is in flight');

  // The pane's empty state is keyed off the reason, not off the badge string:
  // that string comparison is exactly how the two states collapsed into one.
  const here = dirname(fileURLToPath(import.meta.url));
  const app = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /view\.emptyText/, 'renderLanes takes its empty-state sentence from the label module');
  assert.doesNotMatch(app, /view\.badge ===/, 'and never re-derives it by comparing the rendered badge');
});

test('api: AS-99 — api-lanes-key-whitelist: the payload carries no field the contract does not name', async (t) => {
  const fx = loopFixture(t);
  const { get } = await bootServer(t, FIXTURE_ROOT, { dataDir: fx.dataDir });
  // A snapshot that grew two fields on the host, one of them an absolute path.
  const body = fx.worktreesFile();
  body.worktrees[1].absPath = '/Users/someone/Code/american-software-company/.worktrees/AS-7';
  body.worktrees[1].secretFutureField = 'nope';
  fx.plant({ worktreesBody: body });

  const p = (await get('/api/lanes')).data.lanes;
  const lane = p.lanes[0];
  assert.deepEqual(Object.keys(lane), ['key', 'task', 'joinedBy', 'worktree', 'employee', 'stale', 'stageStartedAt', 'subAgent']);
  assert.deepEqual(Object.keys(lane.worktree), [...LANE_WORKTREE_KEYS]);
  assert.deepEqual(Object.keys(lane.employee), ['assignee', 'lastCommitAuthor', 'agree']);
  const raw = JSON.stringify(p);
  assert.ok(!raw.includes('secretFutureField'), 'a grown snapshot field does not reach a browser');
  assert.ok(!raw.includes('/Users/'), 'and neither does an absolute host path');
});

test('api: AS-99 — /lanes.js is served, and the client edges are real', async (t) => {
  const { base } = await bootServer(t);
  const res = await fetch(base + '/lanes.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /export function describeLanes/);

  const here = dirname(fileURLToPath(import.meta.url));
  const index = readFileSync(join(here, '..', 'public', 'index.html'), 'utf8');
  for (const id of ['lanes-open', 'lanes-badge', 'lanes-modal']) {
    assert.match(index, new RegExp(`id="${id}"`), `index.html carries #${id}`);
  }
  const app = readFileSync(join(here, '..', 'public', 'app.js'), 'utf8');
  assert.match(app, /from '\.\/lanes\.js'/, 'app.js imports the label module rather than restating its words');
  assert.match(app, /\/api\/lanes/, 'app.js fetches the projection');
  assert.match(app, /addEventListener\('lanes'/, "app.js listens for the 'lanes' frame");
});

test('api: AS-99 — LANES_POLL_MS is the pinned production cadence', async () => {
  assert.equal(LANES_POLL_MS, 5_000);
  const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /lanesPollMs = LANES_POLL_MS/, 'the default is the exported constant');
  assert.equal(LANES_STALE_MS, 60_000, 'four watcher polls');
});
