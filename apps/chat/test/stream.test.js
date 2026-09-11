// AS-25: SSE push-delivery integration tests. Real server on an ephemeral
// port, temp DB, streams consumed via raw fetch + body reader (an
// EventSource-equivalent SSE parser — node ships no EventSource client we'd
// want to depend on, and the raw frames are the actual contract).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, cpSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync, truncateSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatServer } from '../server.js';
import { makeEvent, serialiseEvent } from '../lib/events.js';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

async function bootServer(t, repoRoot = FIXTURE_ROOT, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-stream-'));
  // AS-27: a scratch (non-existent) data dir by default, so loop status is a
  // constant 'off' and no test in this file can be perturbed by — or perturb —
  // the real apps/chat/data. The mountless invariant, extended to the two new
  // files.
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
  return { base, get, post, store, close };
}

/**
 * Minimal SSE consumer over fetch: parses `event:`/`data:` frames, skips
 * comment lines (:connected, :hb). nextFrame() resolves with the next parsed
 * frame or rejects on timeout — assertions are made from frame content and
 * ORDER alone, never from sleeps.
 *
 * AS-27: every successful connection now opens with exactly one `loop` frame
 * (the server sends loop status on connect so a reconnecting client is current
 * without a fetch). This helper consumes it and exposes it as `initialLoop`,
 * so nextFrame() still means "the next MESSAGE frame" for the AS-25 ordering
 * proofs below — and so the on-connect contract is asserted by every stream
 * test in the file rather than by one of them.
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
  const api = {
    status: res.status,
    headers: res.headers,
    initialLoop: null,
    initialLanes: null, // AS-99: the second on-connect frame, consumed below
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
  if (res.ok && res.body) {
    const first = await api.nextFrame();
    if (first.event !== 'loop') {
      throw new Error(`expected a loop frame on connect, got ${first.event}`);
    }
    api.initialLoop = first;
    // AS-99: the server sends one `lanes` frame immediately after the `loop`
    // frame, so a reconnecting client renders the pane without a fetch. This
    // helper consumes it for the same reason it consumes the loop frame: every
    // ordering assertion below counts frames from the first CHANGE, and an
    // unconsumed on-connect frame would shift all of them by one.
    const second = await api.nextFrame();
    if (second.event !== 'lanes') {
      throw new Error(`expected a lanes frame after the loop frame on connect, got ${second.event}`);
    }
    api.initialLanes = second;
  }
  return api;
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

// --- AS-27: loop-status push -------------------------------------------------
// LOOP_POLL_MS is 2s in production; these tests inject a fast cadence so that
// "ten polls" is ten real poll cycles measured in milliseconds rather than a
// twenty-second sleep. The property under test is the FRAME COUNT, which the
// cadence does not affect. The production default is pinned in api.test.js.
const FAST_POLL_MS = 25;

function loopDataDir(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'chat-loopdata-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

/** Resolve after n poll cycles have certainly elapsed (plus slack). Used only
 *  to bound a "nothing happened" assertion — every positive assertion below
 *  waits on a frame, never on a clock. */
const afterPolls = (n) => new Promise((ok) => setTimeout(ok, n * FAST_POLL_MS + 200));

test('stream: AS-27 — a new lock pushes exactly one loop frame; an unchanged lock pushes none over ten polls', async (t) => {
  const dataDir = loopDataDir(t);
  const { base } = await bootServer(t, FIXTURE_ROOT, { dataDir, loopPollMs: FAST_POLL_MS });
  const lockPath = join(dataDir, 'advance.lock');

  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  // AC-6: the connection is current before any file changes at all. openStream
  // consumed it on connect (and would have thrown had it not been a loop
  // frame, or had it not arrived).
  const hello = stream.initialLoop;
  assert.equal(hello.event, 'loop', 'the FIRST frame on a new connection is loop status');
  assert.equal(hello.data.state, 'off', 'empty data dir: nothing running, nothing watching');

  // A tick starts.
  writeFileSync(lockPath, JSON.stringify({
    pid: 5285, startedAt: new Date().toISOString(), source: 'loop', nonce: 'deadbeefcafef00d',
  }));
  const started = await stream.nextFrame();
  assert.equal(started.event, 'loop');
  assert.equal(started.data.state, 'loop');
  assert.equal(started.data.tick.source, 'loop');
  assert.equal(JSON.stringify(started.data).includes('deadbeefcafef00d'), false,
    'the AS-16 nonce is not pushed to clients either');

  // Ten further polls with the file untouched: the payload's ageS moves every
  // poll, so a naive whole-payload comparison would emit ten frames here.
  await afterPolls(10);
  assert.equal(stream.pending(), 0, 'zero further frames while the lock is unchanged');

  // The tick ends.
  unlinkSync(lockPath);
  const ended = await stream.nextFrame();
  assert.equal(ended.event, 'loop');
  assert.equal(ended.data.state, 'off');
  assert.equal(ended.data.tick, null);
  assert.equal(ended.data.lastTick.source, 'loop');
  assert.ok(ended.data.lastTick.endedAt, 'the between-ticks memory records when the lock vanished');

  // And nothing further once it has settled.
  await afterPolls(10);
  assert.equal(stream.pending(), 0, 'zero frames after the state settles');
});

