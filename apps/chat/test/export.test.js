// Tests for the AS-5 JSONL export: store.exportFiles() + `chat export`.
// Same temp-dir pattern as store.test.js; CLI test drives bin/chat.js as a
// child process against a temp CHAT_DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/store.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'chat.js');

function tempStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-export-'));
  const store = openStore(join(dir, 'chat.db'));
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir };
}

/** Flatten exportFiles() output into a comparable set of message rows. */
function exportedMessages(files) {
  const rows = [];
  for (const f of files) {
    if (f.filename === 'identities.jsonl') continue;
    const header = JSON.parse(f.lines[0]);
    assert.equal(header.type, 'conversation', `${f.filename} line 1 is the header`);
    for (const line of f.lines.slice(1)) {
      const m = JSON.parse(line);
      assert.equal(m.type, 'message');
      rows.push({ ...m, conversation_id: header.id });
    }
  }
  return rows;
}

test('export round-trips the messages table faithfully', (t) => {
  const { store } = tempStore(t);
  store.registerIdentity({ id: 'agent:developer-marcus', displayName: 'Marcus Webb', kind: 'agent' });
  store.createChannel({ name: 'exports', purpose: 'test channel', actor: 'human:forrest' });
  const chan = store.getChannelByName('exports');
  const dm = store.openDm('human:forrest', 'agent:developer-marcus');
  const root = store.postMessage({
    conversation: chan.id,
    author: 'human:forrest',
    body: 'multi-line body\nsecond line\n\twith a tab and "quotes"',
  });
  store.postMessage({
    conversation: chan.id,
    author: 'agent:developer-marcus',
    body: 'thread reply — unicode: héllo wörld 日本語 🚀',
    threadRoot: root.id,
  });
  store.postMessage({ conversation: dm.id, author: 'agent:developer-marcus', body: "it's a DM | with pipe: and colon" });

  const got = exportedMessages(store.exportFiles());
  // Ground truth straight from the messages table via dumpLines().
  const want = store
    .dumpLines()
    .map((l) => JSON.parse(l))
    .filter((e) => e.table === 'messages')
    .map(({ row }) => ({
      type: 'message',
      id: row.id,
      thread_root_id: row.thread_root_id,
      author: row.author_id,
      body: row.body,
      created_at: row.created_at,
      conversation_id: row.conversation_id,
    }));
  const byId = (a, b) => a.id - b.id;
  assert.deepEqual(got.sort(byId), want.sort(byId));
});

test('export is deterministic and ignores read_state churn', (t) => {
  const { store } = tempStore(t);
  const eng = store.getChannelByName('engineering');
  store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'one' });
  store.postMessage({ conversation: eng.id, author: 'agent:cto-owen', body: 'two' });
  const first = store.exportFiles();
  const second = store.exportFiles();
  assert.deepEqual(second, first, 'no writes => identical output');
  // Reading conversations mutates read_state, which is excluded by design.
  store.catchupAll('agent:cto-owen');
  store.markRead('human:forrest', eng.id);
  assert.deepEqual(store.exportFiles(), first, 'read_state churn must not change the export');
});

test('export is append-only: prior files are strict prefixes after new messages', (t) => {
  const { store } = tempStore(t);
  const eng = store.getChannelByName('engineering');
  store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'before' });
  const before = new Map(store.exportFiles().map((f) => [f.filename, f.lines.join('\n')]));
  store.postMessage({ conversation: eng.id, author: 'agent:cto-owen', body: 'after' });
  const after = new Map(store.exportFiles().map((f) => [f.filename, f.lines.join('\n')]));
  assert.deepEqual([...after.keys()], [...before.keys()], 'no files appear or vanish');
  for (const [filename, oldContent] of before) {
    const newContent = after.get(filename);
    assert.ok(newContent.startsWith(oldContent), `${filename} keeps its prior content as a prefix`);
    if (filename === 'channel-engineering.jsonl') {
      assert.ok(newContent.length > oldContent.length, 'the affected file grew');
    } else {
      assert.equal(newContent, oldContent, `only the affected file changes (${filename})`);
    }
  }
});

