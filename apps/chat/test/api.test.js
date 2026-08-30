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

async function bootServer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-api-'));
  const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT });
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
