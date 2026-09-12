#!/usr/bin/env node
// tools/lanes/compute-lane-metrics.mjs — AS-60 ships-clean criterion (e):
// measurement integrity. Computes every §9.1 quantity from event timestamps,
// cites the source event id per number, and hard-errors instead of ever
// fabricating a value.
//
// Instrumented quantities (plan §9.1, formulas verbatim):
//   dA1     = tA_kill  - tA_spawn        (lane A, tick T1, killed)
//   dB      = tB_return - tB_spawn       (lane B, tick T1, completed)
//   dA2     = tA2_return - tA2_spawn     (lane A resume, tick T2)
//   W_T1    = max(tA_kill, tB_return) - min(tA_spawn, tB_spawn)
//   overlap = max(0, min(tA_kill, tB_return) - max(tA_spawn, tB_spawn))
//   savings = dA1 + dB - W_T1
//   R       = savings / min(dA1, dB)
//   overhead= W_T1 - max(dA1, dB)
//   S0      = dA1 + dA2 + dB             (zero-gap serial baseline)
//   fanned  = W_T1 + dA2                 (fanned campaign cost)
//   identity: S0 - fanned == savings     (asserted as a self-check)
//   S_real  = S0 + median inter-transition gap (context only): gaps between
//             consecutive status_changed events company-wide in the 24h
//             ending at T2.end, gaps >= 60 min excluded (dead cadence is not
//             serial cost). The exact filter applied is printed.
//
// Markers are comment_added events on the lane tasks whose body starts with
// (exact strings — the orchestrator's trial comments must match):
//   "lanes-trial: lane spawned"   -> tA_spawn / tB_spawn / tA2_spawn
//   "lanes-trial: lane killed"    -> tA_kill
//   "lanes-trial: lane returned"  -> tB_return / tA2_return
// scoped by task (config lane A/B) and window (config windows T1/T2).
// Exactly one match per marker; zero or several is a hard FAIL — this script
// never guesses which event a number came from.
//
// Every marker is cross-checked against the orchestrator ledger: divergence
// from the nearest ledger entry > 60s is a hard FAIL (plan §7 row e).
//
// This script emits numbers; it applies NO verdict thresholds. The §9.2
// rulers are applied mechanically in the result document (phase 3), so the
// measurement tool stays reusable and verdict-free (plan §9.3).
//
// usage: compute-lane-metrics.mjs --config <trial-config.json> --ledger <file>
//                                 [--events <dir>]
// Config needs: windows.T1/{start,end}, windows.T2/{start,end} (recorded at
// trial time), and exactly one task with lane "A" and one with lane "B",
// each carrying task_id. Schema: tools/lanes/README.md.
//
// Output contract (plan §7): line 1 cardinality, line 2 PASS/FAIL, then the
// metric block (PASS) or "  - <reason>" items (FAIL). Exit 0/1/2.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

function usage(msg) {
  if (msg) console.error('error: ' + msg);
  console.error('usage: compute-lane-metrics.mjs --config <file> --ledger <file> [--events <dir>]');
  process.exit(2);
}

const args = process.argv.slice(2);
let eventsDir = join(process.cwd(), '.lattice', 'events');
let configPath = null;
let ledgerPath = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const val = () => {
    if (i + 1 >= args.length) usage(a + ' needs a value');
    return args[++i];
  };
  if (a === '--events') eventsDir = val();
  else if (a === '--config') configPath = val();
  else if (a === '--ledger') ledgerPath = val();
  else usage('unknown argument: ' + a);
}
if (!configPath) usage('--config is required');
if (!ledgerPath) usage('--ledger is required');

