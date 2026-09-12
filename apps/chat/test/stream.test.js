// AS-25: SSE push-delivery integration tests. Real server on an ephemeral
// port, temp DB, streams consumed via raw fetch + body reader (an
// EventSource-equivalent SSE parser — node ships no EventSource client we'd
// want to depend on, and the raw frames are the actual contract).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, cpSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync, truncateSync,
  renameSync, readFileSync, statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatServer } from '../server.js';
import { makeEvent, serialiseEvent } from '../lib/events.js';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

// AS-81: the one bound every frame wait in this file runs under. It is only
// ever REACHED on a red path — the on-connect frames are written synchronously
// in the handler turn that flushes the headers — so it costs a green run
// nothing, and a tighter value would only buy seconds on an already-failing
// file while risking a spurious red on a loaded host running ~32 test files in
// parallel.
const FRAME_MS = 5000;
const CONNECT_MS = FRAME_MS;

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
 *
 * AS-81: because the contract is asserted HERE, a stream regression makes this
 * helper throw before it has returned the `api` whose close() aborts the fetch
 * — so every caller used to leak a live connection on the red path, and a
 * caller that owned its server wedged the runner outright. It now aborts its
 * own controller before rethrowing, and the messages name the contract so the
 * red reads as a defect report rather than a harness error.
 */
async function openStream(base, me, { connectMs = CONNECT_MS } = {}) {
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
    nextFrame: (ms = FRAME_MS) =>
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
    waitEnd: (ms = FRAME_MS) =>
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
    try {
      let first;
      try {
        first = await api.nextFrame(connectMs);
      } catch (e) {
        throw new Error(`AS-27 on-connect contract: no loop frame within ${connectMs}ms`, { cause: e });
      }
      if (first.event !== 'loop') {
        throw new Error(`AS-27/AS-99 on-connect contract: expected loop then lanes, got ${first.event}`);
      }
      api.initialLoop = first;
      // AS-99: the server sends one `lanes` frame immediately after the `loop`
      // frame, so a reconnecting client renders the pane without a fetch. This
      // helper consumes it for the same reason it consumes the loop frame: every
      // ordering assertion below counts frames from the first CHANGE, and an
      // unconsumed on-connect frame would shift all of them by one.
      let second;
      try {
        second = await api.nextFrame(connectMs);
      } catch (e) {
        throw new Error(`AS-99 on-connect contract: no lanes frame within ${connectMs}ms`, { cause: e });
      }
      if (second.event !== 'lanes') {
        throw new Error(`AS-27/AS-99 on-connect contract: expected loop then lanes, got ${second.event}`);
      }
      api.initialLanes = second;
    } catch (e) {
      // AS-81: the contract is broken and no caller holds `api`, so nothing
      // else can ever abort this fetch. Hang up here — otherwise the socket
      // (and, for a caller that owns its server, the server's ref'd heartbeat
      // interval) outlives the failed test and the runner never exits.
      ctrl.abort();
      throw e;
    }
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
  // AS-81: the inline close() below is this test's subject and stays. This hook
  // only fires on the path where the test never reaches it — a throw anywhere
  // above would otherwise leave a listening server and its ref'd heartbeat
  // interval alive, and the whole file's runner would never exit. close() is
  // not idempotent (it calls store.close() unconditionally), so it must not run
  // twice.
  let closedByTest = false;
  t.after(async () => { if (!closedByTest) await close(); });

  const a = await openStream(base, 'human:forrest');
  const b = await openStream(base, 'agent:cto-owen');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);

  // Neither client aborts. close() must still resolve promptly (streams
  // ended server-side, heartbeat cleared) — a wedged shutdown times out here.
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('close() wedged with open streams')), 5000)
  );
  closedByTest = true;
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

// --- AS-85: the AS-75 build fields inside the AS-27 frame-count guard --------
// The ten-poll window above boots against an EMPTY data dir, so `build` is the
// constant `{id:null, desiredId:null, current:null, checkedAt:null,
// reason:'no-state'}` for its whole run: no build field can move the key there,
// and the window is green by construction rather than by the guard working
// (AS-75 review, finding F1). These two tests plant a real deploy-state.json —
// the watcher's own shape, written the way the watcher writes it — and drive it.
// A: churn every field the watcher rewrites per deploy-poll, require zero
// frames. B: move one KEY field at a time, require exactly one frame each.
const BUILD_ID = 'aaaaaaaaaaaaaaaa';

