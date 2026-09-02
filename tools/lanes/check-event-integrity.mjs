#!/usr/bin/env node
// tools/lanes/check-event-integrity.mjs — AS-60 ships-clean criterion (c):
// event-log integrity plus the write-fence ledger cross-check.
//
// Four properties (plan §7 row c):
//   1. per task, every status_changed.from equals the replayed prior state,
//      seeded by task_created's data.status — a wrong from-state is the
//      AS-26 signature (a transition recorded against a stale board copy);
//   2. no overlapping/duplicate assignment: every assignment_changed.from
//      equals the replayed prior assignee (seeded null at task_created) —
//      a duplicate claim shows up as from=null while someone already holds
//      the task (the AS-24 / duplicate-scoring two-writer shape);
//   3. with --window + --config: every in-window comment on a config task is
//      attributed to an actor in that task's expected_actors (the §5.3 relay
//      contract, validated rather than assumed);
//   4. with --window + --ledger: every in-window event (any type, any task)
//      has a ledger entry within 60s — an event the orchestrator cannot
//      account for is a fence trip (plan §5.2.2).
//
// Zero dependencies: node:* builtins only, host node >= 20.
//
// usage: check-event-integrity.mjs [--events <dir>] [--window <startISO>..<endISO>]...
//                                  [--ledger <file>] [--config <file>]
//   --events   events directory (default: .lattice/events under the cwd —
//              run from the main checkout, or pass explicitly)
//   --window   repeatable; inclusive bounds; --ledger requires at least one
//   --ledger   JSONL of {ts, actor, cmd, note} written by the orchestrator
//   --config   trial-config.json (schema: tools/lanes/README.md); only tasks
//              with both task_id and expected_actors participate in the
//              attribution check
//
// Output contract (plan §7): line 1 cardinality, line 2 PASS/FAIL, then
// "  - <task_id> <event_id>: <reason>" per violation. Structural checks are
// replayed in file append order (the append-only log is the authority, not
// timestamp sort). Only files matching task_*.jsonl are read (_lifecycle.jsonl
// and friends are not task streams). Exit 0 pass, 1 fail, 2 usage error.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

function usage(msg) {
  if (msg) console.error('error: ' + msg);
  console.error(
    'usage: check-event-integrity.mjs [--events <dir>] [--window <startISO>..<endISO>]... [--ledger <file>] [--config <file>]',
  );
  process.exit(2);
}

const args = process.argv.slice(2);
let eventsDir = join(process.cwd(), '.lattice', 'events');
const windows = [];
let ledgerPath = null;
let configPath = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const val = () => {
    if (i + 1 >= args.length) usage(a + ' needs a value');
    return args[++i];
  };
  if (a === '--events') eventsDir = val();
  else if (a === '--window') {
    const raw = val();
    const m = raw.split('..');
    if (m.length !== 2) usage('bad --window (want <startISO>..<endISO>): ' + raw);
    const start = Date.parse(m[0]);
    const end = Date.parse(m[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) usage('unparseable --window timestamps: ' + raw);
    if (start > end) usage('--window start after end: ' + raw);
    windows.push({ start, end });
  } else if (a === '--ledger') ledgerPath = val();
  else if (a === '--config') configPath = val();
  else usage('unknown argument: ' + a);
}
if (ledgerPath && windows.length === 0) usage('--ledger requires at least one --window');

let files;
try {
  files = readdirSync(eventsDir).filter((f) => /^task_.*\.jsonl$/.test(f)).sort();
} catch (e) {
  usage('cannot read events dir ' + eventsDir + ': ' + e.message);
}

let ledgerTimes = null;
if (ledgerPath) {
  let raw;
  try {
    raw = readFileSync(ledgerPath, 'utf8');
  } catch (e) {
    usage('cannot read ledger ' + ledgerPath + ': ' + e.message);
  }
  ledgerTimes = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      usage('bad ledger JSONL line: ' + line.slice(0, 80));
    }
    const t = Date.parse(entry.ts);
    if (!Number.isFinite(t)) usage('unparseable ledger ts: ' + String(entry.ts));
    ledgerTimes.push(t);
  }
}