test('stream: AS-27 — loop frames reach every viewer identically (no visibility gate)', async (t) => {
  const dataDir = loopDataDir(t);
  const { base } = await bootServer(t, FIXTURE_ROOT, { dataDir, loopPollMs: FAST_POLL_MS });

  const a = await openStream(base, 'human:forrest');
  const b = await openStream(base, 'agent:ceo-carla');
  t.after(() => {
    a.close();
    b.close();
  });
  // Each connection got its own initial frame on connect.
  for (const stream of [a, b]) assert.equal(stream.initialLoop.event, 'loop');

  writeFileSync(join(dataDir, 'advance-watcher.pid'), JSON.stringify({
    pid: 96123, startedAt: new Date(Date.now() - 3_600_000).toISOString(), heartbeatAt: new Date().toISOString(),
  }));

  const frames = [];
  for (const stream of [a, b]) {
    const f = await stream.nextFrame();
    assert.equal(f.event, 'loop');
    assert.equal(f.data.state, 'idle');
    frames.push(JSON.stringify({ ...f.data, checkedAt: null }));
  }
  assert.equal(frames[0], frames[1], 'byte-identical for both viewers — nothing here is viewer-relative');
});

test('stream: AS-27 — close() clears the loop poll timer as well as the heartbeat', async (t) => {
  // Same shape as the AS-25 close/reap test: this one owns its close() call.
  const dir = mkdtempSync(join(tmpdir(), 'chat-stream-loopclose-'));
  const dataDir = loopDataDir(t);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { server, close } = createChatServer({
    dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir, loopPollMs: FAST_POLL_MS,
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;

  const stream = await openStream(base, 'human:forrest');
  assert.equal(stream.initialLoop.event, 'loop');

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('close() wedged')), 5000)
  );
  await Promise.race([close(), timeout]);
  await stream.waitEnd();

  // The real proof that the timer is gone is that the suite process can exit;
  // a leaked interval on a closed server would keep writing to reaped
  // connections. Assert it does not throw and the stream stays ended.
  writeFileSync(join(dataDir, 'advance.lock'), JSON.stringify({
    pid: 1, startedAt: new Date().toISOString(), source: 'manual',
  }));
  await afterPolls(4);
  assert.equal(stream.pending(), 0, 'a closed server pushes nothing');
  stream.close();
});

// --- AS-99: lanes frames ----------------------------------------------------

const laneSnapshot = (generatedAt, over = {}) => JSON.stringify({
  schema: 1,
  source: 'watcher:git',
  generatedAt,
  master: { head: 'f6717b8' },
  error: null,
  worktrees: [
    { relPath: '.', main: true, head: 'f6717b8', branch: 'master', detached: false, ahead: null, behind: null,
      dirtyCount: null, dirtyLattice: null, merged: null, lastCommit: null, errors: [] },
  ],
  ...over,
});

test('stream-lanes-change-only: a rewritten snapshot pushes exactly one lanes frame; an untouched one pushes none over ten polls', async (t) => {
  const dataDir = loopDataDir(t);
  const { base } = await bootServer(t, FIXTURE_ROOT, {
    dataDir, loopPollMs: FAST_POLL_MS, lanesPollMs: FAST_POLL_MS,
  });
  const snapPath = join(dataDir, 'worktrees.json');

  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  // AC-12, first half: exactly one lanes frame on connect, AFTER the loop
  // frame. openStream consumed both and would have thrown on either the wrong
  // event name or the wrong order.
  assert.equal(stream.initialLoop.event, 'loop');
  assert.equal(stream.initialLanes.event, 'lanes', 'the SECOND frame on a new connection is the lane projection');
  assert.equal(stream.initialLanes.data.lanes.snapshot.reason, 'no-snapshot',
    'an empty data dir says so out loud rather than drawing an empty lane list as fact');
  assert.equal(stream.initialLanes.data.lanes.lanes, null);

  // The watcher writes its first snapshot.
  writeFileSync(snapPath, laneSnapshot(new Date().toISOString()));
  const first = await stream.nextFrame();
  assert.equal(first.event, 'lanes');
  assert.equal(first.data.lanes.snapshot.reason, 'ok');
  assert.equal(first.data.lanes.snapshot.stale, false);

  // Ten polls with the file untouched. `ageS` and `checkedAt` move on every one
  // of them, so a whole-payload comparison would emit ten frames here.
  await afterPolls(10);
  assert.equal(stream.pending(), 0, 'zero frames while the snapshot is unchanged');

  // The watcher's next poll: same git facts, new generatedAt. That IS a change
  // worth a frame — it is the only evidence the client has that the feed is
  // still alive, and it is what keeps the age caption honest.
  writeFileSync(snapPath, laneSnapshot(new Date(Date.now() + 1_000).toISOString()));
  const second = await stream.nextFrame();
  assert.equal(second.event, 'lanes');
  assert.notEqual(second.data.lanes.snapshot.generatedAt, first.data.lanes.snapshot.generatedAt);
  await afterPolls(10);
  assert.equal(stream.pending(), 0, 'and exactly one frame for that write, not one per poll');

  // The watcher stops and its file is removed: the pane must learn that the
  // list it is holding is no longer an answer.
  unlinkSync(snapPath);
  const gone = await stream.nextFrame();
  assert.equal(gone.event, 'lanes');
  assert.equal(gone.data.lanes.snapshot.reason, 'no-snapshot');
  assert.equal(gone.data.lanes.lanes, null);
});