/** deploy-state.json as the host watcher writes it. Mirrors
 *  api.test.js's `loopFixture().deployState()` by hand: test files in this
 *  suite do not import each other. */
const deployState = (over = {}) => ({
  desiredId: BUILD_ID,
  dirty: false,
  reason: 'current',
  desiredReason: 'ok',
  dockerBin: '/usr/local/bin/docker',
  dockerReason: 'candidate',
  computedAt: new Date().toISOString(),
  lastAttempt: null,
  runningId: BUILD_ID,
  ...over,
});

const livePid = () => ({
  pid: 96123,
  startedAt: new Date(Date.now() - 3_600_000).toISOString(),
  heartbeatAt: new Date().toISOString(),
});

/**
 * A data dir carrying a live watcher and a current build, both planted BEFORE
 * the server boots so its primed key already reflects them (and the on-connect
 * frame can be asserted against them). Returns the rewriter the tests use
 * between polls.
 *
 * The rewrite is `.tmp` + rename because that is precisely how the watcher
 * writes this file (`watch/advance-watcher.mjs`). A plain writeFileSync read
 * mid-write parses as garbage, which `composeBuild` reports as
 * `reason: 'unreadable-state'` — a real key change, and a frame this test would
 * blame on the guard. Mirroring the producer removes that race.
 *
 * WATCHER_STALE_MS is 60 s, so one pid write covers a test measured in seconds.
 */
function buildDataDir(t) {
  const dataDir = loopDataDir(t);
  writeFileSync(join(dataDir, 'advance-watcher.pid'), JSON.stringify(livePid()));
  const path = join(dataDir, 'deploy-state.json');
  const writeDeployState = (over = {}) => {
    const body = deployState(over);
    writeFileSync(`${path}.tmp`, JSON.stringify(body));
    renameSync(`${path}.tmp`, path);
    return body;
  };
  writeDeployState();
  return { dataDir, writeDeployState };
}

/** Both AS-85 tests boot identically: fast loop poll, and the AS-99 lanes poll
 *  and AS-100 events poll pushed out past the end of the test so nothing but a
 *  `loop` frame can ever land in `pending()` during a zero-frame window. */
const buildBootOpts = (dataDir) => ({
  dataDir, loopPollMs: FAST_POLL_MS, lanesPollMs: 60_000, eventsPollMs: 60_000, buildId: BUILD_ID,
});

test('stream: AS-85 — deploy-state churn (computedAt, lastAttempt, runningId) pushes no loop frame over ten polls; a real build change pushes exactly one', async (t) => {
  const { dataDir, writeDeployState } = buildDataDir(t);
  const { base, get } = await bootServer(t, FIXTURE_ROOT, buildBootOpts(dataDir));

  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  // Cardinality before count: the fixture is OBSERVED on the wire before any
  // zero-frame assertion is made. Against an empty data dir both of these read
  // null, which is exactly the vacuity this test exists to close.
  const hello = stream.initialLoop;
  assert.equal(hello.event, 'loop');
  assert.equal(hello.data.build.current, true, 'the planted deploy-state makes this container current');
  assert.equal(hello.data.build.desiredId, BUILD_ID);
  const firstCheckedAt = hello.data.build.checkedAt;
  assert.ok(firstCheckedAt, 'the on-connect frame carries the planted computedAt');

  // Ten polls of exactly the churn a host watcher produces: a fresh
  // `computedAt` every deploy-poll, a rotating `lastAttempt`, a re-resolved
  // docker binary, a re-read `runningId`. Nothing the key names moves.
  let lastWritten = null;
  for (let i = 0; i < 10; i++) {
    lastWritten = writeDeployState({
      computedAt: new Date(Date.now() + i + 1).toISOString(),
      lastAttempt: i % 2 === 0
        ? { id: BUILD_ID, at: new Date().toISOString(), outcome: 'ok', detail: `serving ${i}` }
        : null,
      dockerReason: i % 2 === 0 ? 'candidate' : 'override',
      runningId: i % 2 === 0 ? BUILD_ID : BUILD_ID.toUpperCase(),
    });
    await afterPolls(1);
  }
  await afterPolls(2);
  assert.equal(stream.pending(), 0, 'zero frames across ten polls of deploy-state churn');

  // The test's own "assert the mutation applied": prove the churn REACHED the
  // server. Without this, a rewrite that silently failed would pass step 3 for
  // the same reason the AS-27 window passes today — no build field moving.
  const status = await get('/api/loop-status');
  assert.equal(status.status, 200);
  assert.equal(status.data.status.build.checkedAt, lastWritten.computedAt,
    'the server is reading the churned file, not a cached copy');
  assert.notEqual(status.data.status.build.checkedAt, firstCheckedAt,
    'and checkedAt really moved across the ten polls');

  // Sanity positive: a zero-frame assertion with no live push after it is
  // indistinguishable from a dead socket.
  writeDeployState({ desiredId: 'bbbbbbbbbbbbbbbb', reason: 'stale-build' });
  const changed = await stream.nextFrame();
  assert.equal(changed.event, 'loop');
  assert.equal(changed.data.build.current, false);
  assert.equal(changed.data.build.desiredId, 'bbbbbbbbbbbbbbbb');

  await afterPolls(10);
  assert.equal(stream.pending(), 0, 'and exactly one frame — the new state settles to zero too');
});