test('DM filenames use the ~ scheme, are safe, and never collide', (t) => {
  const { store } = tempStore(t);
  // Exercise the full identity alphabet: dots, underscores, hyphens, digits.
  store.registerIdentity({ id: 'agent:a1.b_c-d', displayName: 'Alphabet One', kind: 'agent' });
  store.registerIdentity({ id: 'human:x9._-z', displayName: 'Alphabet Two', kind: 'human' });
  store.openDm('agent:a1.b_c-d', 'human:x9._-z');
  store.openDm('agent:cto-owen', 'human:forrest');
  const files = store.exportFiles();
  const dmNames = files.map((f) => f.filename).filter((n) => n.startsWith('dm-'));
  assert.ok(dmNames.includes('dm-agent~a1.b_c-d~~human~x9._-z.jsonl'), `~ scheme applied: ${dmNames}`);
  assert.ok(dmNames.includes('dm-agent~cto-owen~~human~forrest.jsonl'));
  for (const f of files) {
    assert.doesNotMatch(f.filename, /[:|/\\]/, `filesystem-safe: ${f.filename}`);
  }
  assert.equal(new Set(files.map((f) => f.filename)).size, files.length, 'distinct files for distinct conversations');
});

test('cli: chat export writes files, prints summary, and re-runs byte-identically', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-export-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'chat.db');
  const outDir = join(dir, 'out');
  // Seed some content directly through the store, then export via the CLI.
  const store = openStore(dbPath);
  const eng = store.getChannelByName('engineering');
  store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'export me' });
  store.close();

  const run = () =>
    spawnSync(process.execPath, [BIN, 'export', '--out', outDir], {
      env: { ...process.env, CHAT_DB: dbPath },
      encoding: 'utf8',
    });
  const hashes = () =>
    Object.fromEntries(
      readdirSync(outDir)
        .sort()
        .map((f) => [f, createHash('sha256').update(readFileSync(join(outDir, f))).digest('hex')])
    );

  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^Exported 3 conversations, 1 messages, 4 identities to /);
  const names = readdirSync(outDir).sort();
  assert.deepEqual(names, [
    'channel-announcements.jsonl',
    'channel-engineering.jsonl',
    'channel-lattice-events.jsonl',
    'identities.jsonl',
  ]);
  for (const f of names) {
    const content = readFileSync(join(outDir, f), 'utf8');
    assert.ok(content.endsWith('\n'), `${f} ends with a newline`);
    for (const line of content.trimEnd().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
  }
  const h1 = hashes();

  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(hashes(), h1, 'second run is byte-identical');

  // --json variant carries the counts and file list.
  const jsonRun = spawnSync(process.execPath, [BIN, 'export', '--out', outDir, '--json'], {
    env: { ...process.env, CHAT_DB: dbPath },
    encoding: 'utf8',
  });
  assert.equal(jsonRun.status, 0, jsonRun.stderr);
  const parsed = JSON.parse(jsonRun.stdout);
  assert.equal(parsed.conversations, 3);
  assert.equal(parsed.messages, 1);
  assert.equal(parsed.identities, 4);
  assert.equal(parsed.out, outDir);
  assert.deepEqual([...parsed.files].sort(), names);
});

// --- AS-6: private channels are excluded from the export --------------------

test('AS-6: #board never produces an export file, even with messages in it', (t) => {
  const { store } = tempStore(t);
  const board = store.getChannelByName('board');
  store.postMessage({ conversation: board.id, author: 'human:forrest', body: 'board secret' });
  store.postMessage({ conversation: board.id, author: 'agent:ceo-carla', body: 'more board talk' });
  const files = store.exportFiles();
  assert.ok(!files.some((f) => f.filename === 'channel-board.jsonl'));
  const allLines = files.flatMap((f) => f.lines).join('\n');
  assert.ok(!allLines.includes('board secret'), 'board content must not leak into any file');
  // Store-level private channels are excluded the same way.
  store.createChannel({
    name: 'warroom', actor: 'human:forrest', visibility: 'private',
    members: ['human:forrest', 'agent:cto-owen'],
  });
  assert.ok(!store.exportFiles().some((f) => f.filename === 'channel-warroom.jsonl'));
});

test('AS-6: the export header line format is unchanged (no visibility key)', (t) => {
  const { store } = tempStore(t);
  store.openDm('human:forrest', 'agent:cto-owen');
  for (const f of store.exportFiles()) {
    if (f.filename === 'identities.jsonl') continue;
    // Exact key order — the byte-identical-prefix contract against files
    // already committed under AS-5 depends on this never changing.
    assert.deepEqual(Object.keys(JSON.parse(f.lines[0])), [
      'type', 'id', 'conv_type', 'name', 'purpose', 'dm_key',
      'members', 'created_by', 'created_at',
    ]);
  }
});

