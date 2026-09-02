// Falsification suite for check-event-integrity.mjs — criterion (c), plan
// §7/§8. The plan's table names three separate fixtures: a corrupted
// from-state, a duplicate claim, and an injected unledgered in-window event.
// A fourth plant falsifies the attribution half (§5.3 relay validation) —
// an attribution rule never seen failing would be decoration.
//
// Fixtures are bare .lattice/events trees (no git needed): the checker reads
// only the event log, the ledger, and the config.

import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  makeBareFixture,
  destroy,
  ev,
  writeEventsFile,
  writeLedger,
  ledgerEntry,
  writeConfig,
  runChecker,
  parseReport,
  realTreeSnapshot,
} from './fixture.mjs';

let realSnap;
before(() => {
  realSnap = realTreeSnapshot();
});
after(() => {
  assert.equal(realTreeSnapshot(), realSnap, '§8.4: real tree must be byte-identical before and after this suite');
});

const OWEN = 'agent:cto-owen';

test('(c) planted corrupted from-state FAILS with exactly that event', () => {
  const root = makeBareFixture();
  try {
    writeEventsFile(root, 'task_FXC1', [
      ev('ev_C1_1', 'task_created', 'task_FXC1', '2026-09-02T09:00:00Z', OWEN, {
        short_id: 'AS-951', status: 'backlog', title: 'fx',
      }),
      ev('ev_C1_2', 'status_changed', 'task_FXC1', '2026-09-02T09:05:00Z', OWEN, { from: 'backlog', to: 'in_planning' }),
      // The plant: claims from='planned' while the replayed state is 'in_planning'.
      ev('ev_C1_3', 'status_changed', 'task_FXC1', '2026-09-02T09:10:00Z', OWEN, { from: 'planned', to: 'in_progress' }),
    ]);

    // §8.1 — the planted violation is present in the raw JSONL:
    const raw = readFileSync(join(root, '.lattice/events/task_FXC1.jsonl'), 'utf8').trim().split('\n');
    assert.ok(raw[1].includes('"to":"in_planning"') && raw[2].includes('"from":"planned"'), 'mutation applied');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 3 event(s) / 1 task(s) / 0 in-window',
      verdict: 'FAIL: 1 violation(s)',
      items: ["task_FXC1 ev_C1_3: status_changed from='planned' but state was 'in_planning'"],
    };
    const r = runChecker('check-event-integrity.mjs', ['--events', join(root, '.lattice/events')]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(c) planted duplicate claim FAILS with exactly that event', () => {
  const root = makeBareFixture();
  try {
    writeEventsFile(root, 'task_FXC2', [
      ev('ev_C2_1', 'task_created', 'task_FXC2', '2026-09-02T09:00:00Z', OWEN, {
        short_id: 'AS-952', status: 'backlog', title: 'fx',
      }),
      ev('ev_C2_2', 'assignment_changed', 'task_FXC2', '2026-09-02T09:01:00Z', 'agent:developer-marcus', {
        from: null, to: 'agent:developer-marcus',
      }),
      // The plant: a second claim from=null while marcus already holds the task
      // (the AS-24 / duplicate-scoring two-writer shape).
      ev('ev_C2_3', 'assignment_changed', 'task_FXC2', '2026-09-02T09:02:00Z', 'agent:developer-lena', {
        from: null, to: 'agent:developer-lena',
      }),
    ]);

    // §8.1 — the planted violation is present in the raw JSONL:
    const raw = readFileSync(join(root, '.lattice/events/task_FXC2.jsonl'), 'utf8');
    assert.equal(raw.match(/"from":null,"to":"agent:developer-/g).length, 2, 'mutation applied: two from=null claims');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 3 event(s) / 1 task(s) / 0 in-window',
      verdict: 'FAIL: 1 violation(s)',
      items: [
        "task_FXC2 ev_C2_3: assignment_changed from=null but assignee was 'agent:developer-marcus' (overlapping/duplicate assignment)",
      ],
    };
    const r = runChecker('check-event-integrity.mjs', ['--events', join(root, '.lattice/events')]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(c) planted unledgered in-window event FAILS the write-fence cross-check with exactly that event', () => {
  const root = makeBareFixture();
  try {
    writeEventsFile(root, 'task_FXC3', [
      ev('ev_C3_1', 'task_created', 'task_FXC3', '2026-09-02T09:00:00Z', OWEN, {
        short_id: 'AS-953', status: 'backlog', title: 'fx',
      }),
      ev('ev_C3_2', 'comment_added', 'task_FXC3', '2026-09-02T10:10:00Z', OWEN, { body: 'ledgered comment' }),
      // The plant: an in-window event the orchestrator cannot account for —
      // nearest ledger entry is 90s away.
      ev('ev_C3_3', 'comment_added', 'task_FXC3', '2026-09-02T10:30:00Z', OWEN, { body: 'stray comment' }),
    ]);
    const ledger = join(root, 'ledger.jsonl');
    writeLedger(ledger, [
      ledgerEntry('2026-09-02T10:10:30Z', 'lattice comment task_FXC3 ...'),
      ledgerEntry('2026-09-02T10:31:30Z', 'git -C . commit ...'),
    ]);

    // §8.1 — the planted violation is present: recompute the nearest-entry
    // distance for ev_C3_3 from the raw files; it must exceed 60s.
    const times = readFileSync(ledger, 'utf8').trim().split('\n').map((l) => Date.parse(JSON.parse(l).ts));
    const evT = Date.parse('2026-09-02T10:30:00Z');
    const nearest = Math.min(...times.map((t) => Math.abs(t - evT)));
    assert.equal(nearest, 90000, 'mutation applied: nearest ledger entry 90s from the stray event');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 3 event(s) / 1 task(s) / 2 in-window',
      verdict: 'FAIL: 1 violation(s)',
      items: ['task_FXC3 ev_C3_3: no ledger entry within 60s (nearest 90s)'],
    };
    const r = runChecker('check-event-integrity.mjs', [
      '--events', join(root, '.lattice/events'),
      '--window', '2026-09-02T10:00:00Z..2026-09-02T11:00:00Z',
      '--ledger', ledger,
    ]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(c) planted mis-attributed in-window comment FAILS against the expected-actor map', () => {
  const root = makeBareFixture();
  try {
    writeEventsFile(root, 'task_FXC4', [
      ev('ev_C4_1', 'task_created', 'task_FXC4', '2026-09-02T09:00:00Z', OWEN, {
        short_id: 'AS-954', status: 'backlog', title: 'fx',
      }),
      // The plant: an in-window comment by an actor outside the task's
      // expected set (the §5.3 relay says only the mapped actors may appear).
      ev('ev_C4_2', 'comment_added', 'task_FXC4', '2026-09-02T10:15:00Z', 'agent:qa-priya', { body: 'drive-by' }),
    ]);
    const cfg = join(root, 'fx-config.json');
    writeConfig(cfg, { tasks: { 'AS-954': { task_id: 'task_FXC4', expected_actors: [OWEN] } } });

    // §8.1 — the planted violation is present:
    const raw = readFileSync(join(root, '.lattice/events/task_FXC4.jsonl'), 'utf8');
    assert.ok(raw.includes('"actor":"agent:qa-priya"'), 'mutation applied: unexpected actor in window');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 2 event(s) / 1 task(s) / 1 in-window / 1 attributed task(s)',
      verdict: 'FAIL: 1 violation(s)',
      items: ["task_FXC4 ev_C4_2: comment actor 'agent:qa-priya' not in expected set (agent:cto-owen)"],
    };
    const r = runChecker('check-event-integrity.mjs', [
      '--events', join(root, '.lattice/events'),
      '--window', '2026-09-02T10:00:00Z..2026-09-02T11:00:00Z',
      '--config', cfg,
    ]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
  } finally {
    destroy(root);
  }
});

test('(c) clean twin: legal chains, legal reassignment, attributed and ledgered window PASS', () => {
  const root = makeBareFixture();
  try {
    writeEventsFile(root, 'task_FXC5', [
      ev('ev_C5_1', 'task_created', 'task_FXC5', '2026-09-02T09:00:00Z', OWEN, {
        short_id: 'AS-955', status: 'backlog', title: 'fx',
      }),
      ev('ev_C5_2', 'status_changed', 'task_FXC5', '2026-09-02T09:05:00Z', OWEN, { from: 'backlog', to: 'in_planning' }),
      ev('ev_C5_3', 'assignment_changed', 'task_FXC5', '2026-09-02T09:06:00Z', OWEN, {
        from: null, to: 'agent:developer-marcus',
      }),
      // A legal reassignment: from matches the replayed assignee.
      ev('ev_C5_4', 'assignment_changed', 'task_FXC5', '2026-09-02T09:07:00Z', OWEN, {
        from: 'agent:developer-marcus', to: 'agent:developer-lena',
      }),
      ev('ev_C5_5', 'comment_added', 'task_FXC5', '2026-09-02T10:05:00Z', OWEN, { body: 'lanes-trial: lane spawned' }),
    ]);
    writeEventsFile(root, 'task_FXC6', [
      ev('ev_C6_1', 'task_created', 'task_FXC6', '2026-09-02T09:30:00Z', OWEN, {
        short_id: 'AS-956', status: 'backlog', title: 'fx',
      }),
      ev('ev_C6_2', 'comment_added', 'task_FXC6', '2026-09-02T10:20:00Z', 'agent:developer-lena', { body: 'breadcrumb' }),
    ]);
    const ledger = join(root, 'ledger.jsonl');
    writeLedger(ledger, [
      ledgerEntry('2026-09-02T10:05:10Z', 'lattice comment task_FXC5 ...'),
      ledgerEntry('2026-09-02T10:20:20Z', 'lattice comment task_FXC6 ...'),
    ]);
    const cfg = join(root, 'fx-config.json');
    writeConfig(cfg, {
      tasks: {
        'AS-955': { task_id: 'task_FXC5', expected_actors: [OWEN] },
        'AS-956': { task_id: 'task_FXC6', expected_actors: ['agent:developer-lena', OWEN] },
      },
    });
    const r = runChecker('check-event-integrity.mjs', [
      '--events', join(root, '.lattice/events'),
      '--window', '2026-09-02T10:00:00Z..2026-09-02T11:00:00Z',
      '--ledger', ledger,
      '--config', cfg,
    ]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, 'examined 7 event(s) / 2 task(s) / 2 in-window / 2 attributed task(s)');
    assert.equal(rep.verdict, 'PASS: event-log integrity holds');
    assert.deepEqual(rep.items, []);
  } finally {
    destroy(root);
  }
});