test('stream: AS-85 — each build field earns exactly one loop frame when it alone changes: desiredId, current, reason', async (t) => {
  const { dataDir, writeDeployState } = buildDataDir(t);
  const { base } = await bootServer(t, FIXTURE_ROOT, buildBootOpts(dataDir));

  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  const hello = stream.initialLoop;
  assert.equal(hello.event, 'loop');
  assert.equal(hello.data.build.current, true, 'the planted deploy-state makes this container current');
  assert.equal(hello.data.build.desiredId, BUILD_ID);

  /** One step: write, take the single frame it must earn, then prove it earned
   *  exactly one by watching ten further polls go by in silence. */
  const step = async (over, label) => {
    writeDeployState(over);
    // Name the step in the rejection: the bare `nextFrame` timeout carries only
    // a timer stack, so a red would otherwise not say WHICH field stopped
    // earning a frame — the one fact a reader of this failure needs.
    const frame = await stream.nextFrame().catch((e) => {
      throw new Error(`${label}: expected exactly one loop frame, got none`, { cause: e });
    });
    assert.equal(frame.event, 'loop', `${label}: pushed a loop frame`);
    await afterPolls(10);
    assert.equal(stream.pending(), 0, `${label}: exactly one frame, not a stream of them`);
    return frame;
  };

  // B1 — master moved past this container. The entry point, and the one step
  // where two key fields move together (`desiredId` and `current`).
  const b1 = await step({ desiredId: 'bbbbbbbbbbbbbbbb', reason: 'stale-build' }, 'B1 desiredId+current');
  assert.equal(b1.data.build.current, false);
  assert.equal(b1.data.build.desiredId, 'bbbbbbbbbbbbbbbb');

  // B2 — the watcher started the rebuild. `reason` alone moves; `current` is
  // still false and `desiredId` is unchanged. Before AS-85 put `reason` in the
  // key this transition reached no connected client at all, even though the
  // sidebar renders it (public/loop-status.js buildSentence).
  const b2 = await step({ desiredId: 'bbbbbbbbbbbbbbbb', reason: 'busy' }, 'B2 reason');
  assert.equal(b2.data.build.reason, 'busy');
  assert.equal(b2.data.build.current, false, 'only `reason` moved at B2');

  // B3 — master moved again mid-build. `desiredId` alone moves: `reason` stays
  // 'busy' and `current` stays false, so this step is killed by nothing except
  // `desiredId` being in the key.
  const b3 = await step({ desiredId: 'cccccccccccccccc', reason: 'busy' }, 'B3 desiredId');
  assert.equal(b3.data.build.desiredId, 'cccccccccccccccc');
  assert.equal(b3.data.build.reason, 'busy', 'only `desiredId` moved at B3');
  assert.equal(b3.data.build.current, false);

  // B4 — the watcher stopped writing. DEPLOY_STATE_STALE_MS is 10 minutes, so
  // an 11-minute-old file is one the server refuses to trust: `current` drops to
  // the tri-state null and `reason` is overridden to 'stale-state'.
  const b4 = await step({
    desiredId: 'cccccccccccccccc', reason: 'busy',
    computedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
  }, 'B4 current+reason');
  assert.equal(b4.data.build.current, null, 'tri-state: unknown, not false');
  assert.equal(b4.data.build.reason, 'stale-state');
  assert.equal(b4.data.build.desiredId, 'cccccccccccccccc', 'the id it last computed is still reported');

  // B5/B6 — `current` ALONE. It takes this shape and no other, which is the
  // point of the pair. `composeBuild` derives `current` from (id, desiredId,
  // watcherListening, staleness), and every condition that forces `current` to
  // null also OVERRIDES `reason` — so for every reason the watcher actually
  // writes, `current` is a function of fields already in the key and cannot
  // move on its own. The exception is the one the two enums create between
  // them: `reason` is copied verbatim out of deploy-state.json, and
  // 'stale-state' is also the name composeBuild gives its own override. A file
  // that spells that reason keeps it across the staleness edge, so `current`
  // crosses true -> null with `id`, `desiredId`, `reason`, `listening` and
  // `state` all unmoved. Delete `current` from the key and B6 pushes nothing.
  const b5 = await step({
    desiredId: BUILD_ID, reason: 'stale-state',
  }, 'B5 back to current, reason held');
  assert.equal(b5.data.build.current, true);
  assert.equal(b5.data.build.reason, 'stale-state', 'the file spells the override name; nothing overrode it');

  const b6 = await step({
    desiredId: BUILD_ID, reason: 'stale-state',
    computedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
  }, 'B6 current alone');
  assert.equal(b6.data.build.current, null, '`current` alone moved: true -> null');
  assert.equal(b6.data.build.reason, b5.data.build.reason, 'and `reason` did not move with it');
  assert.equal(b6.data.build.desiredId, b5.data.build.desiredId, 'nor did `desiredId`');
  assert.equal(b6.data.build.id, b5.data.build.id, 'nor `id`');
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

test('stream: AS-27/AS-80 — close() clears every interval the server armed, the loop poll included', async (t) => {
  // Same shape as the AS-25 close/reap test: this one owns its close() call.
  //
  // AS-80: the observable is the timer handles themselves. The version of this
  // case that shipped with AS-27 asserted that a closed server pushes no
  // frames — which close() guarantees by emptying `streams` before anything
  // else, so a leaked poll fans out to nobody and deleting
  // `clearInterval(loopPoll)` left the case green (AS-27 review, finding F1).
  // `process.getActiveResourcesInfo()` cannot stand in: loopPoll is unref'd,
  // and an unref'd interval is invisible to it. So record what the server arms
  // and what close() releases, and compare BY IDENTITY. A bare-identifier
  // `setInterval` inside server.js resolves through globalThis at call time,
  // so these mocks see it; mock.method calls through to the original, so the
  // server gets real Timeouts and .unref() still applies. Same technique as
  // watcher-main.test.js (AS-82).
  const armed = t.mock.method(globalThis, 'setInterval');
  const released = t.mock.method(globalThis, 'clearInterval');

  const dir = mkdtempSync(join(tmpdir(), 'chat-stream-loopclose-'));
  const dataDir = loopDataDir(t);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { server, close } = createChatServer({
    dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir, loopPollMs: FAST_POLL_MS,
  });
  // Synchronously, before any await: nothing can have interleaved, so this is
  // precisely what the constructor armed.
  const ids = armed.mock.calls.map((c) => c.result);
  // A red must never wedge the runner: the heartbeat is ref'd, so an interval
  // this case proves was leaked would keep the whole file's process alive.
  t.after(() => { for (const id of ids) clearInterval(id); });

  // Cardinality before quantification.
  assert.equal(ids.length, 4,
    'heartbeat, loopPoll, lanesPoll, eventsPoll — update this number AND close() together');
  assert.equal(new Set(ids).size, 4, 'four distinct handles');
  for (const id of ids) {
    assert.equal(typeof id?.unref, 'function', 'every recorded id is a real Timeout');
  }

  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  // AS-81: same guard as the AS-25 close/reap test above, for the same reason.
  let closedByTest = false;
  t.after(async () => { if (!closedByTest) await close(); });

  const stream = await openStream(base, 'human:forrest');
  assert.equal(stream.initialLoop.event, 'loop');

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('close() wedged')), 5000)
  );
  closedByTest = true;
  await Promise.race([close(), timeout]);
  await stream.waitEnd();

  // Set inclusion, not a count: a close() that cleared one handle twice and
  // skipped another would pass a count of four.
  const cleared = released.mock.calls.map((c) => c.arguments[0]);
  const leaked = ids.filter((id) => !cleared.includes(id));
  assert.deepEqual(leaked, [], `close() left ${leaked.length} interval(s) armed`);
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

test('stream-lanes-liveness-change-only: a stage event earns a lanes frame; elapsed time alone does not', async (t) => {
  const dataDir = loopDataDir(t);
  const path = eventsFile(dataDir);
  writeFileSync(path, '');
  writeFileSync(join(dataDir, 'worktrees.json'), laneSnapshot(new Date().toISOString(), {
    worktrees: [
      { relPath: '.', main: true, head: 'f6717b8', branch: 'master', detached: false, ahead: null, behind: null,
        dirtyCount: null, dirtyLattice: null, merged: null, lastCommit: null, errors: [] },
      { relPath: '.worktrees/AS-7', main: false, head: 'abc1234', branch: 'feat/AS-7-thing', detached: false,
        ahead: 1, behind: 0, dirtyCount: 0, dirtyLattice: false, merged: false, lastCommit: null, errors: [] },
    ],
  }));
  const { base } = await bootServer(t, FIXTURE_ROOT, {
    dataDir, loopPollMs: FAST_POLL_MS, lanesPollMs: FAST_POLL_MS, eventsPollMs: FAST_POLL_MS,
  });

  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());
  const laneWithAgent = (frame) => frame.data.lanes.lanes.find((l) => l.subAgent);
  assert.equal(stream.initialLanes.data.lanes.lanes.some((l) => l.subAgent), false,
    'no events yet: every lane says so rather than guessing');

  // A stage opens. Exactly one lanes frame, and the lane it belongs to is live.
  // The count is the point: this caught a boot-order defect where the lanes key
  // was primed from an unprimed tail, so the first poll pushed a second frame
  // with byte-identical content.
  appendFileSync(path, stageStarted('AS-7'));
  const framesA = await drain(stream, FAST_POLL_MS * 8 + 300);
  const lanesA = framesA.filter((f) => f.event === 'lanes');
  assert.equal(lanesA.length, 1, 'one stage event, one lanes frame');
  const liveLane = laneWithAgent(lanesA[0]);
  assert.ok(liveLane, 'the event joined a lane');
  assert.equal(liveLane.subAgent.alive, true);
  assert.equal(liveLane.subAgent.stage, 'implement');
  assert.ok(liveLane.stageStartedAt);

  // Ten polls with nothing appended. `subAgent.elapsedS` grows on every one of
  // them — it is recomputed from the clock — so a key that carried it would
  // emit ten frames here. That is the whole reason elapsedS is excluded.
  assert.deepEqual(
    (await drain(stream)).filter((f) => f.event === 'lanes'),
    [],
    'zero lanes frames while only elapsed time moves'
  );

  // The stage closes: a real change, one frame, and the lane goes quiet.
  appendFileSync(path, eventLine('stage_ended', {
    task: 'AS-7', stage: 'implement', actor: 'agent:developer-lena', outcome: 'completed',
    reason: null, closedBy: 'orchestrator', startedId: null, durationS: 42,
  }));
  const framesB = await drain(stream, FAST_POLL_MS * 8 + 300);
  const lanesB = framesB.filter((f) => f.event === 'lanes');
  assert.equal(lanesB.length, 1, 'one close event, one lanes frame');
  assert.equal(laneWithAgent(lanesB[0]).subAgent.alive, false);
  assert.deepEqual(
    (await drain(stream)).filter((f) => f.event === 'lanes'),
    [],
    'and a closed stage settles — no frame per poll'
  );
});