// --- AS-100: company frames ---------------------------------------------------
// Same cadence trick as AS-27/AS-99 above: EVENTS_POLL_MS is 2s in production
// (pinned in api.test.js) and injected small here, because the property under
// test is the frame COUNT, not the wall clock.

/** Events land where the server tails them: <dataDir>/events/company.jsonl.
 *  Built through makeEvent for the same reason api.test.js's fixture is — a
 *  test must not be able to plant a line the producer could not emit. */
function eventsFile(dataDir) {
  const dir = join(dataDir, 'events');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'company.jsonl');
}

let eventSeq = 0;
// serialiseEvent returns the JSON with no trailing newline — the producer adds
// it on append. The tail only ever reads up to the LAST newline (a partial line
// is held as bytes until it completes), so a fixture that forgot the '\n' would
// plant an event no reader can see. api.test.js's eventLines() adds it for the
// same reason.
const eventLine = (type, data, over = {}) =>
  `${serialiseEvent(makeEvent({
    type,
    actor: over.actor ?? 'agent:developer-lena',
    taskId: over.taskId ?? null,
    data,
    now: new Date(Date.now() - 60_000 + (eventSeq++) * 1_000),
  })).trimEnd()}\n`;

const stageStarted = (task, over = {}) => eventLine('stage_started', {
  task, stage: 'implement', actor: 'agent:developer-lena',
  worktree: `.worktrees/${task}`, branch: `feat/${task}-thing`, cycle: 1, ...over,
});

/** Drain every frame that arrives inside `ms`. Used where the assertion is a
 *  COUNT over a window (including a count of zero) rather than "the next
 *  frame" — nextFrame alone cannot prove nothing else followed. */
async function drain(stream, ms = FAST_POLL_MS * 10 + 300) {
  // Wait the window out FIRST, then take what buffered. Deliberately not a
  // loop of nextFrame(): a nextFrame that times out leaves its waiter in the
  // queue, and the next frame to arrive is handed to that dead waiter and
  // lost — so a drain built that way silently eats the first frame of the
  // next window.
  await new Promise((ok) => setTimeout(ok, ms));
  const out = [];
  while (stream.pending()) out.push(await stream.nextFrame(1_000));
  return out;
}

test('stream-company-change-only: each appended event pushes exactly one company frame, in file order; an untouched file pushes none', async (t) => {
  const dataDir = loopDataDir(t);
  const path = eventsFile(dataDir);
  writeFileSync(path, '');
  // The lanes poll is parked at a minute so this test counts `company` frames
  // and nothing else: appending an event DOES move the lane projection, and
  // that interleaving is AC-17's subject, not this one's.
  const { base } = await bootServer(t, FIXTURE_ROOT, {
    dataDir, loopPollMs: FAST_POLL_MS, lanesPollMs: 60_000, eventsPollMs: FAST_POLL_MS,
  });

  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  // One append → exactly one frame carrying that id.
  const first = stageStarted('AS-7');
  appendFileSync(path, first);
  const frame = await stream.nextFrame();
  assert.equal(frame.event, 'company');
  assert.equal(frame.data.id, JSON.parse(first).id);
  assert.equal(frame.data.type, 'stage_started');
  assert.equal(frame.data.data.task, 'AS-7');

  // Ten polls with the file untouched. The tail re-stats the file on every one
  // of them; a poll that re-emitted what it already read would show up here.
  assert.deepEqual(await drain(stream), [], 'zero further frames while the file is unchanged');

  // Two lines in ONE write → two frames, in file order (not (ts, id) order:
  // the frames report arrivals, and a reordering would disagree with the file
  // every other consumer reads).
  const second = eventLine('subagent_spawned', {
    task: 'AS-7', stage: 'implement', actor: 'agent:developer-lena', model: 'fable',
  });
  const third = stageStarted('AS-8', { actor: 'agent:qa-priya' });
  appendFileSync(path, second + third);
  const pair = await drain(stream, FAST_POLL_MS * 6 + 300);
  assert.deepEqual(pair.map((f) => f.event), ['company', 'company']);
  assert.deepEqual(
    pair.map((f) => f.data.id),
    [JSON.parse(second).id, JSON.parse(third).id],
    'file order, one frame per line'
  );
});