let cfg;
try {
  cfg = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (e) {
  usage('cannot read config ' + configPath + ': ' + e.message);
}

function windowOf(name) {
  const w = (cfg.windows || {})[name];
  if (!w || !w.start || !w.end) usage(`window ${name} not recorded in config (need start and end)`);
  const start = Date.parse(w.start);
  const end = Date.parse(w.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) usage(`window ${name} has unparseable timestamps`);
  if (start > end) usage(`window ${name} start after end`);
  return { start, end };
}
const T1 = windowOf('T1');
const T2 = windowOf('T2');

const laneEntries = Object.entries(cfg.tasks || {});
const lanes = {};
for (const [key, t] of laneEntries) {
  if (t.lane === 'A' || t.lane === 'B') {
    if (lanes[t.lane]) usage(`two tasks claim lane ${t.lane}: ${lanes[t.lane].key} and ${key}`);
    if (!t.task_id) usage(`lane ${t.lane} task ${key} has no task_id`);
    lanes[t.lane] = { key, task_id: t.task_id };
  }
}
if (!lanes.A) usage('no task with lane "A" in config');
if (!lanes.B) usage('no task with lane "B" in config');

let ledger;
try {
  ledger = readFileSync(ledgerPath, 'utf8').split('\n').filter((l) => l.trim());
} catch (e) {
  usage('cannot read ledger ' + ledgerPath + ': ' + e.message);
}
const ledgerTimes = [];
for (const line of ledger) {
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

let files;
try {
  files = readdirSync(eventsDir).filter((f) => /^task_.*\.jsonl$/.test(f)).sort();
} catch (e) {
  usage('cannot read events dir ' + eventsDir + ': ' + e.message);
}
const byTask = new Map();
let totalEvents = 0;
const allStatusChanged = [];
for (const f of files) {
  const taskId = f.replace(/\.jsonl$/, '');
  const events = [];
  for (const line of readFileSync(join(eventsDir, f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch (e) {
      usage(`bad JSONL in ${f}: ${line.slice(0, 80)}`);
    }
    events.push(ev);
    totalEvents++;
    if (ev.type === 'status_changed') allStatusChanged.push(ev);
  }
  const created = events.find((e) => e.type === 'task_created');
  byTask.set(taskId, { events, code: created && created.data && created.data.short_id ? created.data.short_id : taskId });
}
for (const lane of ['A', 'B']) {
  if (!byTask.has(lanes[lane].task_id)) usage(`no events file for lane ${lane} task_id ${lanes[lane].task_id}`);
}

// --- marker extraction: exactly one hit per marker, or hard FAIL ------------

const MARKERS = [
  { name: 'tA_spawn', lane: 'A', window: T1, windowName: 'T1', prefix: 'lanes-trial: lane spawned' },
  { name: 'tA_kill', lane: 'A', window: T1, windowName: 'T1', prefix: 'lanes-trial: lane killed' },
  { name: 'tB_spawn', lane: 'B', window: T1, windowName: 'T1', prefix: 'lanes-trial: lane spawned' },
  { name: 'tB_return', lane: 'B', window: T1, windowName: 'T1', prefix: 'lanes-trial: lane returned' },
  { name: 'tA2_spawn', lane: 'A', window: T2, windowName: 'T2', prefix: 'lanes-trial: lane spawned' },
  { name: 'tA2_return', lane: 'A', window: T2, windowName: 'T2', prefix: 'lanes-trial: lane returned' },
];

const violations = [];
const marks = {};
for (const m of MARKERS) {
  const task = byTask.get(lanes[m.lane].task_id);
  const hits = task.events.filter((ev) => {
    if (ev.type !== 'comment_added') return false;
    const body = ev.data && typeof ev.data.body === 'string' ? ev.data.body : '';
    if (!body.startsWith(m.prefix)) return false;
    const t = Date.parse(ev.ts);
    return Number.isFinite(t) && t >= m.window.start && t <= m.window.end;
  });
  const where = `("${m.prefix}" on ${task.code} in ${m.windowName})`;
  if (hits.length === 0) violations.push(`marker ${m.name} ${where}: not found`);
  else if (hits.length > 1) violations.push(`marker ${m.name} ${where}: ambiguous (${hits.length} found)`);
  else marks[m.name] = { id: hits[0].id, ts: hits[0].ts, ms: Date.parse(hits[0].ts) };
}

// S_real gap census is part of the cardinality line, so compute it up front.
const sRealLo = T2.end - 24 * 3600 * 1000;
const sRealEvents = allStatusChanged
  .map((ev) => ({ ev, ms: Date.parse(ev.ts) }))
  .filter((x) => Number.isFinite(x.ms) && x.ms >= sRealLo && x.ms <= T2.end)
  .sort((a, b) => a.ms - b.ms);
const gaps = [];
for (let i = 1; i < sRealEvents.length; i++) gaps.push(sRealEvents[i].ms - sRealEvents[i - 1].ms);
const qualifying = gaps.filter((g) => g < 3600000);
const excluded = gaps.length - qualifying.length;

const cardinality =
  `examined ${totalEvents} event(s) / ${files.length} task(s) / ${ledgerTimes.length} ledger line(s) / ` +
  `${sRealEvents.length} status_changed in S_real window`;

function fail() {
  console.log(cardinality);
  console.log(`FAIL: ${violations.length} violation(s)`);
  for (const v of violations) console.log('  - ' + v);
  process.exit(1);
}
if (violations.length) fail(); // missing/ambiguous markers: never fabricate.

// --- ledger cross-check: every marker within 60s of a ledger entry ----------

for (const m of MARKERS) {
  const mk = marks[m.name];
  if (!ledgerTimes.length) {
    violations.push(`marker ${m.name} (${mk.id}): event-vs-ledger divergence (ledger empty) > 60s`);
    continue;
  }
  let best = Infinity;
  for (const lt of ledgerTimes) {
    const d = Math.abs(lt - mk.ms);
    if (d < best) best = d;
  }
  if (best > 60000) violations.push(`marker ${m.name} (${mk.id}): event-vs-ledger divergence ${Math.round(best / 1000)}s > 60s`);
}
if (violations.length) fail();

// --- the §9.1 arithmetic, in ms; printed in minutes --------------------------

const min2 = (ms) => (ms / 60000).toFixed(2);
const dA1 = marks.tA_kill.ms - marks.tA_spawn.ms;
const dB = marks.tB_return.ms - marks.tB_spawn.ms;
const dA2 = marks.tA2_return.ms - marks.tA2_spawn.ms;
for (const [name, v] of [['dA1', dA1], ['dB', dB], ['dA2', dA2]]) {
  if (v <= 0) violations.push(`non-positive duration ${name} (${min2(v)} min)`);
}
if (violations.length) fail();

const pickExtreme = (cands, cmp) => cands.reduce((a, b) => (cmp(b.ms, a.ms) ? b : a));
const ends = [marks.tA_kill, marks.tB_return];
const starts = [marks.tA_spawn, marks.tB_spawn];
const maxEnd = pickExtreme(ends, (b, a) => b > a);
const minEnd = pickExtreme(ends, (b, a) => b < a);
const maxStart = pickExtreme(starts, (b, a) => b > a);
const minStart = pickExtreme(starts, (b, a) => b < a);

const W_T1 = maxEnd.ms - minStart.ms;
const rawOverlap = minEnd.ms - maxStart.ms;
const overlap = Math.max(0, rawOverlap);
const savings = dA1 + dB - W_T1;
const minLane = Math.min(dA1, dB);
const R = savings / minLane;
const overhead = W_T1 - Math.max(dA1, dB);
const S0 = dA1 + dA2 + dB;
const fanned = W_T1 + dA2;

// §9.1 self-check: savings must equal S0 - fanned (arithmetic identity).
if (Math.abs(S0 - fanned - savings) > 1e-6) {
  violations.push(`identity check failed: S0 - fanned = ${min2(S0 - fanned)} min != savings = ${min2(savings)} min`);
  fail();
}

const sRealFilter =
  `filter: status_changed company-wide, ts in ${new Date(sRealLo).toISOString()}..${new Date(T2.end).toISOString()} ` +
  `(24h ending at T2.end), consecutive gaps, gaps >= 60 min excluded, median`;
let sRealLine;
if (qualifying.length) {
  const sorted = [...qualifying].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  sRealLine =
    `S_real = ${min2(S0 + median)} min [S0 + median gap ${min2(median)} min; ` +
    `gaps used ${qualifying.length}, excluded >= 60 min: ${excluded}; ${sRealFilter}]`;
} else {
  sRealLine = `S_real = n/a [0 qualifying gaps (excluded >= 60 min: ${excluded}); ${sRealFilter}]`;
}

console.log(cardinality);
console.log('PASS: all metrics computed with event-id citations; ledger cross-check within 60s; identity holds');
for (const m of MARKERS) console.log(`${m.name} = ${marks[m.name].ts} [${marks[m.name].id}]`);
console.log(`dA1 = ${min2(dA1)} min [tA_kill - tA_spawn; ${marks.tA_kill.id}, ${marks.tA_spawn.id}]`);
console.log(`dB = ${min2(dB)} min [tB_return - tB_spawn; ${marks.tB_return.id}, ${marks.tB_spawn.id}]`);
console.log(`dA2 = ${min2(dA2)} min [tA2_return - tA2_spawn; ${marks.tA2_return.id}, ${marks.tA2_spawn.id}]`);
console.log(`W_T1 = ${min2(W_T1)} min [max(tA_kill, tB_return) - min(tA_spawn, tB_spawn) = ${maxEnd.id} - ${minStart.id}]`);
console.log(
  `overlap = ${min2(overlap)} min [min(tA_kill, tB_return) - max(tA_spawn, tB_spawn) = ${minEnd.id} - ${maxStart.id}, floored at 0]`,
);
console.log(`savings = ${min2(savings)} min [dA1 + dB - W_T1]`);
console.log(`R = ${R.toFixed(4)} [savings / min(dA1, dB); available parallelism = ${min2(minLane)} min]`);
console.log(`overhead = ${min2(overhead)} min [W_T1 - max(dA1, dB)]`);
console.log(`S0 = ${min2(S0)} min [dA1 + dA2 + dB; zero-gap serial baseline]`);
console.log(`fanned = ${min2(fanned)} min [W_T1 + dA2; fanned campaign cost]`);
console.log(`identity = OK [S0 - fanned = ${min2(S0 - fanned)} min = savings]`);
console.log(sRealLine);
process.exit(0);
