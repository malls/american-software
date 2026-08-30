// Tests for lib/lattice.js against the fixture .lattice/ in test/fixtures/repo.
// Never touches the repo's real .lattice/ or real data/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/store.js';
import {
  resolveShortId,
  resolveRefs,
  readTaskEvents,
  formatEvent,
  ingestNewEvents,
} from '../lib/lattice.js';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

test('resolveShortId resolves existing tasks and flags missing ones', () => {
  const hit = resolveShortId('AS-7', FIXTURE_ROOT);
  assert.deepEqual(hit, {
    shortId: 'AS-7',
    exists: true,
    taskId: 'task_TESTAAAA',
    title: 'Fixture task seven',
    status: 'in_progress',
  });
  assert.deepEqual(resolveShortId('AS-999', FIXTURE_ROOT), { shortId: 'AS-999', exists: false });
});

test('resolveRefs extracts unique refs; unresolvable codes are flagged, not dropped', () => {
  const refs = resolveRefs('See AS-7 and AS-999, also AS-7 again; ASX-7 and BAS-7 are not refs.', FIXTURE_ROOT);
  assert.deepEqual(refs.map((r) => [r.shortId, r.exists]), [
    ['AS-7', true],
    ['AS-999', false],
  ]);
  assert.deepEqual(resolveRefs('no refs here', FIXTURE_ROOT), []);
});

test('readTaskEvents: per-task files only, ordered by ts, malformed lines skipped', () => {
  const events = readTaskEvents(FIXTURE_ROOT);
  assert.deepEqual(
    events.map((e) => e.id),
    ['ev_A1', 'ev_A2', 'ev_B1', 'ev_A3', 'ev_B2'] // cross-file chronological order
  );
  assert.ok(!events.some((e) => e.id === 'ev_LIFECYCLE_ONLY'), '_lifecycle.jsonl must not be read');
});

test('formatEvent formats creations and transitions; truncates long titles', () => {
  const events = readTaskEvents(FIXTURE_ROOT);
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));
  assert.equal(
    formatEvent(byId.ev_A1, FIXTURE_ROOT),
    'AS-7 created by human:forrest — "Fixture task seven" [backlog]'
  );
  assert.equal(
    formatEvent(byId.ev_A3, FIXTURE_ROOT),
    'AS-7: backlog → in_planning — by agent:cto-owen'
  );
  const created8 = formatEvent(byId.ev_B1, FIXTURE_ROOT);
  assert.match(created8, /^AS-8 created by agent:ceo-carla — "Fixture task eight/);
  assert.match(created8, /…" \[backlog\]$/, 'long title is truncated with an ellipsis');
  // status_changed without short_id in data resolves via ids.json reverse map.
  assert.match(formatEvent(byId.ev_B2, FIXTURE_ROOT), /^AS-8: backlog → cancelled — by agent:ceo-carla$/);
});

test('ingestNewEvents is idempotent: five runs post each event exactly once (T6)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-lattice-'));
  const store = openStore(join(dir, 'chat.db'));
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const first = ingestNewEvents(store, FIXTURE_ROOT);
  assert.equal(first, 4, '2 creations + 2 transitions; comment and malformed line excluded');
  for (let i = 0; i < 4; i++) assert.equal(ingestNewEvents(store, FIXTURE_ROOT), 0);
  const chan = store.getChannelByName('lattice-events');
  const { messages } = store.getMessages(chan.id);
  assert.equal(messages.length, 4);
  assert.ok(messages.every((m) => m.authorId === 'system:lattice'));
  // Feed reads chronologically on backfill.
  assert.deepEqual(
    messages.map((m) => m.body.split(/[ :]/, 1)[0]),
    ['AS-7', 'AS-8', 'AS-7', 'AS-8']
  );
});
