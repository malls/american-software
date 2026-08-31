// AS-25: SSE push-delivery integration tests. Real server on an ephemeral
// port, temp DB, streams consumed via raw fetch + body reader (an
// EventSource-equivalent SSE parser — node ships no EventSource client we'd
// want to depend on, and the raw frames are the actual contract).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatServer } from '../server.js';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

async function bootServer(t, repoRoot = FIXTURE_ROOT) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-stream-'));
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
  return { base, get, post, store, close };
}

/**
 * Minimal SSE consumer over fetch: parses `event:`/`data:` frames, skips
 * comment lines (:connected, :hb). nextFrame() resolves with the next parsed
 * frame or rejects on timeout — assertions are made from frame content and
 * ORDER alone, never from sleeps.
 */
async function openStream(base, me) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream?me=${encodeURIComponent(me)}`, {
    signal: ctrl.signal,
  });
  const frames = [];
  const waiters = [];
  let ended = false;
  const onEnd = [];
  if (res.ok && res.body) {
    (async () => {
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message';
            let data = '';
            for (const line of raw.split('\n')) {
              if (line.startsWith(':')) continue; // comment (heartbeat/hello)
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            const frame = { event, data: JSON.parse(data) };
            const w = waiters.shift();
            if (w) w.resolve(frame);
            else frames.push(frame);
          }
        }
      } catch {
        // aborted / server-destroyed — both are legitimate stream ends here
      }
      ended = true;
      for (const cb of onEnd) cb();
    })();
  }
  return {
    status: res.status,
    headers: res.headers,
    pending: () => frames.length,
    nextFrame: (ms = 5000) =>
      new Promise((resolveP, rejectP) => {
        if (frames.length > 0) return resolveP(frames.shift());
        const timer = setTimeout(
          () => rejectP(new Error(`no frame within ${ms}ms`)),
          ms
        );
        waiters.push({
          resolve: (f) => {
            clearTimeout(timer);
            resolveP(f);
          },
        });
      }),
    waitEnd: (ms = 5000) =>
      new Promise((resolveP, rejectP) => {
        if (ended) return resolveP();
        const timer = setTimeout(() => rejectP(new Error(`stream not ended within ${ms}ms`)), ms);
        onEnd.push(() => {
          clearTimeout(timer);
          resolveP();
        });
      }),
    close: () => ctrl.abort(),
  };
}

test('stream: AS-25 — two connected clients both receive a posted message as a push frame (no GET issued)', async (t) => {
  const { base, get, post } = await bootServer(t);
  const convs = await get('/api/conversations?me=human:forrest');
  const eng = convs.data.conversations.find((c) => c.name === 'engineering');

  const a = await openStream(base, 'human:forrest');
  const b = await openStream(base, 'agent:ceo-carla');
  t.after(() => {
    a.close();
    b.close();
  });
  assert.equal(a.status, 200);
  assert.match(a.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(a.headers.get('cache-control'), 'no-store');

  const posted = await post('/api/messages', {
    conversation: eng.id,
    author: 'agent:cto-owen',
    body: 'pushed, not polled — see AS-7',
  });
  assert.equal(posted.status, 200);

  // Both frames asserted from stream content alone — no /api/messages GET.
  for (const stream of [a, b]) {
    const frame = await stream.nextFrame();
    assert.equal(frame.event, 'message');
    assert.equal(frame.data.id, posted.data.message.id);
    assert.equal(frame.data.conversationId, eng.id);
    assert.equal(frame.data.authorId, 'agent:cto-owen');
    assert.equal(frame.data.body, 'pushed, not polled — see AS-7');
    assert.equal(frame.data.threadRootId, null);
    // Annotated like REST: refs resolved against the fixture .lattice.
    assert.deepEqual(frame.data.refs.map((r) => [r.shortId, r.exists]), [['AS-7', true]]);
  }
});

test('stream: AS-25 — hidden-channel parity: a non-member receives zero #board bytes (proved by ordering)', async (t) => {
  const { base, get, post } = await bootServer(t);
  await post('/api/identities', {
    id: 'agent:developer-marcus',
    displayName: 'Marcus Webb (Engineer)',
    kind: 'agent',
  });
  const N = 'agent:developer-marcus';
  const convs = await get('/api/conversations?me=human:forrest');
  const board = convs.data.conversations.find((c) => c.name === 'board');
  const eng = convs.data.conversations.find((c) => c.name === 'engineering');

  const member = await openStream(base, 'human:forrest');
  const nonMember = await openStream(base, N);
  t.after(() => {
    member.close();
    nonMember.close();
  });

  // Post to #board, THEN to a public channel. SSE frames are delivered in
  // write order on each connection, so if any board frame had been written
  // to the non-member, it would arrive BEFORE the public frame. It doesn't:
  // the non-member's next frame is the public message — deterministic proof,
  // no sleeps.
  const secret = await post('/api/messages', {
    conversation: board.id,
    author: 'agent:ceo-carla',
    body: 'board-only: acquisition talks',
  });
  assert.equal(secret.status, 200);
  const open = await post('/api/messages', {
    conversation: eng.id,
    author: 'agent:ceo-carla',
    body: 'public follow-up',
  });
  assert.equal(open.status, 200);

  const m1 = await member.nextFrame();
  assert.equal(m1.data.id, secret.data.message.id, 'member gets the board frame');
  assert.equal(m1.data.conversationId, board.id);
  const m2 = await member.nextFrame();
  assert.equal(m2.data.id, open.data.message.id);

  const n1 = await nonMember.nextFrame();
  assert.equal(n1.data.id, open.data.message.id, "non-member's FIRST frame is the public message");
  assert.equal(n1.data.conversationId, eng.id);
  assert.equal(nonMember.pending(), 0, 'and nothing else was buffered');
});

test('stream: AS-25 — endpoint gating: unknown me is a 404 JSON envelope (no stream), missing me a 400', async (t) => {
  const { base } = await bootServer(t);

  const ghost = await fetch(`${base}/api/stream?me=agent:ghost`);
  assert.equal(ghost.status, 404);
  assert.match(ghost.headers.get('content-type'), /^application\/json/);
  assert.match((await ghost.json()).error, /Unknown identity 'agent:ghost'/);

  const noMe = await fetch(`${base}/api/stream`);
  assert.equal(noMe.status, 400);
  assert.match(noMe.headers.get('content-type'), /^application\/json/);
  assert.match((await noMe.json()).error, /Missing query parameter 'me'/);
});

test('stream: AS-25 — lattice ingestion pushes too (single event source covers ingestEvent)', async (t) => {
  // Mutable fixture copy so a new event can land after startup (api.test.js
  // AS-24 sync pattern).
  const root = mkdtempSync(join(tmpdir(), 'chat-stream-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  const { base, get, post } = await bootServer(t, root);

  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  writeFileSync(
    join(root, '.lattice', 'events', 'task_TESTSTREAM.jsonl'),
    JSON.stringify({
      actor: 'agent:cto-owen',
      data: { from: 'planned', to: 'in_progress' },
      id: 'ev_STREAM1',
      schema_version: 1,
      task_id: 'task_TESTAAAA',
      ts: '2026-08-30T12:00:00Z',
      type: 'status_changed',
    }) + '\n'
  );
  await post('/api/sync');

  const frame = await stream.nextFrame();
  assert.equal(frame.event, 'message');
  assert.equal(frame.data.authorId, 'system:lattice');
  assert.match(frame.data.body, /AS-7: planned → in_progress/);
  const convs = await get('/api/conversations?me=human:forrest');
  const events = convs.data.conversations.find((c) => c.name === 'lattice-events');
  assert.equal(frame.data.conversationId, events.id);
});

test('stream: AS-25 — close() reaps live streams and the heartbeat; shutdown never wedges', async (t) => {
  // Deliberately NOT bootServer: this test owns the close() call and asserts
  // it completes with streams still open client-side.
  const dir = mkdtempSync(join(tmpdir(), 'chat-stream-close-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;

  const a = await openStream(base, 'human:forrest');
  const b = await openStream(base, 'agent:cto-owen');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);

  // Neither client aborts. close() must still resolve promptly (streams
  // ended server-side, heartbeat cleared) — a wedged shutdown times out here.
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('close() wedged with open streams')), 5000)
  );
  await Promise.race([close(), timeout]);

  // Both client-side readers observe end-of-stream.
  await a.waitEnd();
  await b.waitEnd();
  a.close();
  b.close();
});
