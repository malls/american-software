// AS-24 mode-resolution tests: the CLI decides once per invocation between
// proxying through the server HTTP API and opening the DB file directly, and
// refuses loudly whenever it cannot positively establish that no server is
// listening. The divergence regression here is the whole point of the task:
// a CLI write in API mode must land in the SERVER's DB view (the observation
// that failed for orphan message 161) and must never open a DB file host-side.
//
// Harness: real server via createChatServer on an ephemeral port with a temp
// DB (api.test.js pattern), bin/chat.js driven as a child process
// (cli.test.js pattern) with CHAT_API/CHAT_DB/CHAT_MODE set per test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatServer } from '../server.js';
import { openStore } from '../lib/store.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'chat.js');
const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

/** Run bin/chat.js with a fully controlled mode environment: the three mode
 *  vars (and CHAT_ME) never leak in from the outer environment.
 *  Async on purpose — spawnSync would block this process's event loop, and the
 *  server under test lives on that loop (deadlock: child waits for a response
 *  the blocked parent can never send). */
function run(args, env = {}) {
  const base = { ...process.env, CHAT_REPO_ROOT: FIXTURE_ROOT, NODE_OPTIONS: '--no-warnings' };
  for (const k of ['CHAT_MODE', 'CHAT_API', 'CHAT_DB', 'CHAT_ME']) delete base[k];
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...base, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (status) => done({ status, stdout, stderr }));
  });
}

/** Real chat server on an ephemeral port, temp DB, fixture (or given) repo. */
async function bootServer(t, repoRoot = FIXTURE_ROOT) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-mode-'));
  const { server, store, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  });
  const get = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return { base, get, store, dataDir: dir };
}

/** A CHAT_DB path whose parent directory does not exist. openStore mkdirs the
 *  parent, so "parent still absent" is a strong the-CLI-never-opened-a-DB
 *  assertion. */
function phantomDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-phantom-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'never-created', 'b.db');
}

function assertNoDbTouched(phantom) {
  assert.ok(!existsSync(dirname(phantom)), 'CLI never opened a DB file (parent dir absent)');
}

/** An ephemeral port with provably nothing listening (bind, read, close). */
async function closedPort() {
  const srv = createTcpServer();
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = srv.address().port;
  await new Promise((ok) => srv.close(ok));
  return port;
}

// --- 1. the divergence regression (the AS-24 test) ---------------------------

