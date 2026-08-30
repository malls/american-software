// AS-6 CLI-surface tests: hidden #board must be indistinguishable from a
// nonexistent channel for non-members — string-equal errors (modulo the echoed
// channel name), same exit codes. Drives bin/chat.js as a child process
// against a temp CHAT_DB, like export.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/store.js';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'chat.js');
const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

const N = 'agent:developer-marcus';
const M = 'human:forrest';

/** Temp DB seeded with a non-member identity and one #board message. */
function setupDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'chat.db');
  const store = openStore(dbPath);
  store.registerIdentity({ id: N, displayName: 'Marcus Webb (Engineer)', kind: 'agent' });
  const board = store.getChannelByName('board');
  store.postMessage({ conversation: board.id, author: M, body: 'board-only business' });
  store.close();
  return dbPath;
}

function run(dbPath, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, CHAT_DB: dbPath, CHAT_REPO_ROOT: FIXTURE_ROOT },
    encoding: 'utf8',
  });
}

test('cli: chat channels never lists #board for a non-member; members see it', (t) => {
  const dbPath = setupDb(t);
  const forN = run(dbPath, ['channels', '--me', N]);
  assert.equal(forN.status, 0, forN.stderr);
  assert.ok(!forN.stdout.includes('board'), `board leaked: ${forN.stdout}`);
  const forNJson = run(dbPath, ['channels', '--me', N, '--json']);
  const convs = JSON.parse(forNJson.stdout);
  assert.ok(!convs.some((c) => c.name === 'board'));

  const forM = run(dbPath, ['channels', '--me', M]);
  assert.match(forM.stdout, /#board — Board & founders/);
  const boardId = JSON.parse(run(dbPath, ['channels', '--me', M, '--json']).stdout).find(
    (c) => c.name === 'board'
  ).id;
  assert.ok(!convs.some((c) => c.id === boardId), 'board id absent from non-member JSON');
});

test('cli: hidden probes fail string-identically to nonexistent ones (modulo the echoed name)', (t) => {
  const dbPath = setupDb(t);
  const norm = (text, name) => text.replaceAll(`'${name}'`, "'<name>'");
  const probes = [
    (name) => ['history', name, '--me', N],
    (name) => ['post', name, 'probe body', '--me', N],
    (name) => ['read', name, '--me', N],
    (name) => ['reply', `${name}#1`, 'probe reply', '--me', N],
  ];
  for (const probe of probes) {
    const hidden = run(dbPath, probe('board'));
    const missing = run(dbPath, probe('no-such-channel'));
    assert.equal(hidden.status, 1, `probe ${probe('board')[0]} exits 1`);
    assert.equal(hidden.status, missing.status);
    assert.equal(hidden.stdout, missing.stdout, 'stdout identical');
    assert.equal(
      norm(hidden.stderr, 'board'),
      norm(missing.stderr, 'no-such-channel'),
      `stderr identical modulo echoed name for: ${probe('board').join(' ')}`
    );
    assert.match(hidden.stderr, /Unknown channel 'board'\. 'chat channels' lists them\./);
  }
});

test('cli: inbox and catchup never touch #board for a non-member', (t) => {
  const dbPath = setupDb(t);
  const inbox = run(dbPath, ['inbox', '--me', N]);
  assert.equal(inbox.status, 0, inbox.stderr);
  assert.ok(!inbox.stdout.includes('board'), `board leaked in inbox: ${inbox.stdout}`);
  assert.ok(!inbox.stdout.includes('board-only business'));
  // A member's inbox does show the board message.
  const memberInbox = run(dbPath, ['inbox', '--me', 'agent:ceo-carla']);
  assert.match(memberInbox.stdout, /#board — \d+ new/);
  assert.match(memberInbox.stdout, /board-only business/);
  // catchup completes cleanly for the non-member.
  const catchup = run(dbPath, ['catchup', '--me', N]);
  assert.equal(catchup.status, 0, catchup.stderr);
});

test('cli: create-channel collision on the hidden name is uninformative', (t) => {
  const dbPath = setupDb(t);
  const squat = run(dbPath, ['create-channel', 'board', '--purpose', 'mine now', '--me', N]);
  assert.equal(squat.status, 1);
  assert.equal(squat.stderr.trim(), "Channel name 'board' is unavailable.");
  assert.ok(!/exist/i.test(squat.stderr));
  // Member gets the ordinary collision wording.
  const member = run(dbPath, ['create-channel', 'board', '--me', M]);
  assert.equal(member.status, 1);
  assert.match(member.stderr, /Channel 'board' already exists\./);
});

test('cli: members use #board normally (post, history, reply, read)', (t) => {
  const dbPath = setupDb(t);
  const post = run(dbPath, ['post', 'board', 'agenda item', '--me', 'agent:cto-owen']);
  assert.equal(post.status, 0, post.stderr);
  const history = run(dbPath, ['history', 'board', '--me', M]);
  assert.equal(history.status, 0, history.stderr);
  assert.match(history.stdout, /board-only business/);
  assert.match(history.stdout, /agenda item/);
  const rootId = /\[(\d+)\][^\n]*agenda item/.exec(history.stdout)[1];
  const reply = run(dbPath, ['reply', `board#${rootId}`, 'seconded', '--me', 'agent:ceo-carla']);
  assert.equal(reply.status, 0, reply.stderr);
  const read = run(dbPath, ['read', 'board', '--me', M]);
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /Marked #board read\./);
});