test('stream-lanes-no-frame-for-laneless-event: an event that touches no lane earns a company frame but no lanes frame; a junk line earns neither', async (t) => {
  const dataDir = loopDataDir(t);
  const path = eventsFile(dataDir);
  writeFileSync(path, '');
  writeFileSync(join(dataDir, 'worktrees.json'), laneSnapshot(new Date().toISOString(), {
    worktrees: [
      { relPath: '.', main: true, head: 'f6717b8', branch: 'master', detached: false, ahead: null, behind: null,
        dirtyCount: null, dirtyLattice: null, merged: null, lastCommit: null, errors: [] },
      { relPath: '.worktrees/AS-7', main: false, head: 'abc1234', branch: 'feat/AS-7-thing', detached: false,
        ahead: 1, behind: 0, dirtyCount: 0, dirtyLattice: false, merged: false, lastCommit: null, errors: [] },
    ],
  }));
  const { base } = await bootServer(t, FIXTURE_ROOT, {
    dataDir, loopPollMs: FAST_POLL_MS, lanesPollMs: FAST_POLL_MS, eventsPollMs: FAST_POLL_MS,
  });

  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  // A tick starts. It is a real event (one `company` frame) but it belongs to
  // no lane and moves nothing the pane draws — so no `lanes` frame. Under the
  // AS-100 key (`events.lastId` in the block) every such event bought a frame
  // with a payload that had not changed (AS-111 F2).
  appendFileSync(path, eventLine('tick_started', {
    source: 'watcher', pid: 5285, startedAt: new Date().toISOString(), messageId: 651, loopTick: 3,
  }));
  const framesA = await drain(stream, FAST_POLL_MS * 8 + 300);
  assert.equal(framesA.filter((f) => f.event === 'company').length, 1, 'one tick event, one company frame');
  assert.equal(framesA.filter((f) => f.event === 'lanes').length, 0, 'a laneless event earns no lanes frame');

  // A hand-appended junk line: counted as malformed, rendered nowhere, and
  // therefore worth neither kind of frame.
  appendFileSync(path, 'not json\n');
  const framesB = await drain(stream, FAST_POLL_MS * 8 + 300);
  assert.equal(framesB.filter((f) => f.event === 'company').length, 0, 'junk is not an event');
  assert.equal(framesB.filter((f) => f.event === 'lanes').length, 0, 'and malformed alone earns no lanes frame');

  // The control: a stage event for a listed lane still moves the key — the
  // frame is withheld for the payload that did not change, not for every event.
  appendFileSync(path, stageStarted('AS-7'));
  const framesC = await drain(stream, FAST_POLL_MS * 8 + 300);
  const lanesC = framesC.filter((f) => f.event === 'lanes');
  assert.equal(lanesC.length, 1, 'a real lane change still earns exactly one lanes frame');
  assert.ok(lanesC[0].data.lanes.lanes.some((l) => l.subAgent && l.subAgent.alive), 'and the lane it belongs to is live');
});

