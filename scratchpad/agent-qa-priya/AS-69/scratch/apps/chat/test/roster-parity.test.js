// AS-73 F3: the CLI's roster row shape is DERIVED from the server's, never
// asserted alone.
//
// Priya's AS-33 finding: cli.test.js pins the CLI roster row against a literal
// and api.test.js pins the server row against a different literal, so a field
// that exists on one side and not the other — `reportsTo` was the observed
// case — is invisible to both suites. Nothing compared the two. This file does
// exactly that, three views of one database compared to each other and to no
// literal, so the guard fails when they diverge rather than when someone
// forgets to update a fixture.
//
// Own file because it is the only test that imports createChatServer AND
// spawns bin/chat.js; cli.test.js does the second, api.test.js the first.
//
// spawn, never spawnSync: the server under test lives on this process's event
// loop, and a blocking child wait deadlocks it (the mode.test.js warning).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatServer } from '../server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, '..', 'bin', 'chat.js');
const FIXTURE_ROOT = resolve(HERE, 'fixtures', 'repo');

/** bin/chat.js as a child, with the mode environment fully controlled. */
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

/** Real server, ephemeral port, temp DB, fixture repo root. */
async function bootServer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chat-parity-'));
  const dbPath = join(dir, 'chat.db');
  const { server, close } = createChatServer({ dbPath, repoRoot: FIXTURE_ROOT });
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
  const post = async (path, body) => {
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  };
  return { base, dbPath, get, post };
}

test('parity: the CLI roster row is the server roster row minus self, in direct and api mode', async (t) => {
  const { base, dbPath, get, post } = await bootServer(t);

  // Seed so registered / dmConversationId / unread / work / moreTasks are all
  // non-trivial — a row of nulls would match on both sides for the wrong reason.
  await post('/api/identities', { id: 'agent:eng-ada', displayName: 'Ada Fixture', kind: 'agent' });
  const dm = await post('/api/dms', { me: 'human:forrest', other: 'agent:eng-ada' });
  await post('/api/messages', {
    conversation: dm.data.conversation.id,
    author: 'agent:eng-ada',
    body: 'hello from ada',
  });

  // `self` is the documented web-UI-only field and the single permitted diff.
  const strip = (rows) => rows.map(({ self, ...row }) => row);
  const cliEnv = { direct: { CHAT_DB: dbPath }, api: { CHAT_API: base } };

  const withMe = '?me=human:forrest';
  const served = await get(`/api/roster${withMe}`);
  assert.equal(served.status, 200);
  const server = strip(served.data.roster);
  // Cardinality before quantification: an empty three-way match is vacuous.
  assert.equal(server.length, 2, 'fixture root has two active dossiers');

  const direct = JSON.parse(
    (await run(['roster', '--json', '--me', 'human:forrest'], cliEnv.direct)).stdout
  );
  const api = JSON.parse(
    (await run(['roster', '--json', '--me', 'human:forrest'], cliEnv.api)).stdout
  );

  assert.deepEqual(direct, server, 'direct-mode CLI row differs from the server row');
  assert.deepEqual(api, server, 'api-mode CLI row differs from the server row');
  // Stated separately so a missing/extra field reads as a shape diff, not as a
  // value diff buried in a two-row deepEqual.
  assert.deepEqual(
    Object.keys(direct[0]).sort(),
    Object.keys(server[0]).sort(),
    'CLI and server roster rows must carry the same fields'
  );

  // Same three-way compare with no viewer: dmConversationId/unread are absent
  // (or null) everywhere, and they must be absent everywhere the same way.
  const servedBare = strip((await get('/api/roster')).data.roster);
  assert.equal(servedBare.length, 2);
  const directBare = JSON.parse((await run(['roster', '--json'], cliEnv.direct)).stdout);
  const apiBare = JSON.parse((await run(['roster', '--json'], cliEnv.api)).stdout);
  assert.deepEqual(directBare, servedBare);
  assert.deepEqual(apiBare, servedBare);
});