test('mode: AS-24 — API-mode writes land in the server view; no DB file is ever created', async (t) => {
  const { base, get, dataDir } = await bootServer(t);
  const phantom = phantomDb(t);
  const env = { CHAT_API: base, CHAT_DB: phantom };

  // dm (the command that produced orphan message 161).
  const dm = await run(['dm', 'agent:ceo-carla', 'routed through the API', '--me', 'human:forrest', '--json'], env);
  assert.equal(dm.status, 0, dm.stderr);
  const dmMsg = JSON.parse(dm.stdout);
  // --json shape parity with direct mode: exact keys, no server-side extras.
  assert.deepEqual(Object.keys(dmMsg), ['id', 'conversationId', 'threadRootId', 'authorId', 'body', 'createdAt']);
  // The write is visible in the SERVER's own view — the exact observation
  // that failed for message 161.
  const view = await get(`/api/messages?conversation=${dmMsg.conversationId}&me=human:forrest`);
  assert.equal(view.status, 200);
  assert.ok(view.data.messages.some((m) => m.id === dmMsg.id && m.body === 'routed through the API'));

  // AS-7 sentinel: the human-authored DM was written by the SERVER's store,
  // so the sentinel lands in the server's data dir (host watcher keeps working).
  const sentinel = JSON.parse(readFileSync(join(dataDir, 'last-human-message.json'), 'utf8'));
  assert.equal(sentinel.messageId, dmMsg.id);
  assert.equal(sentinel.authorId, 'human:forrest');

  // post + read, same regression check + --json parity.
  const post = await run(['post', 'engineering', 'api-mode post', '--me', 'human:forrest', '--json'], env);
  assert.equal(post.status, 0, post.stderr);
  const postMsg = JSON.parse(post.stdout);
  assert.deepEqual(Object.keys(postMsg), ['id', 'conversationId', 'threadRootId', 'authorId', 'body', 'createdAt']);
  const chanView = await get(`/api/messages?conversation=${postMsg.conversationId}&me=human:forrest`);
  assert.ok(chanView.data.messages.some((m) => m.id === postMsg.id));

  const read = await run(['read', 'engineering', '--me', 'agent:cto-owen', '--json'], env);
  assert.equal(read.status, 0, read.stderr);
  const readRes = JSON.parse(read.stdout);
  assert.deepEqual(Object.keys(readRes), ['conversation', 'lastReadId']);
  assert.equal(readRes.conversation, postMsg.conversationId);
  assert.equal(readRes.lastReadId, postMsg.id);

  // Human-readable outputs match direct-mode phrasing.
  const plain = await run(['post', 'engineering', 'plain output', '--me', 'human:forrest'], env);
  assert.match(plain.stdout, /^Posted to #engineering as message \d+\n$/);

  // The invariant: in API mode the CLI never opened a DB file.
  assertNoDbTouched(phantom);
});

// --- 2. loud refusal on ambiguity --------------------------------------------

test('mode: AS-24 — probe timeout (something listening, not answering) refuses loudly, zero side effects', async (t) => {
  // Raw TCP listener that accepts and never responds → probe timeout. Track
  // accepted sockets and destroy them on teardown: server.close() alone waits
  // forever for a connection the trap deliberately never serves.
  const sockets = new Set();
  const trap = createTcpServer((s) => sockets.add(s));
  await new Promise((ok) => trap.listen(0, '127.0.0.1', ok));
  t.after(() => new Promise((ok) => {
    for (const s of sockets) s.destroy();
    trap.close(ok);
  }));
  const phantom = phantomDb(t);

  const r = await run(['post', 'engineering', 'must not land', '--me', 'human:forrest'], {
    CHAT_API: `http://127.0.0.1:${trap.address().port}`,
    CHAT_DB: phantom,
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /AS-24/);
  assert.match(r.stderr, /refusing to touch the shared DB/);
  assert.match(r.stderr, /CHAT_MODE=direct/);
  assertNoDbTouched(phantom);
});

test('mode: AS-24 — squatted port (wrong-shaped JSON) refuses loudly, zero side effects', async (t) => {
  const squatter = createHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"who": "not the chat server"}');
  });
  await new Promise((ok) => squatter.listen(0, '127.0.0.1', ok));
  t.after(() => new Promise((ok) => {
    squatter.closeAllConnections();
    squatter.close(ok);
  }));
  const phantom = phantomDb(t);

  const r = await run(['dm', 'agent:ceo-carla', 'must not land', '--me', 'human:forrest'], {
    CHAT_API: `http://127.0.0.1:${squatter.address().port}`,
    CHAT_DB: phantom,
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /AS-24/);
  assert.match(r.stderr, /CHAT_MODE=direct/);
  assertNoDbTouched(phantom);
});

// --- 3. positive-down fallback ------------------------------------------------