// --- AS-111 F3: a REPLACED stream is noticed, re-read, and named ------------

/** Two lines every replacement fixture starts from: AS-7 opens, then spawns.
 *  Appended AFTER the stream is open (like every sibling above): lines on disk
 *  at boot are primed silently, and the count of frames is the point. */
function appendTwoLines(path) {
  const first = stageStarted('AS-7');
  const second = eventLine('subagent_spawned', {
    task: 'AS-7', stage: 'implement', actor: 'agent:developer-lena', model: 'fable',
  });
  appendFileSync(path, first + second);
  return { first, second };
}

const laneOf = (payload, short) => payload.lanes.lanes.find((l) => l.key === short);

/** A snapshot with a worktree for each of the fixture repo's two tasks, so
 *  both lanes exist to be looked up (no snapshot → `lanes: null`). */
function plantTwoLaneSnapshot(dataDir) {
  writeFileSync(join(dataDir, 'worktrees.json'), laneSnapshot(new Date().toISOString(), {
    worktrees: [
      { relPath: '.', main: true, head: 'f6717b8', branch: 'master', detached: false, ahead: null, behind: null,
        dirtyCount: null, dirtyLattice: null, merged: null, lastCommit: null, errors: [] },
      { relPath: '.worktrees/AS-7', main: false, head: 'abc1234', branch: 'feat/AS-7-thing', detached: false,
        ahead: 1, behind: 0, dirtyCount: 0, dirtyLattice: false, merged: false, lastCommit: null, errors: [] },
      { relPath: '.worktrees/AS-8', main: false, head: 'def5678', branch: 'feat/AS-8-thing', detached: false,
        ahead: 1, behind: 0, dirtyCount: 0, dirtyLattice: false, merged: false, lastCommit: null, errors: [] },
    ],
  }));
}

