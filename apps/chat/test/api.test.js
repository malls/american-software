// Integration tests: real server on an ephemeral port, temp DB, driven by fetch.
// repoRoot points at the fixture .lattice/ so lattice behavior is deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createChatServer } from '../server.js';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

async function bootServer(t, repoRoot = FIXTURE_ROOT) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-api-'));
  const { server, store, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot });
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
  const intervals = [...app.matchAll(/setInterval\([\s\S]*?,\s*([\d_]+)\)/g)].map((m) =>
    Number(m[1].replaceAll('_', ''))
  );
  assert.equal(intervals.length, 1, 'exactly one reconcile interval');
  assert.ok(intervals[0] >= 30_000, `reconcile cadence >= 30s (got ${intervals[0]})`);
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
