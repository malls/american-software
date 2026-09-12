// Falsification suite for compute-lane-metrics.mjs — criterion (e), plan
// §7/§8/§9.1. Two synthetic trials with HAND-COMPUTED numbers (one R above
// 0.5, one below — the §9.2 threshold sides) that the script must reproduce
// EXACTLY; a missing-marker plant (must error, never fabricate); and an
// event-vs-ledger divergence plant (> 60s is a hard error).
//
// The arithmetic in each fixture, done by hand before the script ran:
//
// HIGH (R = 0.6):  tA 10:00 -> killed 10:40   (dA1 = 40)
//                  tB 10:22 -> returned 10:52 (dB = 30)
//                  resume 12:00 -> 12:25      (dA2 = 25)
//   W_T1 = 10:52 - 10:00 = 52   overlap = 10:40 - 10:22 = 18
//   savings = 40 + 30 - 52 = 18   R = 18/30 = 0.6   overhead = 52 - 40 = 12
//   S0 = 40 + 25 + 30 = 95   fanned = 52 + 25 = 77   S0 - fanned = 18 = savings
//
// LOW (R = 0.4):   tB shifted to 10:28 -> 10:58 (dB = 30)
//   W_T1 = 10:58 - 10:00 = 58   overlap = 10:40 - 10:28 = 12
//   savings = 40 + 30 - 58 = 12   R = 12/30 = 0.4   overhead = 18
//   S0 = 95   fanned = 83   S0 - fanned = 12 = savings
//
// S_real (both):   gap-task status_changed at 08:00, 09:30, 09:35, 09:45,
//   10:00 -> gaps 90m (excluded, >= 60 min), 5m, 10m, 15m -> median 10m
//   S_real = 95 + 10 = 105. Window = 24h ending at T2.end (12:40).

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
const D = '2026-09-02T';

/** Build a full synthetic trial. laneB times are the R dial. */
function writeTrial(root, { bSpawn, bReturn, omitBSpawn = false, ledgerTs = null }) {
  const laneA = [
    ev('ev_LA_1', 'task_created', 'task_FXLA', `${D}09:00:00Z`, OWEN, { short_id: 'AS-941', status: 'backlog', title: 'fx' }),
    ev('ev_ASP', 'comment_added', 'task_FXLA', `${D}10:00:00Z`, OWEN, { body: 'lanes-trial: lane spawned — Marcus on AS-941' }),
    ev('ev_AK', 'comment_added', 'task_FXLA', `${D}10:40:00Z`, OWEN, { body: 'lanes-trial: lane killed at first commit + one poll' }),
    ev('ev_A2SP', 'comment_added', 'task_FXLA', `${D}12:00:00Z`, OWEN, { body: 'lanes-trial: lane spawned — resume, fresh context' }),
    ev('ev_A2R', 'comment_added', 'task_FXLA', `${D}12:25:00Z`, OWEN, { body: 'lanes-trial: lane returned — stage complete' }),
  ];
  const laneB = [
    ev('ev_LB_1', 'task_created', 'task_FXLB', `${D}09:10:00Z`, OWEN, { short_id: 'AS-934', status: 'backlog', title: 'fx' }),
  ];
  if (!omitBSpawn) {
    laneB.push(ev('ev_BSP', 'comment_added', 'task_FXLB', `${D}${bSpawn}Z`, OWEN, { body: 'lanes-trial: lane spawned — Lena on AS-934' }));
  }
  laneB.push(ev('ev_BR', 'comment_added', 'task_FXLB', `${D}${bReturn}Z`, OWEN, { body: 'lanes-trial: lane returned — stage complete' }));
  const gap = [
    ev('ev_G_1', 'task_created', 'task_FXG', `${D}07:00:00Z`, OWEN, { short_id: 'AS-999', status: 'backlog', title: 'fx' }),
    ev('ev_G_2', 'status_changed', 'task_FXG', `${D}08:00:00Z`, OWEN, { from: 'backlog', to: 'in_planning' }),
    ev('ev_G_3', 'status_changed', 'task_FXG', `${D}09:30:00Z`, OWEN, { from: 'in_planning', to: 'planned' }),
    ev('ev_G_4', 'status_changed', 'task_FXG', `${D}09:35:00Z`, OWEN, { from: 'planned', to: 'in_progress' }),
    ev('ev_G_5', 'status_changed', 'task_FXG', `${D}09:45:00Z`, OWEN, { from: 'in_progress', to: 'review' }),
    ev('ev_G_6', 'status_changed', 'task_FXG', `${D}10:00:00Z`, OWEN, { from: 'review', to: 'done' }),
  ];
  writeEventsFile(root, 'task_FXLA', laneA);
  writeEventsFile(root, 'task_FXLB', laneB);
  writeEventsFile(root, 'task_FXG', gap);

  const ledger = join(root, 'ledger.jsonl');
  const ts = ledgerTs || ['10:00:00', '10:40:00', bSpawn, bReturn, '12:00:00', '12:25:00'];
  writeLedger(ledger, ts.map((t) => ledgerEntry(`${D}${t}Z`, 'lattice comment (lanes-trial marker)')));

  const cfg = join(root, 'fx-config.json');
  writeConfig(cfg, {
    windows: {
      T1: { start: `${D}09:55:00Z`, end: `${D}11:30:00Z` },
      T2: { start: `${D}11:55:00Z`, end: `${D}12:40:00Z` },
    },
    tasks: {
      'AS-941': { task_id: 'task_FXLA', lane: 'A' },
      'AS-934': { task_id: 'task_FXLB', lane: 'B' },
    },
  });
  return { events: join(root, '.lattice/events'), ledger, cfg };
}