test('stream-company-replaced-new-inode: a file renamed over the stream (new inode, bytes before the cursor identical) is re-read from the start and reported as replaced', async (t) => {
  const dataDir = loopDataDir(t);
  const path = eventsFile(dataDir);
  writeFileSync(path, '');
  plantTwoLaneSnapshot(dataDir);
  const { base, get } = await bootServer(t, FIXTURE_ROOT, {
    dataDir, loopPollMs: FAST_POLL_MS, lanesPollMs: FAST_POLL_MS, eventsPollMs: FAST_POLL_MS,
  });
  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  const { first, second } = appendTwoLines(path);
  const before = (await drain(stream, FAST_POLL_MS * 8 + 300)).filter((f) => f.event === 'company');
  assert.equal(before.length, 2, 'two planted lines, two frames');
  const lanes0 = (await get('/api/lanes')).data;
  assert.ok(laneOf(lanes0, 'AS-7').subAgent, 'AS-7 is the live lane');
  assert.equal(laneOf(lanes0, 'AS-8').subAgent, null, 'AS-8 has no signal');

  // The replacement: line 1 is the SAME event re-addressed to AS-8 (same byte
  // length — the digit is the only change), line 2 unchanged, plus a laneless
  // third line so the new file is at least as long as the old.
  const oldBuf = readFileSync(path);
  const oldSize = oldBuf.length;
  const ev1 = JSON.parse(first);
  const moved = `${serialiseEvent({ ...ev1, data: { ...ev1.data, task: 'AS-8', worktree: '.worktrees/AS-8', branch: 'feat/AS-8-thing' } })}\n`;
  assert.equal(Buffer.byteLength(moved), Buffer.byteLength(first), 'precondition: the rewritten line is byte-for-byte the same length');
  const third = eventLine('tick_started', {
    source: 'watcher', pid: 5285, startedAt: new Date().toISOString(), messageId: 651, loopTick: 3,
  });
  const newBuf = Buffer.from(moved + second + third);
  assert.ok(newBuf.length >= oldSize, 'precondition: the new file is at least as long as the old');
  assert.ok(
    newBuf.subarray(oldSize - 64, oldSize).equals(oldBuf.subarray(oldSize - 64, oldSize)),
    'precondition: the 64 bytes before the old cursor are identical — the bytes check CANNOT see this swap, only the inode check can'
  );
  const inoBefore = statSync(path).ino;
  writeFileSync(`${path}.next`, newBuf);
  renameSync(`${path}.next`, path);
  assert.notEqual(statSync(path).ino, inoBefore, 'precondition: the rename landed a new inode');

  const after = await drain(stream, FAST_POLL_MS * 8 + 300);
  const company = after.filter((f) => f.event === 'company');
  assert.equal(company.length, 3, 'the whole new file is re-read: three lines, three frames');
  assert.deepEqual(company.map((f) => f.data.data.task ?? null), ['AS-8', 'AS-7', null], 'in file order, with the re-addressed first line');
  const pushed = after.filter((f) => f.event === 'lanes');
  assert.ok(pushed.some((f) => f.data.lanes.events.reason === 'replaced'), 'the pane learns by push: a lanes frame carries the new reason');
  const lanes1 = (await get('/api/lanes')).data;
  assert.equal(lanes1.lanes.events.reason, 'replaced');
  assert.equal(lanes1.lanes.events.malformed, 0, 'no mid-line fragment: the old offset was not carried into the new file');
  assert.ok(laneOf(lanes1, 'AS-8').subAgent, 'the fold was rebuilt from the new content: AS-8 is now the live lane');
  assert.equal(laneOf(lanes1, 'AS-7').subAgent, null, 'and AS-7, which the new file never opens, has no signal');

  // The next append clears it, exactly as truncated does.
  appendFileSync(path, eventLine('stage_ended', {
    task: 'AS-8', stage: 'implement', actor: 'agent:developer-lena', outcome: 'completed',
    reason: null, closedBy: 'orchestrator', startedId: null, durationS: 30,
  }));
  await drain(stream, FAST_POLL_MS * 6 + 300);
  assert.equal((await get('/api/lanes')).data.lanes.events.reason, 'ok', 'the next append clears the reason');
});