// Attribution map: task_id -> expected actor list, from config tasks that
// carry both fields. Attribution only runs on in-window comments.
let expectedActors = null;
if (configPath) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (e) {
    usage('cannot read config ' + configPath + ': ' + e.message);
  }
  expectedActors = new Map();
  for (const t of Object.values(cfg.tasks || {})) {
    if (t.task_id && Array.isArray(t.expected_actors) && t.expected_actors.length) {
      expectedActors.set(t.task_id, t.expected_actors);
    }
  }
}

const fmt = (v) => (v === null || v === undefined ? 'null' : `'${v}'`);
const inWindow = (t) => windows.some((w) => t >= w.start && t <= w.end);

let totalEvents = 0;
let inWindowCount = 0;
const violations = [];

for (const f of files) {
  const taskId = f.replace(/\.jsonl$/, '');
  const lines = readFileSync(join(eventsDir, f), 'utf8').split('\n').filter((l) => l.trim());
  let status = null;
  let statusSeeded = false;
  let assignee = null;
  let assigneeSeeded = false;
  for (const line of lines) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch (e) {
      violations.push(`${taskId} <unparseable>: bad JSONL line`);
      continue;
    }
    totalEvents++;
    const id = ev.id || '<no-id>';
    const bad = (msg) => violations.push(`${taskId} ${id}: ${msg}`);

    // 1+2: structural replay in append order.
    if (ev.type === 'task_created') {
      statusSeeded = true;
      status = ev.data && ev.data.status !== undefined ? ev.data.status : null;
      assigneeSeeded = true;
      assignee = null;
    } else if (ev.type === 'status_changed') {
      if (!statusSeeded) bad('status_changed before task_created');
      else if (ev.data.from !== status) bad(`status_changed from=${fmt(ev.data.from)} but state was ${fmt(status)}`);
      status = ev.data.to;
      statusSeeded = true;
    } else if (ev.type === 'assignment_changed') {
      const from = ev.data.from === undefined ? null : ev.data.from;
      if (!assigneeSeeded) bad('assignment_changed before task_created');
      else if (from !== assignee) {
        bad(`assignment_changed from=${fmt(from)} but assignee was ${fmt(assignee)} (overlapping/duplicate assignment)`);
      }
      assignee = ev.data.to === undefined ? null : ev.data.to;
      assigneeSeeded = true;
    }

    // 3+4: window checks.
    if (windows.length) {
      const t = Date.parse(ev.ts);
      if (!Number.isFinite(t)) {
        bad(`unparseable ts ${fmt(ev.ts)}`);
        continue;
      }
      if (!inWindow(t)) continue;
      inWindowCount++;
      if (expectedActors && ev.type === 'comment_added' && expectedActors.has(ev.task_id || taskId)) {
        const expected = expectedActors.get(ev.task_id || taskId);
        if (!expected.includes(ev.actor)) {
          bad(`comment actor ${fmt(ev.actor)} not in expected set (${expected.join(', ')})`);
        }
      }
      if (ledgerTimes) {
        if (!ledgerTimes.length) {
          bad('no ledger entry within 60s (ledger empty)');
        } else {
          let best = Infinity;
          for (const lt of ledgerTimes) {
            const d = Math.abs(lt - t);
            if (d < best) best = d;
          }
          if (best > 60000) bad(`no ledger entry within 60s (nearest ${Math.round(best / 1000)}s)`);
        }
      }
    }
  }
}

let cardinality = `examined ${totalEvents} event(s) / ${files.length} task(s) / ${inWindowCount} in-window`;
if (expectedActors) cardinality += ` / ${expectedActors.size} attributed task(s)`;
console.log(cardinality);
if (!violations.length) {
  console.log('PASS: event-log integrity holds');
  process.exit(0);
}
console.log(`FAIL: ${violations.length} violation(s)`);
for (const v of violations) console.log('  - ' + v);
process.exit(1);