test('AS-6: interleaved board traffic never perturbs public export files', (t) => {
  const { store } = tempStore(t);
  const eng = store.getChannelByName('engineering');
  const board = store.getChannelByName('board');
  store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'public one' });
  const before = new Map(store.exportFiles().map((f) => [f.filename, f.lines.join('\n')]));
  // Board traffic interleaved with public traffic: message ids interleave in
  // the shared sequence, but exported public files must only append.
  store.postMessage({ conversation: board.id, author: 'human:forrest', body: 'hidden between' });
  store.postMessage({ conversation: eng.id, author: 'agent:cto-owen', body: 'public two' });
  store.postMessage({ conversation: board.id, author: 'agent:ceo-carla', body: 'hidden after' });
  const after = new Map(store.exportFiles().map((f) => [f.filename, f.lines.join('\n')]));
  assert.deepEqual([...after.keys()], [...before.keys()], 'file set unchanged by board traffic');
  for (const [filename, oldContent] of before) {
    assert.ok(after.get(filename).startsWith(oldContent), `${filename} stays a prefix`);
  }
  assert.ok(!([...after.values()].join('\n').includes('hidden')), 'no board bytes exported');
});

test('cli: AS-6 — chat export skips #board: no file, no counts, still byte-identical on re-run', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-export-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'chat.db');
  const outDir = join(dir, 'out');
  const store = openStore(dbPath);
  const eng = store.getChannelByName('engineering');
  const board = store.getChannelByName('board');
  store.postMessage({ conversation: eng.id, author: 'human:forrest', body: 'public' });
  store.postMessage({ conversation: board.id, author: 'human:forrest', body: 'board secret' });
  store.close();

  const run = () =>
    spawnSync(process.execPath, [BIN, 'export', '--out', outDir, '--json'], {
      env: { ...process.env, CHAT_DB: dbPath },
      encoding: 'utf8',
    });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const parsed = JSON.parse(first.stdout);
  // The seeded-but-hidden #board moves no number and produces no file:
  // same "3 conversations, 1 messages" a board-less DB would report.
  assert.equal(parsed.conversations, 3);
  assert.equal(parsed.messages, 1);
  assert.ok(!parsed.files.includes('channel-board.jsonl'));
  assert.deepEqual(readdirSync(outDir).sort(), [
    'channel-announcements.jsonl',
    'channel-engineering.jsonl',
    'channel-lattice-events.jsonl',
    'identities.jsonl',
  ]);
  for (const f of readdirSync(outDir)) {
    assert.ok(!readFileSync(join(outDir, f), 'utf8').includes('board secret'));
  }
  const hashes = () =>
    Object.fromEntries(
      readdirSync(outDir)
        .sort()
        .map((f) => [f, createHash('sha256').update(readFileSync(join(outDir, f))).digest('hex')])
    );
  const h1 = hashes();
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(hashes(), h1, 're-run is byte-identical');
});

// --- AS-3: pure CLI reads must not churn the export --------------------------

test('cli: AS-3 — history on a nonexistent DM adds no export file', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-export-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'chat.db');
  const outDir = join(dir, 'out');
  const store = openStore(dbPath);
  store.registerIdentity({ id: 'agent:developer-marcus', displayName: 'Marcus Webb', kind: 'agent' });
  store.close();

  const env = { ...process.env, CHAT_DB: dbPath };
  const exportRun = () =>
    spawnSync(process.execPath, [BIN, 'export', '--out', outDir], { env, encoding: 'utf8' });
  const hashes = () =>
    Object.fromEntries(
      readdirSync(outDir)
        .sort()
        .map((f) => [f, createHash('sha256').update(readFileSync(join(outDir, f))).digest('hex')])
    );

  assert.equal(exportRun().status, 0);
  const before = hashes();

  // Before AS-3 this created the DM row, and the next export grew a phantom
  // dm-*.jsonl (header line, zero messages) — a pure read producing a git diff.
  const history = spawnSync(
    process.execPath,
    [BIN, 'history', '@human:forrest', '--me', 'agent:developer-marcus'],
    { env, encoding: 'utf8' }
  );
  assert.equal(history.status, 0, history.stderr);
  assert.match(history.stdout, /No DM with @human:forrest yet/);

  assert.equal(exportRun().status, 0);
  assert.deepEqual(hashes(), before, 'export dir is byte-identical after the pure read');
  assert.ok(!readdirSync(outDir).some((f) => f.startsWith('dm-')), 'no phantom dm-*.jsonl');
});