test('mode: AS-24 — hard connection-refused falls back to direct mode against CHAT_DB', async (t) => {
  const port = await closedPort();
  const dir = mkdtempSync(join(tmpdir(), 'chat-mode-direct-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'chat.db');

  const r = await run(['dm', 'agent:ceo-carla', 'offline write', '--me', 'human:forrest', '--json'], {
    CHAT_API: `http://127.0.0.1:${port}`,
    CHAT_DB: dbPath,
  });
  assert.equal(r.status, 0, r.stderr);
  const msg = JSON.parse(r.stdout);
  assert.ok(existsSync(dbPath), 'direct mode created and wrote the DB file');
  const store = openStore(dbPath);
  try {
    assert.equal(store.getMessage(msg.id).body, 'offline write');
  } finally {
    store.close();
  }
});

// --- 4. mode precedence ---------------------------------------------------------

test('mode: AS-24 — CHAT_MODE=direct skips the probe entirely (poisoned CHAT_API never contacted)', async (t) => {
  let connections = 0;
  const sockets = new Set();
  const poison = createTcpServer((s) => {
    connections++;
    sockets.add(s);
  });
  await new Promise((ok) => poison.listen(0, '127.0.0.1', ok));
  t.after(() => new Promise((ok) => {
    for (const s of sockets) s.destroy();
    poison.close(ok);
  }));
  const dir = mkdtempSync(join(tmpdir(), 'chat-mode-forced-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const r = await run(['channels', '--me', 'human:forrest'], {
    CHAT_MODE: 'direct',
    CHAT_API: `http://127.0.0.1:${poison.address().port}`, // would refuse if probed
    CHAT_DB: join(dir, 'chat.db'),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /#engineering/);
  assert.equal(connections, 0, 'CHAT_MODE=direct never contacted CHAT_API');
});

test('mode: AS-24 — CHAT_MODE=api with a down server is a loud exit 1', async (t) => {
  const port = await closedPort();
  const phantom = phantomDb(t);
  const r = await run(['channels', '--me', 'human:forrest'], {
    CHAT_MODE: 'api',
    CHAT_API: `http://127.0.0.1:${port}`,
    CHAT_DB: phantom,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CHAT_MODE=api/);
  assert.match(r.stderr, /AS-24/);
  assertNoDbTouched(phantom);
});

test('mode: AS-24 — invalid CHAT_MODE is a usage error', async (t) => {
  const phantom = phantomDb(t);
  const r = await run(['channels', '--me', 'human:forrest'], { CHAT_MODE: 'proxy', CHAT_DB: phantom });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /invalid CHAT_MODE 'proxy'/);
  assertNoDbTouched(phantom);
});

// --- 6. API-mode command sweep -------------------------------------------------

test('mode: AS-24 — full command sweep in API mode (no DB file, direct-mode shapes)', async (t) => {
  // Mutable fixture-repo copy so a lattice event can land AFTER server boot:
  // only the CLI's /api/sync pre-call (unthrottled) can surface it in inbox
  // within the server's 10s ingest-throttle window.
  const root = mkdtempSync(join(tmpdir(), 'chat-mode-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  const { base, get, store } = await bootServer(t, root);
  const phantom = phantomDb(t);
  const env = { CHAT_API: base, CHAT_DB: phantom, CHAT_REPO_ROOT: root };
  const M = 'human:forrest';
  const N = 'agent:developer-marcus';

  // register
  const reg = await run(['register', N, 'Marcus Webb (Engineer)', '--kind', 'agent', '--json'], env);
  assert.equal(reg.status, 0, reg.stderr);
  assert.deepEqual(Object.keys(JSON.parse(reg.stdout)), ['id', 'displayName', 'kind', 'createdAt']);
  const dup = await run(['register', N, 'again', '--kind', 'agent'], env);
  assert.equal(dup.status, 1);
  assert.match(dup.stderr, /already exists/);

  // create-channel: private with members (AS-22 surface over the API).
  const cc = await run(
    ['create-channel', 'warroom', '--visibility', 'private', '--members', `${M},agent:ceo-carla,${M}`, '--me', M],
    env
  );
  assert.equal(cc.status, 0, cc.stderr);
  assert.equal(cc.stdout.trim(), 'Created #warroom (private, 2 members)'); // dupes collapse
  const ccJson = await run(['create-channel', 'notes', '--me', M, '--json'], env);
  assert.deepEqual(Object.keys(JSON.parse(ccJson.stdout)).sort(), [
    'createdAt', 'createdBy', 'dmKey', 'id', 'name', 'purpose', 'type', 'visibility',
  ]);
  const badMembers = await run(['create-channel', 'x', '--members', M, '--me', M], env);
  assert.equal(badMembers.status, 1);
  assert.match(badMembers.stderr, /--members requires --visibility private/);

  // channels: private visible to member, hidden from non-member; --json parity.
  const chansM = JSON.parse((await run(['channels', '--me', M, '--json'], env)).stdout);
  assert.ok(chansM.some((c) => c.name === 'warroom' && c.visibility === 'private'));
  const chansN = await run(['channels', '--me', N], env);
  assert.equal(chansN.status, 0, chansN.stderr);
  assert.ok(!chansN.stdout.includes('warroom'), `warroom leaked: ${chansN.stdout}`);
  assert.ok(!chansN.stdout.includes('board'), `board leaked: ${chansN.stdout}`);

  // Hidden-channel probes: string-identical to nonexistent (AS-6 held in API mode).
  const norm = (text, name) => text.replaceAll(`'${name}'`, "'<name>'");
  for (const probe of [
    (name) => ['post', name, 'probe body', '--me', N],
    (name) => ['history', name, '--me', N],
    (name) => ['read', name, '--me', N],
  ]) {
    const hidden = await run(probe('warroom'), env);
    const missing = await run(probe('no-such-channel'), env);
    assert.equal(hidden.status, 1);
    assert.equal(hidden.status, missing.status);
    assert.equal(hidden.stdout, missing.stdout);
    assert.equal(norm(hidden.stderr, 'warroom'), norm(missing.stderr, 'no-such-channel'));
  }

  // post + threaded reply (channel target) + history --limit/--threads.
  const p1 = JSON.parse((await run(['post', 'warroom', 'root message', '--me', M, '--json'], env)).stdout);
  await run(['post', 'warroom', 'second root', '--me', M], env);
  const rep = await run(['reply', `warroom#${p1.id}`, 'threaded answer', '--me', 'agent:ceo-carla', '--json'], env);
  assert.equal(rep.status, 0, rep.stderr);
  assert.equal(JSON.parse(rep.stdout).threadRootId, p1.id);
  const hist = await run(['history', 'warroom', '--threads', '--me', M], env);
  assert.match(hist.stdout, /root message/);
  assert.match(hist.stdout, /↳ .*threaded answer/);
  const lim = await run(['history', 'warroom', '--limit', '1', '--json', '--me', M], env);
  const limView = JSON.parse(lim.stdout);
  assert.equal(limView.messages.length, 1);
  assert.equal(limView.messages.at(-1).body, 'second root');
  assert.ok('refs' in limView.messages[0], 'history --json is annotated, as in direct mode');

  // DM + reply to a DM target; AS-3: reply into a nonexistent DM fails
  // without creating the row — verified in the SERVER's view.
  const dm1 = JSON.parse((await run(['dm', 'agent:ceo-carla', 'dm root', '--me', N, '--json'], env)).stdout);
  const dmRep = await run(['reply', '@agent:ceo-carla#' + dm1.id, 'dm thread', '--me', N], env);
  assert.equal(dmRep.status, 0, dmRep.stderr);
  const noDm = await run(['reply', '@agent:cto-owen#1', 'into the void', '--me', N], env);
  assert.equal(noDm.status, 1);
  assert.match(noDm.stderr, /No DM with @agent:cto-owen yet — message @agent:cto-owen#1 does not exist\./);
  const convsN = await get(`/api/conversations?me=${encodeURIComponent(N)}`);
  assert.ok(
    !convsN.data.conversations.some((c) => c.type === 'dm' && (c.members ?? []).includes('agent:cto-owen')),
    'AS-3: failed reply created no DM row server-side'
  );

  // inbox: the /api/sync pre-call ingests a post-boot lattice event NOW.
  writeFileSync(
    join(root, '.lattice', 'events', 'task_TESTSWEEP.jsonl'),
    JSON.stringify({
      actor: 'agent:cto-owen', data: { from: 'in_progress', to: 'review' },
      id: 'ev_SWEEP1', schema_version: 1, task_id: 'task_TESTAAAA',
      ts: '2026-08-30T13:00:00Z', type: 'status_changed',
    }) + '\n'
  );
  const inbox = await run(['inbox', '--me', N], env);
  assert.equal(inbox.status, 0, inbox.stderr);
  assert.match(inbox.stdout, /AS-7: in_progress → review/, 'inbox forced the ingest via POST /api/sync');
  // Threaded unread carries thread context (backend.getMessage over the API).
  const inboxCarla = await run(['inbox', '--me', 'agent:ceo-carla', '--json'], env);
  const carlaGroups = JSON.parse(inboxCarla.stdout);
  const dmGroup = carlaGroups.find((g) => g.type === 'dm');
  const threaded = dmGroup.messages.find((m) => m.threadRootId != null);
  assert.equal(threaded.threadContext, 'dm root');

  // read + catchup.
  const rd = await run(['read', '@agent:ceo-carla', '--me', N, '--json'], env);
  assert.equal(rd.status, 0, rd.stderr);
  assert.deepEqual(Object.keys(JSON.parse(rd.stdout)), ['conversation', 'lastReadId']);
  const cu = await run(['catchup', '--me', N, '--json'], env);
  assert.equal(cu.status, 0, cu.stderr);
  assert.ok(JSON.parse(cu.stdout).conversations >= 3);

  // roster: rows come from the server, CLI shape (no self; viewer fields only with --me).
  const roster = JSON.parse((await run(['roster', '--json'], env)).stdout);
  assert.deepEqual(roster.map((r) => r.actorId), ['agent:eng-ada', 'agent:qa-bob']);
  assert.ok(roster.every((r) => !('self' in r) && !('dmConversationId' in r)));
  const rosterMe = JSON.parse((await run(['roster', '--json', '--me', M], env)).stdout);
  assert.ok(rosterMe.every((r) => 'dmConversationId' in r && 'unread' in r && !('self' in r)));

  // dump: byte-identical to the server store's own dump.
  const dump = await run(['dump'], env);
  assert.equal(dump.status, 0, dump.stderr);
  assert.equal(dump.stdout, store.dumpLines().join('\n') + '\n');

  // export: files written host-side, byte-identical to the server store's
  // exportFiles(), deterministic across runs.
  const outDir = join(mkdtempSync(join(tmpdir(), 'chat-mode-export-')), 'export');
  t.after(() => rmSync(dirname(outDir), { recursive: true, force: true }));
  const exp = await run(['export', '--out', outDir, '--json'], env);
  assert.equal(exp.status, 0, exp.stderr);
  const expected = store.exportFiles();
  assert.deepEqual(readdirSync(outDir).sort(), expected.map((f) => f.filename).sort());
  for (const f of expected) {
    assert.equal(readFileSync(join(outDir, f.filename), 'utf8'), f.lines.map((l) => l + '\n').join(''));
  }
  const again = await run(['export', '--out', outDir, '--json'], env);
  assert.equal(again.stdout, exp.stdout, 'export is deterministic');

  // The sweep-wide invariant: not one of these commands opened a DB file.
  assertNoDbTouched(phantom);
});

// --- hermeticity guard ----------------------------------------------------------

test('mode: AS-24 — CHAT_DB alone (rule 4) stays direct with no probe: the suite is hermetic', async (t) => {
  // No CHAT_API, no CHAT_MODE, CHAT_DB set → direct mode, no network at all.
  // (This is the rule that keeps every pre-AS-24 test — and any test box with
  // a real server on 8347 — from ever touching the shared company DB.)
  const dir = mkdtempSync(join(tmpdir(), 'chat-mode-hermetic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = await run(['channels', '--me', 'human:forrest'], { CHAT_DB: join(dir, 'chat.db') });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /#engineering/);
});