test('stream-company-truncation: a truncated stream is reported as a fact and the server stays up', async (t) => {
  const dataDir = loopDataDir(t);
  const path = eventsFile(dataDir);
  writeFileSync(path, '');
  const { base, get } = await bootServer(t, FIXTURE_ROOT, {
    dataDir, loopPollMs: FAST_POLL_MS, lanesPollMs: FAST_POLL_MS, eventsPollMs: FAST_POLL_MS,
  });

  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  appendFileSync(path, stageStarted('AS-7'));
  appendFileSync(path, eventLine('subagent_spawned', {
    task: 'AS-7', stage: 'implement', actor: 'agent:developer-lena', model: 'fable',
  }));
  const before = (await drain(stream, FAST_POLL_MS * 8 + 300)).filter((f) => f.event === 'company');
  assert.equal(before.length, 2, 'two events, two frames');

  // Someone rotates the file out from under the tail: the offset is now past
  // the end. The contract is that this is a FACT the pane can show, never a
  // crash and never a silent restart at zero.
  truncateSync(path, 0);
  const fresh = stageStarted('AS-9');
  appendFileSync(path, fresh);
  const after = (await drain(stream, FAST_POLL_MS * 8 + 300)).filter((f) => f.event === 'company');
  assert.equal(after.length, 1, 'exactly one frame for the one line written after the truncate');
  assert.equal(after[0].data.id, JSON.parse(fresh).id);

  // The loss is visible where the pane reads it: the lanes projection's
  // `events` block, which is the tail's own view. /api/events deliberately
  // does NOT carry it — that endpoint re-reads the file, and the file it reads
  // is intact; truncation is a fact about this process's cursor.
  const lanes = await get('/api/lanes');
  assert.equal(lanes.status, 200);
  assert.equal(lanes.data.lanes.events.reason, 'truncated');
  const events = await get('/api/events');
  assert.equal(events.status, 200, 'the server is still up and still answering');
  assert.equal(events.data.events.length, 1, 'and the file now holds exactly the post-truncate line');

  // The next append clears it: one poll cannot both report the loss and
  // pretend it is over, but the poll after it can.
  appendFileSync(path, eventLine('stage_ended', {
    task: 'AS-9', stage: 'implement', actor: 'agent:developer-lena', outcome: 'completed',
    reason: null, closedBy: 'orchestrator', startedId: null, durationS: 30,
  }));
  await drain(stream, FAST_POLL_MS * 6 + 300);
  const healed = await get('/api/lanes');
  assert.equal(healed.data.lanes.events.reason, 'ok', 'the next append clears the reason');
});

test('stream: AS-99 — lanes frames reach every viewer identically (no visibility gate)', async (t) => {
  const dataDir = loopDataDir(t);
  const { base } = await bootServer(t, FIXTURE_ROOT, {
    dataDir, loopPollMs: FAST_POLL_MS, lanesPollMs: FAST_POLL_MS,
  });
  const a = await openStream(base, 'human:forrest');
  const b = await openStream(base, 'agent:ceo-carla');
  t.after(() => {
    a.close();
    b.close();
  });
  // `checkedAt` is the server clock at compose time and differs by a
  // millisecond between two connections; everything a viewer READS must not.
  const seen = (frame) => {
    const { checkedAt, ...rest } = frame.data.lanes;
    return rest;
  };
  assert.deepEqual(seen(a.initialLanes), seen(b.initialLanes), 'the board and an employee see the same lanes');

  writeFileSync(join(dataDir, 'worktrees.json'), laneSnapshot(new Date().toISOString(), { worktrees: [] }));
  const fa = await a.nextFrame();
  const fb = await b.nextFrame();
  assert.equal(fa.event, 'lanes');
  assert.equal(fb.event, 'lanes');
  assert.deepEqual(seen(fa), seen(fb));
  assert.equal(fa.data.lanes.snapshot.reason, 'ok');
});
