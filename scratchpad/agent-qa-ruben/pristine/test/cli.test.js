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
    // --no-warnings: node:sqlite's ExperimentalWarning is PID-stamped, which
    // breaks the string-identical stderr assertions below on node versions
    // that emit it (observed on v24.13.1). App behavior is unaffected.
    env: { ...process.env, CHAT_DB: dbPath, CHAT_REPO_ROOT: FIXTURE_ROOT, NODE_OPTIONS: '--no-warnings' },
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

test('cli: roster prints the active company roster with work status (AS-8)', (t) => {
  const dbPath = setupDb(t);
  const table = run(dbPath, ['roster']);
  assert.equal(table.status, 0, table.stderr);
  assert.match(table.stdout, /agent:eng-ada\s+Ada Fixture\s+Fixture Engineer\s+AS-22 in progress \(\+2\)/);
  assert.match(table.stdout, /agent:qa-bob\s+Bob Fixture\s+QA Engineer\s+idle/);
  assert.ok(!table.stdout.includes('Dora'), 'departed dossier excluded');

  const asJson = JSON.parse(run(dbPath, ['roster', '--json']).stdout);
  assert.deepEqual(asJson.map((r) => r.actorId), ['agent:eng-ada', 'agent:qa-bob']);
  assert.equal(asJson[0].work.shortId, 'AS-22');
  assert.equal(asJson[0].registered, false);
  assert.ok(!('dmConversationId' in asJson[0]), 'viewer-relative fields absent without --me');
  // --me adds viewer-relative fields (no DM yet: null/0).
  const withMe = JSON.parse(run(dbPath, ['roster', '--json', '--me', M]).stdout);
  assert.equal(withMe[0].dmConversationId, null);
  assert.equal(withMe[0].unread, 0);

  // Degradation contract: repo root without personnel/ notes it and exits 0.
  const bare = spawnSync(process.execPath, [BIN, 'roster'], {
    env: { ...process.env, CHAT_DB: dbPath, CHAT_REPO_ROOT: tmpdir() },
    encoding: 'utf8',
  });
  assert.equal(bare.status, 0, bare.stderr);
  assert.match(bare.stdout, /No personnel records found/);
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

// --- AS-3: CLI read paths never create the DM conversation row --------------

/** DM conversation id for N<->M via a fresh store handle, or null. */
function dmRow(dbPath) {
  const store = openStore(dbPath);
  try {
    return store.dmConversationFor(N, M);
  } finally {
    store.close();
  }
}

test('cli: AS-3 — history/read/reply on a nonexistent DM never create a row', (t) => {
  const dbPath = setupDb(t);
  assert.equal(dmRow(dbPath), null, 'precondition: no DM between the pair');

  const history = run(dbPath, ['history', `@${M}`, '--me', N]);
  assert.equal(history.status, 0, history.stderr);
  assert.match(history.stdout, /No DM with @human:forrest yet — 'chat dm human:forrest "…"' starts one\./);
  assert.equal(dmRow(dbPath), null, 'history created no row');

  const historyJson = run(dbPath, ['history', `@${M}`, '--me', N, '--json']);
  assert.equal(historyJson.status, 0, historyJson.stderr);
  assert.deepEqual(JSON.parse(historyJson.stdout), { conversation: null, messages: [], threads: {} });
  assert.equal(dmRow(dbPath), null, 'history --json created no row');

  const read = run(dbPath, ['read', `@${M}`, '--me', N]);
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /Nothing to mark read — no DM with @human:forrest yet\./);
  const readJson = run(dbPath, ['read', `@${M}`, '--me', N, '--json']);
  assert.deepEqual(JSON.parse(readJson.stdout), { conversation: null, lastReadId: null });
  assert.equal(dmRow(dbPath), null, 'read created no row');

  const reply = run(dbPath, ['reply', `@${M}#1`, 'into the void', '--me', N]);
  assert.equal(reply.status, 1);
  assert.match(reply.stderr, /No DM with @human:forrest yet — message @human:forrest#1 does not exist\./);
  assert.equal(dmRow(dbPath), null, 'reply created no row');
});

test('cli: AS-3 — DM read-path error quality is preserved (typo, self-DM)', (t) => {
  const dbPath = setupDb(t);
  const typo = run(dbPath, ['history', '@agent:no-such-person', '--me', N]);
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /Unknown identity 'agent:no-such-person'/, 'typos are unknown_identity, not "no DM yet"');
  const self = run(dbPath, ['read', `@${N}`, '--me', N]);
  assert.equal(self.status, 1);
  assert.match(self.stderr, /Cannot open a DM with yourself\./);
  assert.equal(dmRow(dbPath), null);
});

// --- AS-22: create-channel --visibility/--members ---------------------------

const BIZDEV_MEMBERS =
  'human:forrest,agent:ceo-carla,agent:cto-owen,agent:researcher-nadia,agent:researcher-elliot';

/** Registers the two researcher identities the msg-156 scenario needs. */
function registerResearchers(dbPath) {
  for (const [id, name] of [
    ['agent:researcher-nadia', 'Nadia Okonkwo'],
    ['agent:researcher-elliot', 'Elliot Kwan'],
  ]) {
    const r = run(dbPath, ['register', id, name, '--kind', 'agent']);
    assert.equal(r.status, 0, r.stderr);
  }
}

test('cli: AS-22 acceptance — five-seat private #bizdev is created, usable by members, invisible to others', (t) => {
  const dbPath = setupDb(t);
  registerResearchers(dbPath);

  const create = run(dbPath, [
    'create-channel', 'bizdev',
    '--visibility', 'private',
    '--members', BIZDEV_MEMBERS,
    '--me', 'agent:ceo-carla',
  ]);
  assert.equal(create.status, 0, create.stderr);
  assert.equal(create.stdout.trim(), 'Created #bizdev (private, 5 members)');

  // Exactly the requested membership, no silent additions or omissions.
  const store = openStore(dbPath);
  try {
    const bizdev = store.getChannelByName('bizdev');
    assert.equal(bizdev.visibility, 'private');
    assert.deepEqual(store.dmMembers(bizdev.id), BIZDEV_MEMBERS.split(',').sort());
  } finally {
    store.close();
  }

  // Members see it; the non-member N never does — text and --json.
  const forMember = run(dbPath, ['channels', '--me', 'agent:researcher-nadia']);
  assert.match(forMember.stdout, /#bizdev/);
  const forMemberJson = JSON.parse(run(dbPath, ['channels', '--me', 'agent:researcher-nadia', '--json']).stdout);
  assert.ok(forMemberJson.some((c) => c.name === 'bizdev' && c.visibility === 'private'));
  const forN = run(dbPath, ['channels', '--me', N]);
  assert.equal(forN.status, 0, forN.stderr);
  assert.ok(!forN.stdout.includes('bizdev'), `bizdev leaked: ${forN.stdout}`);
  const forNJson = JSON.parse(run(dbPath, ['channels', '--me', N, '--json']).stdout);
  assert.ok(!forNJson.some((c) => c.name === 'bizdev'));

  // A member can post.
  const post = run(dbPath, ['post', 'bizdev', 'segment shortlist v1', '--me', 'agent:researcher-elliot']);
  assert.equal(post.status, 0, post.stderr);

  // Non-member probes fail string-identically to a nonexistent channel.
  const norm = (text, name) => text.replaceAll(`'${name}'`, "'<name>'");
  for (const probe of [
    (name) => ['post', name, 'probe body', '--me', N],
    (name) => ['history', name, '--me', N],
  ]) {
    const hidden = run(dbPath, probe('bizdev'));
    const missing = run(dbPath, probe('no-such-channel'));
    assert.equal(hidden.status, 1);
    assert.equal(hidden.status, missing.status);
    assert.equal(hidden.stdout, missing.stdout);
    assert.equal(norm(hidden.stderr, 'bizdev'), norm(missing.stderr, 'no-such-channel'));
  }
});

test('cli: AS-22 — --members without --visibility private is a usage error', (t) => {
  const dbPath = setupDb(t);
  for (const extra of [[], ['--visibility', 'public']]) {
    const r = run(dbPath, ['create-channel', 'oops', '--members', `${N},${M}`, ...extra, '--me', N]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--members requires --visibility private/);
    assert.match(r.stderr, /usage: chat create-channel/);
  }
  // Nothing was created: the name is still free for a normal create.
  const ok = run(dbPath, ['create-channel', 'oops', '--me', N]);
  assert.equal(ok.status, 0, ok.stderr);
});

test('cli: AS-22 — store validation errors pass through unchanged', (t) => {
  const dbPath = setupDb(t);
  const cases = [
    [['create-channel', 'p1', '--visibility', 'private', '--me', N],
      /Private channels require a non-empty members list\./],
    [['create-channel', 'p2', '--visibility', 'private', '--members', M, '--me', N],
      new RegExp(`Private channel members must include the creating actor '${N}'\\.`)],
    [['create-channel', 'p3', '--visibility', 'private', '--members', `${N},agent:ghost`, '--me', N],
      /Unknown identity 'agent:ghost'/],
    [['create-channel', 'p4', '--visibility', 'sneaky', '--me', N],
      /Invalid visibility 'sneaky'\. Must be 'public' or 'private'\./],
  ];
  for (const [argv, want] of cases) {
    const r = run(dbPath, argv);
    assert.equal(r.status, 1, `expected failure: ${argv.join(' ')}`);
    assert.match(r.stderr, want);
  }
});

test('cli: AS-22 — flagged create on a hidden name stays uninformative (oracle regression)', (t) => {
  const dbPath = setupDb(t);
  const squat = run(dbPath, [
    'create-channel', 'board', '--visibility', 'private', '--members', N, '--me', N,
  ]);
  assert.equal(squat.status, 1);
  assert.equal(squat.stderr.trim(), "Channel name 'board' is unavailable.");
  assert.ok(!/exist/i.test(squat.stderr));
});

test('cli: AS-22 — flagless public create-channel is unchanged, including --json shape', (t) => {
  const dbPath = setupDb(t);
  const plain = run(dbPath, ['create-channel', 'eng-notes', '--purpose', 'scratch notes', '--me', N]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, 'Created #eng-notes\n');

  const asJson = run(dbPath, ['create-channel', 'eng-json', '--me', N, '--json']);
  assert.equal(asJson.status, 0, asJson.stderr);
  const row = JSON.parse(asJson.stdout);
  assert.deepEqual(Object.keys(row).sort(), [
    'createdAt', 'createdBy', 'dmKey', 'id', 'name', 'purpose', 'type', 'visibility',
  ]);
  assert.equal(row.visibility, 'public');
  assert.ok(!('members' in row), 'no members key in --json output');

  // Private --json keeps the same shape too — deliberately no members key.
  const priv = run(dbPath, [
    'create-channel', 'eng-priv', '--visibility', 'private', '--members', `${N},${M}`,
    '--me', N, '--json',
  ]);
  assert.equal(priv.status, 0, priv.stderr);
  const privRow = JSON.parse(priv.stdout);
  assert.equal(privRow.visibility, 'private');
  assert.ok(!('members' in privRow), 'no members key for private channels either');
  assert.deepEqual(Object.keys(privRow).sort(), Object.keys(row).sort());
});

test('cli: AS-3 — chat dm still creates the conversation and posts (regression guard)', (t) => {
  const dbPath = setupDb(t);
  const dm = run(dbPath, ['dm', M, 'hello from AS-3', '--me', N]);
  assert.equal(dm.status, 0, dm.stderr);
  assert.match(dm.stdout, /Sent DM to human:forrest as message \d+/);
  assert.ok(dmRow(dbPath) != null, 'dm created the conversation row');
  // The now-existing DM resolves normally on the read paths.
  const history = run(dbPath, ['history', `@${M}`, '--me', N]);
  assert.equal(history.status, 0, history.stderr);
  assert.match(history.stdout, /hello from AS-3/);
  const read = run(dbPath, ['read', `@${M}`, '--me', N]);
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /Marked @human:forrest read\./);
});
