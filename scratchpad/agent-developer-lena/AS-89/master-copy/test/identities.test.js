// AS-89: startup identity reconciliation from personnel/ dossiers. A hired
// employee must have a chat identity the moment a server (or a direct-mode
// CLI) opens the DB — no more hires who are mute until someone runs
// `chat register` for them. Real server on an ephemeral port, temp DB,
// fixture and scratch personnel roots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatServer } from '../server.js';
import { openStore } from '../lib/store.js';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');
// The fixture's active dossiers, sorted by name (Ada, Bob); dora is departed,
// eve and mallory never parse.
const FIXTURE_ACTIVE = ['agent:eng-ada', 'agent:qa-bob'];

function scratchDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function bootServer(t, repoRoot, dbPath) {
  const dir = scratchDir(t, 'chat-identities-');
  const { server, store, reconciled, close } = createChatServer({
    dbPath: dbPath ?? join(dir, 'chat.db'), repoRoot, dataDir: join(dir, 'loop-data'),
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => close());
  const get = async (path) => {
    const res = await fetch(base + path);
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const post = async (path, body) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  return { get, post, store, reconciled };
}

/** Fixture root copied to scratch so a test can add a dossier of its own. */
function scratchRoot(t) {
  const root = scratchDir(t, 'chat-personnel-');
  cpSync(FIXTURE_ROOT, root, { recursive: true });
  return root;
}

function dossier(root, file, { actorId, name, status = 'active' }) {
  writeFileSync(
    join(root, 'personnel', file),
    `---\nactor_id: ${actorId}\nname: ${name}\ntitle: Fixture\nclass: ic\nreports_to: agent:cto-owen\nteam: engineering\nhired: 2026-09-11\nstatus: ${status}\n---\n\n# ${name}\n`
  );
}

test('identities: every active dossier is registered before the server accepts requests (AC-1, AC-9)', async (t) => {
  const { get, reconciled } = await bootServer(t, FIXTURE_ROOT);
  assert.deepEqual(reconciled.registered, FIXTURE_ACTIVE);
  assert.deepEqual(reconciled.existing, []);
  assert.deepEqual(reconciled.skipped, []);
  // AC-9: cardinality — the fixture has exactly two active dossiers, and
  // examined is the sum of the three outcome buckets.
  assert.equal(reconciled.examined, 2);
  assert.equal(
    reconciled.examined,
    reconciled.registered.length + reconciled.existing.length + reconciled.skipped.length
  );
  const roster = await get('/api/roster');
  assert.equal(roster.status, 200);
  assert.deepEqual(roster.data.roster.map((r) => r.actorId), FIXTURE_ACTIVE);
  for (const row of roster.data.roster) assert.equal(row.registered, true, `${row.actorId} registered`);
});

test('identities: a new dossier with no identity can post without anyone registering it (AC-2)', async (t) => {
  const root = scratchRoot(t);
  dossier(root, 'newhire-zed.md', { actorId: 'agent:developer-zed', name: 'Zed Fixture' });
  const { post, reconciled } = await bootServer(t, root);
  // Created by the seeded board identity, not by a dossier identity: on
  // master every dossier-only actor is mute, so the red must land on zed's
  // own post, not on the channel setup.
  const ch = await post('/api/channels', { name: 'zed-lane', purpose: 'AS-89', actor: 'human:forrest' });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  // The post is what a mute employee could not do. Pre-AS-89 this was a 404
  // unknown_identity; the assertion is ordered so that stays the observed red.
  const msg = await post('/api/messages', {
    conversation: ch.data.conversation.id, author: 'agent:developer-zed', body: 'first day, not mute',
  });
  assert.notEqual(msg.data?.error?.code, 'unknown_identity', JSON.stringify(msg.data));
  assert.ok([200, 201].includes(msg.status), `post as fresh hire: ${msg.status} ${JSON.stringify(msg.data)}`);
  assert.ok(reconciled.registered.includes('agent:developer-zed'));
});

test('identities: departed dossiers are not registered (AC-3)', async (t) => {
  const { store, reconciled } = await bootServer(t, FIXTURE_ROOT);
  assert.equal(store.getIdentity('agent:analyst-dora'), undefined);
  assert.ok(!reconciled.registered.includes('agent:analyst-dora'));
  assert.ok(!reconciled.existing.includes('agent:analyst-dora'));
  assert.equal(reconciled.examined, 2, 'departed dossier not counted as examined');
});

test('identities: an existing identity with a drifted display name is left as-is (AC-4)', async (t) => {
  const dir = scratchDir(t, 'chat-identities-db-');
  const dbPath = join(dir, 'chat.db');
  const seed = openStore(dbPath);
  seed.registerIdentity({ id: 'agent:eng-ada', displayName: 'Ada (legacy)', kind: 'agent' });
  seed.close();
  const { store, reconciled } = await bootServer(t, FIXTURE_ROOT, dbPath);
  assert.equal(store.getIdentity('agent:eng-ada').displayName, 'Ada (legacy)');
  assert.deepEqual(reconciled.existing, ['agent:eng-ada']);
  assert.deepEqual(reconciled.registered, ['agent:qa-bob']);
});

test('identities: a dossier registerIdentity rejects is skipped and reported; the server still boots (AC-5)', async (t) => {
  const root = scratchRoot(t);
  // Passes the parser (fm.name is the truthy string "   ") and fails the
  // store's non-empty displayName check.
  dossier(root, 'blank-name.md', { actorId: 'agent:blank-name', name: '"   "' });
  const { get, store, reconciled } = await bootServer(t, root);
  assert.equal(reconciled.skipped.length, 1);
  assert.equal(reconciled.skipped[0].actorId, 'agent:blank-name');
  assert.ok(reconciled.skipped[0].reason.length > 0);
  assert.equal(store.getIdentity('agent:blank-name'), undefined);
  assert.deepEqual(reconciled.registered, FIXTURE_ACTIVE);
  assert.equal((await get('/api/roster')).status, 200);
});

test('identities: missing personnel/ dir reconciles nothing and the server is up (AC-6, AS-8 contract)', async (t) => {
  const empty = scratchDir(t, 'chat-empty-root-');
  const { get, reconciled } = await bootServer(t, empty);
  assert.deepEqual(reconciled, { registered: [], existing: [], skipped: [], examined: 0 });
  const roster = await get('/api/roster');
  assert.equal(roster.status, 200);
  assert.deepEqual(roster.data.roster, []);
});

test('identities: reconciliation is idempotent across two boots on one DB (AC-8)', async (t) => {
  const dir = scratchDir(t, 'chat-identities-db-');
  const dbPath = join(dir, 'chat.db');
  const first = await bootServer(t, FIXTURE_ROOT, dbPath);
  const after1 = first.store.listIdentities().length;
  const second = await bootServer(t, FIXTURE_ROOT, dbPath);
  assert.deepEqual(second.reconciled.registered, []);
  assert.deepEqual(second.reconciled.existing, first.reconciled.registered);
  assert.equal(second.store.listIdentities().length, after1);
});