test('stream-company-replaced-same-inode: a file rewritten in place (same inode, old offset lands mid-line) is re-read from the start and reported as replaced', async (t) => {
  const dataDir = loopDataDir(t);
  const path = eventsFile(dataDir);
  writeFileSync(path, '');
  plantTwoLaneSnapshot(dataDir);
  const { base, get } = await bootServer(t, FIXTURE_ROOT, {
    dataDir, loopPollMs: FAST_POLL_MS, lanesPollMs: FAST_POLL_MS, eventsPollMs: FAST_POLL_MS,
  });
  const stream = await openStream(base, 'human:forrest');
  t.after(() => stream.close());

  const { second } = appendTwoLines(path);
  const before = (await drain(stream, FAST_POLL_MS * 8 + 300)).filter((f) => f.event === 'company');
  assert.equal(before.length, 2, 'two planted lines, two frames');

  // A restored backup: same path, same inode, a first line of a DIFFERENT
  // length, so the tail's old byte offset lands in the middle of a line.
  const oldBuf = readFileSync(path);
  const oldSize = oldBuf.length;
  const longer = stageStarted('AS-7', { branch: 'feat/AS-7-a-noticeably-longer-branch-name' });
  const third = stageStarted('AS-8', { actor: 'agent:qa-priya', stage: 'review' });
  const newBuf = Buffer.from(longer + second + third);
  assert.ok(newBuf.length > oldSize, 'precondition: longer than the old file, so the size rule cannot see this');
  assert.notEqual(newBuf[oldSize - 1], 0x0a, 'precondition: the old cursor lands mid-line in the new content');
  assert.ok(
    !newBuf.subarray(oldSize - 64, oldSize).equals(oldBuf.subarray(oldSize - 64, oldSize)),
    'precondition: the bytes before the old cursor changed — this is what the bytes check sees'
  );
  const inoBefore = statSync(path).ino;
  writeFileSync(path, newBuf);
  assert.equal(statSync(path).ino, inoBefore, 'precondition: same inode — the inode check CANNOT be the guard here');

  const after = await drain(stream, FAST_POLL_MS * 8 + 300);
  const company = after.filter((f) => f.event === 'company');
  assert.equal(company.length, 3, 'the whole new file is re-read: three lines, three frames (a carried offset would give one fragment and two frames)');
  assert.ok(after.filter((f) => f.event === 'lanes').some((f) => f.data.lanes.events.reason === 'replaced'), 'a lanes frame carries the new reason');
  const lanes = (await get('/api/lanes')).data;
  assert.equal(lanes.lanes.events.reason, 'replaced');
  assert.equal(lanes.lanes.events.malformed, 0, 'no mid-line fragment counted as malformed');
  assert.ok(laneOf(lanes, 'AS-8').subAgent, 'the fold was rebuilt: the third line opened AS-8');
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

// --- AS-81: openStream's own failure path ------------------------------------
// These two are the only tests in the file that do NOT talk to the real server:
// they need an upstream that breaks the on-connect contract, and the point is
// that openStream copes, not that server.js misbehaves. A bare node:http
// upstream that answers the SSE headers and then goes quiet is exactly that,
// and it has one property no chat server has — the response is never ended
// server-side, so the ONLY thing that can close the request is the client
// hanging up. That is what makes the abort assertions below non-vacuous.

/** Spin up that upstream. `onConnect(res)` writes whatever the case needs after
 *  `:connected`; nothing else is ever written and the response is never ended. */
async function fakeStreamUpstream(t, onConnect) {
  let markClosed;
  const clientHungUp = new Promise((ok) => { markClosed = ok; });
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(':connected\n\n');
    req.on('close', markClosed);
    onConnect(res);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(async () => {
    // closeAllConnections first: a held-open response would make close() wait
    // forever, and a guard against wedging must not be able to wedge.
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    /** true iff the upstream saw the client hang up inside the window. */
    hungUpWithin: (ms = 1000) => new Promise((ok) => {
      const timer = setTimeout(() => ok(false), ms);
      clientHungUp.then(() => {
        clearTimeout(timer);
        ok(true);
      });
    }),
  };
}

test('stream: AS-81 — no on-connect frame at all: openStream rejects naming the contract AND hangs up', async (t) => {
  // Headers, :connected, then silence — the shape of a server that stopped
  // sending the AS-27 loop frame.
  const upstream = await fakeStreamUpstream(t, () => {});

  await assert.rejects(
    openStream(upstream.base, 'human:forrest', { connectMs: 200 }),
    /AS-27 on-connect contract: no loop frame within 200ms/
  );

  assert.equal(await upstream.hungUpWithin(1000), true,
    'openStream aborted its own fetch — without that abort this socket stays open, '
    + 'and in a test that owns its server the runner never exits');
});

test('stream: AS-81 — on-connect frames out of order: openStream rejects naming the order AND hangs up', async (t) => {
  // The AS-99 lanes frame arrives where the AS-27 loop frame belongs.
  const upstream = await fakeStreamUpstream(t, (res) => {
    res.write('event: lanes\ndata: {}\n\n');
  });

  await assert.rejects(
    openStream(upstream.base, 'human:forrest', { connectMs: 200 }),
    /AS-27\/AS-99 on-connect contract: expected loop then lanes, got lanes/
  );

  assert.equal(await upstream.hungUpWithin(1000), true,
    'the wrong-event path aborts too — it is the faster of the two red paths, '
    + 'and it leaked exactly the same socket before AS-81');
});