const S_REAL_TAIL =
  'gaps used 3, excluded >= 60 min: 1; filter: status_changed company-wide, ' +
  'ts in 2026-09-01T12:40:00.000Z..2026-09-02T12:40:00.000Z (24h ending at T2.end), ' +
  'consecutive gaps, gaps >= 60 min excluded, median]';

test('(e) HIGH fixture: hand-computed R = 0.6 reproduced exactly, every number cited', () => {
  const root = makeBareFixture();
  try {
    const { events, ledger, cfg } = writeTrial(root, { bSpawn: '10:22:00', bReturn: '10:52:00' });
    const r = runChecker('compute-lane-metrics.mjs', ['--events', events, '--config', cfg, '--ledger', ledger]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, 'examined 14 event(s) / 3 task(s) / 6 ledger line(s) / 5 status_changed in S_real window');
    assert.equal(rep.verdict, 'PASS: all metrics computed with event-id citations; ledger cross-check within 60s; identity holds');
    assert.deepEqual(rep.rest, [
      'tA_spawn = 2026-09-02T10:00:00Z [ev_ASP]',
      'tA_kill = 2026-09-02T10:40:00Z [ev_AK]',
      'tB_spawn = 2026-09-02T10:22:00Z [ev_BSP]',
      'tB_return = 2026-09-02T10:52:00Z [ev_BR]',
      'tA2_spawn = 2026-09-02T12:00:00Z [ev_A2SP]',
      'tA2_return = 2026-09-02T12:25:00Z [ev_A2R]',
      'dA1 = 40.00 min [tA_kill - tA_spawn; ev_AK, ev_ASP]',
      'dB = 30.00 min [tB_return - tB_spawn; ev_BR, ev_BSP]',
      'dA2 = 25.00 min [tA2_return - tA2_spawn; ev_A2R, ev_A2SP]',
      'W_T1 = 52.00 min [max(tA_kill, tB_return) - min(tA_spawn, tB_spawn) = ev_BR - ev_ASP]',
      'overlap = 18.00 min [min(tA_kill, tB_return) - max(tA_spawn, tB_spawn) = ev_AK - ev_BSP, floored at 0]',
      'savings = 18.00 min [dA1 + dB - W_T1]',
      'R = 0.6000 [savings / min(dA1, dB); available parallelism = 30.00 min]',
      'overhead = 12.00 min [W_T1 - max(dA1, dB)]',
      'S0 = 95.00 min [dA1 + dA2 + dB; zero-gap serial baseline]',
      'fanned = 77.00 min [W_T1 + dA2; fanned campaign cost]',
      'identity = OK [S0 - fanned = 18.00 min = savings]',
      `S_real = 105.00 min [S0 + median gap 10.00 min; ${S_REAL_TAIL}`,
    ]);
  } finally {
    destroy(root);
  }
});

