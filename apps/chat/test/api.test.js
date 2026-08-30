// Integration tests: real server on an ephemeral port, temp DB, driven by fetch.
// repoRoot points at the fixture .lattice/ so lattice behavior is deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatServer } from '../server.js';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

async function bootServer(t, repoRoot = FIXTURE_ROOT) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-api-'));
  const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot });
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
  return { base, get, post };
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

test('api: AS-8 — roster joins personnel, lattice work status, and DM state', async (t) => {
  const { get, post } = await bootServer(t);

  // 'me' is required (dmConversationId/unread are viewer-relative).
  const noMe = await get('/api/roster');
  assert.equal(noMe.status, 400);
  assert.match(noMe.data.error, /Missing query parameter 'me'/);

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
