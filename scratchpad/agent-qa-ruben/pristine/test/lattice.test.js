// Tests for lib/lattice.js against the fixture .lattice/ in test/fixtures/repo.
// Never touches the repo's real .lattice/ or real data/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  dashboardTaskUrl,
  assignmentsByActor,
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
    url: 'http://127.0.0.1:8799/#/task/task_TESTAAAA',
  });
  const miss = resolveShortId('AS-999', FIXTURE_ROOT);
  assert.deepEqual(miss, { shortId: 'AS-999', exists: false });
  assert.ok(!('url' in miss), 'unresolvable codes carry no url (AS-10)');
});

test('dashboardTaskUrl: default base, env override, trailing-slash trim (AS-10)', () => {
  const saved = process.env.LATTICE_DASHBOARD_URL;
  try {
    delete process.env.LATTICE_DASHBOARD_URL;
    assert.equal(dashboardTaskUrl('task_TESTAAAA'), 'http://127.0.0.1:8799/#/task/task_TESTAAAA');
    // Compose passthrough sets "" when the host var is absent: treated as unset.
    process.env.LATTICE_DASHBOARD_URL = '';
    assert.equal(dashboardTaskUrl('task_TESTAAAA'), 'http://127.0.0.1:8799/#/task/task_TESTAAAA');
    process.env.LATTICE_DASHBOARD_URL = 'http://127.0.0.1:9999';
    assert.equal(dashboardTaskUrl('task_TESTAAAA'), 'http://127.0.0.1:9999/#/task/task_TESTAAAA');
    process.env.LATTICE_DASHBOARD_URL = 'http://127.0.0.1:9999/';
    assert.equal(
      dashboardTaskUrl('task_TESTAAAA'),
      'http://127.0.0.1:9999/#/task/task_TESTAAAA',
      'trailing slash is trimmed'
    );
    // resolveShortId builds its url through the same base.
    assert.equal(
      resolveShortId('AS-7', FIXTURE_ROOT).url,
      'http://127.0.0.1:9999/#/task/task_TESTAAAA'
    );
  } finally {
    if (saved === undefined) delete process.env.LATTICE_DASHBOARD_URL;
    else process.env.LATTICE_DASHBOARD_URL = saved;
  }
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

test('assignmentsByActor: in-flight only, priority ranking, recency tie-break (AS-8)', (t) => {
  const map = assignmentsByActor(FIXTURE_ROOT);
  // Only ada has in-flight assigned work. Excluded: done (TESTD1), backlog
  // (TESTD2), cancelled (TESTD3), unassigned in-flight (TESTAAAA).
  assert.deepEqual(Object.keys(map), ['agent:eng-ada']);
  // in_progress outranks planned even with an older timestamp; among equal
  // statuses, the more recent last_status_changed_at comes first.
  assert.deepEqual(
    map['agent:eng-ada'].map((e) => [e.shortId, e.status]),
    [
      ['AS-22', 'in_progress'],
      ['AS-23', 'planned'],
      ['AS-21', 'planned'],
    ]
  );
  assert.deepEqual(map['agent:eng-ada'][0], {
    shortId: 'AS-22',
    taskId: 'task_TESTC2',
    title: 'Ada primary in-progress',
    status: 'in_progress',
    url: 'http://127.0.0.1:8799/#/task/task_TESTC2', // AS-10 dashboard link
  });
  // Actors with nothing in flight are absent, not present-with-empty-array.
  assert.ok(!('agent:qa-bob' in map));
  assert.ok(!('agent:analyst-dora' in map));
});

test('assignmentsByActor: missing tasks dir yields an empty map', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-lattice-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(assignmentsByActor(dir), {});
});

// AS-12 hostile-fixture helpers: a throwaway repo root whose .lattice/tasks/
// holds hand-crafted task JSON (the shapes the lattice CLI never writes).
function hostileRepo(t, tasks) {
  const root = mkdtempSync(join(tmpdir(), 'chat-lattice-hostile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, '.lattice', 'tasks');
  mkdirSync(dir, { recursive: true });
  for (const task of tasks) writeFileSync(join(dir, `${task.id}.json`), JSON.stringify(task));
  return root;
}

test('assignmentsByActor: prototype-chain status "constructor" is not in-flight (AS-12)', (t) => {
  const root = hostileRepo(t, [
    // `"constructor" in IN_FLIGHT_RANK` is true via the prototype chain; the
    // own-key filter must exclude it instead of rendering phantom work.
    { id: 'task_EVIL1', short_id: 'AS-92', title: 'phantom', status: 'constructor',
      assigned_to: 'agent:eng-ada', last_status_changed_at: '2026-08-30T00:00:02Z' },
    { id: 'task_EVIL2', short_id: 'AS-93', title: 'phantom too', status: 'toString',
      assigned_to: 'agent:eng-ada', last_status_changed_at: '2026-08-30T00:00:03Z' },
    { id: 'task_OK1', short_id: 'AS-94', title: 'real work', status: 'in_progress',
      assigned_to: 'agent:eng-ada', last_status_changed_at: '2026-08-30T00:00:01Z' },
  ]);
  const map = assignmentsByActor(root);
  assert.deepEqual(Object.keys(map), ['agent:eng-ada']);
  assert.deepEqual(
    map['agent:eng-ada'].map((e) => [e.shortId, e.status]),
    [['AS-94', 'in_progress']],
    'hostile statuses yield no phantom entries'
  );
});

test('assignmentsByActor: assigned_to "__proto__" is a safe own key, no throw (AS-12)', (t) => {
  const root = hostileRepo(t, [
    { id: 'task_EVIL3', short_id: 'AS-95', title: 'proto task', status: 'in_progress',
      assigned_to: '__proto__', last_status_changed_at: '2026-08-30T00:00:02Z' },
    { id: 'task_OK2', short_id: 'AS-96', title: 'real work', status: 'review',
      assigned_to: 'agent:eng-ada', last_status_changed_at: '2026-08-30T00:00:01Z' },
  ]);
  // Plain-object accumulator regression: `byActor["__proto__"] ??= []` read
  // Object.prototype and the .push threw, blanking the whole roster.
  const map = assignmentsByActor(root);
  assert.ok(Object.hasOwn(map, '__proto__'), '"__proto__" is an own key of the result');
  assert.deepEqual(
    map['__proto__'].map((e) => [e.shortId, e.status]),
    [['AS-95', 'in_progress']]
  );
  assert.deepEqual(
    map['agent:eng-ada'].map((e) => [e.shortId, e.status]),
    [['AS-96', 'review']],
    'other actors\' rosters are unaffected'
  );
  // No prototype pollution: the result's prototype and fresh objects are clean.
  assert.equal(Object.getPrototypeOf(map), Object.prototype);
  assert.equal({}.shortId, undefined);
  assert.ok(!('AS-95' in {}));
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
  const { messages } = store.getMessages(chan.id, 'human:forrest');
  assert.equal(messages.length, 4);
  assert.ok(messages.every((m) => m.authorId === 'system:lattice'));
  // Feed reads chronologically on backfill.
  assert.deepEqual(
    messages.map((m) => m.body.split(/[ :]/, 1)[0]),
    ['AS-7', 'AS-8', 'AS-7', 'AS-8']
  );
});