test('(e) LOW fixture: hand-computed R = 0.4 reproduced exactly', () => {
  const root = makeBareFixture();
  try {
    const { events, ledger, cfg } = writeTrial(root, { bSpawn: '10:28:00', bReturn: '10:58:00' });
    const r = runChecker('compute-lane-metrics.mjs', ['--events', events, '--config', cfg, '--ledger', ledger]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, 'examined 14 event(s) / 3 task(s) / 6 ledger line(s) / 5 status_changed in S_real window');
    assert.deepEqual(rep.rest, [
      'tA_spawn = 2026-09-02T10:00:00Z [ev_ASP]',
      'tA_kill = 2026-09-02T10:40:00Z [ev_AK]',
      'tB_spawn = 2026-09-02T10:28:00Z [ev_BSP]',
      'tB_return = 2026-09-02T10:58:00Z [ev_BR]',
      'tA2_spawn = 2026-09-02T12:00:00Z [ev_A2SP]',
      'tA2_return = 2026-09-02T12:25:00Z [ev_A2R]',
      'dA1 = 40.00 min [tA_kill - tA_spawn; ev_AK, ev_ASP]',
      'dB = 30.00 min [tB_return - tB_spawn; ev_BR, ev_BSP]',
      'dA2 = 25.00 min [tA2_return - tA2_spawn; ev_A2R, ev_A2SP]',
      'W_T1 = 58.00 min [max(tA_kill, tB_return) - min(tA_spawn, tB_spawn) = ev_BR - ev_ASP]',
      'overlap = 12.00 min [min(tA_kill, tB_return) - max(tA_spawn, tB_spawn) = ev_AK - ev_BSP, floored at 0]',
      'savings = 12.00 min [dA1 + dB - W_T1]',
      'R = 0.4000 [savings / min(dA1, dB); available parallelism = 30.00 min]',
      'overhead = 18.00 min [W_T1 - max(dA1, dB)]',
      'S0 = 95.00 min [dA1 + dA2 + dB; zero-gap serial baseline]',
      'fanned = 83.00 min [W_T1 + dA2; fanned campaign cost]',
      'identity = OK [S0 - fanned = 12.00 min = savings]',
      `S_real = 105.00 min [S0 + median gap 10.00 min; ${S_REAL_TAIL}`,
    ]);
  } finally {
    destroy(root);
  }
});

test('(e) planted missing spawn marker: hard FAIL, no metric is fabricated', () => {
  const root = makeBareFixture();
  try {
    const { events, ledger, cfg } = writeTrial(root, { bSpawn: '10:22:00', bReturn: '10:52:00', omitBSpawn: true });

    // §8.1 — the planted violation is present: lane B's stream has no spawn marker.
    const raw = readFileSync(join(root, '.lattice/events/task_FXLB.jsonl'), 'utf8');
    assert.ok(!raw.includes('lane spawned'), 'mutation applied: no spawn marker on lane B');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 13 event(s) / 3 task(s) / 6 ledger line(s) / 5 status_changed in S_real window',
      verdict: 'FAIL: 1 violation(s)',
      items: ['marker tB_spawn ("lanes-trial: lane spawned" on AS-934 in T1): not found'],
    };
    const r = runChecker('compute-lane-metrics.mjs', ['--events', events, '--config', cfg, '--ledger', ledger]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
    // Never fabricate: no metric line may appear on a FAIL.
    assert.ok(!r.stdout.includes('R = '), 'no R on a failed measurement');
    assert.ok(!r.stdout.includes('savings = '), 'no savings on a failed measurement');
  } finally {
    destroy(root);
  }
});

test('(e) planted ledger divergence > 60s: hard FAIL naming the marker', () => {
  const root = makeBareFixture();
  try {
    // tA_kill's ledger entry drifted to 10:41:30 — 90s from the event.
    const { events, ledger, cfg } = writeTrial(root, {
      bSpawn: '10:22:00',
      bReturn: '10:52:00',
      ledgerTs: ['10:00:00', '10:41:30', '10:22:00', '10:52:00', '12:00:00', '12:25:00'],
    });

    // §8.1 — the planted violation is present: recompute the nearest-entry
    // distance for the kill event from the raw ledger; it must exceed 60s.
    const times = readFileSync(ledger, 'utf8').trim().split('\n').map((l) => Date.parse(JSON.parse(l).ts));
    const killT = Date.parse('2026-09-02T10:40:00Z');
    const nearest = Math.min(...times.map((t) => Math.abs(t - killT)));
    assert.equal(nearest, 90000, 'mutation applied: nearest ledger entry 90s from tA_kill');

    // §8.2 — prediction BEFORE the run:
    const predicted = {
      code: 1,
      first: 'examined 14 event(s) / 3 task(s) / 6 ledger line(s) / 5 status_changed in S_real window',
      verdict: 'FAIL: 1 violation(s)',
      items: ['marker tA_kill (ev_AK): event-vs-ledger divergence 90s > 60s'],
    };
    const r = runChecker('compute-lane-metrics.mjs', ['--events', events, '--config', cfg, '--ledger', ledger]);
    assert.equal(r.code, predicted.code, r.stderr);
    const rep = parseReport(r.stdout);
    assert.equal(rep.first, predicted.first);
    assert.equal(rep.verdict, predicted.verdict);
    assert.deepEqual(rep.items, predicted.items, 'failing set exactly as predicted');
    assert.ok(!r.stdout.includes('R = '), 'no metrics on a diverged measurement');
  } finally {
    destroy(root);
  }
});
