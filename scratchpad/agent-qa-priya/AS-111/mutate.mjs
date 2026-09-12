// AS-111 review mutation driver (qa-priya). Runs on the SCRATCH copy only.
// usage: node mutate.mjs <M1..M11|all>
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-111/scratch/apps/chat';
const F = {
  server: `${ROOT}/server.js`,
  lib: `${ROOT}/lib/events.js`,
  bin: `${ROOT}/bin/events.js`,
  lanes: `${ROOT}/public/lanes.js`,
};
// scratch baseline artifact: deploy-shape needs git ls-files, scratch has no .git
const BASELINE_RED = new Set(['deploy-shape: every tracked path under apps/chat is an image input or declared not one']);

function pristine(file) { return `${file}.pristine`; }
for (const f of Object.values(F)) if (!existsSync(pristine(f))) copyFileSync(f, pristine(f));

/** Replace exactly `count` occurrences of `from` inside the region delimited by
 *  `anchorStart`..`anchorEnd` (both must be unique in the file). */
function mutate(file, { anchorStart, anchorEnd, from, to, count = 1 }) {
  const src = readFileSync(pristine(file), 'utf8');
  const a = src.indexOf(anchorStart);
  if (a === -1 || src.indexOf(anchorStart, a + 1) !== -1) throw new Error(`anchorStart not unique: ${anchorStart}`);
  const b = src.indexOf(anchorEnd, a);
  if (b === -1) throw new Error(`anchorEnd not found after anchorStart: ${anchorEnd}`);
  const region = src.slice(a, b);
  const n = region.split(from).length - 1;
  if (n !== count) throw new Error(`expected ${count} site(s) in region, found ${n}: ${JSON.stringify(from).slice(0, 80)}`);
  const mutated = src.slice(0, a) + region.split(from).join(to) + src.slice(b);
  if (mutated === src) throw new Error('mutation produced no change');
  writeFileSync(file, mutated);
  const line = src.slice(0, a + region.indexOf(from)).split('\n').length;
  return line;
}

const MUTANTS = {
  M1: () => {
    // readEvents: task filter BEFORE since resolution (pre-b0763ad ordering)
    const src = readFileSync(pristine(F.server), 'utf8');
    const start = src.indexOf('  function readEvents(');
    const sinceAt = src.indexOf('    if (since) {', start);
    const taskLine = '    if (task) events = events.filter((ev) => ev && ev.data && ev.data.task === task);\n';
    const taskAt = src.indexOf(taskLine, sinceAt);
    if (start === -1 || sinceAt === -1 || taskAt === -1) throw new Error('M1 anchors');
    const sinceBlock = src.slice(sinceAt, taskAt);
    const mutated = src.slice(0, sinceAt) + taskLine + sinceBlock + src.slice(taskAt + taskLine.length);
    writeFileSync(F.server, mutated);
    return src.slice(0, sinceAt).split('\n').length;
  },
  M2: () => mutate(F.server, { anchorStart: 'const lanesKey = (p) =>', anchorEnd: 'const loopStateKey', from: '        reason: p.events.reason,\n', to: '        reason: p.events.reason,\n        lastId: p.events.lastId,\n' }),
  M3: () => mutate(F.server, { anchorStart: 'const lanesKey = (p) =>', anchorEnd: 'const loopStateKey', from: '        reason: p.events.reason,\n', to: '        reason: p.events.reason,\n        malformed: p.events.malformed,\n' }),
  M4: () => mutate(F.server, { anchorStart: 'const lanesKey = (p) =>', anchorEnd: 'const loopStateKey', from: '        reason: p.events.reason,\n', to: '' }),
  M5: () => mutate(F.server, { anchorStart: '  function tailEvents() {', anchorEnd: '  function eventsStreamInfo', from: "    if (eventsTail.ino !== null && ino !== eventsTail.ino) {\n      resetTail('replaced');\n      restarted = 'replaced';\n    }\n", to: '' }),
  M6: () => mutate(F.server, { anchorStart: '  function tailEvents() {', anchorEnd: '  function eventsStreamInfo', from: "        if (window.length > 0 && eventsTail.offset >= window.length) {\n          const seen = Buffer.alloc(window.length);\n          const got = readSync(fd, seen, 0, window.length, eventsTail.offset - window.length);\n          if (got !== window.length || !seen.equals(window)) {\n            resetTail('replaced');\n            restarted = 'replaced';\n            eventsTail.ino = ino;\n          }\n        }\n", to: '' }),
  M7: () => mutate(F.server, { anchorStart: '  function tailEvents() {', anchorEnd: '  function eventsStreamInfo', from: "resetTail('replaced');", to: "resetTail('truncated');", count: 2 }),
  M8: () => mutate(F.lanes, { anchorStart: 'export const EVENTS_REASONS', anchorEnd: '});', from: "  replaced:\n    'the company event stream file was swapped out underneath the server — rotated or restored — and has been ' +\n    're-read from the start; nothing is missing, but the live frames from before the swap may repeat',\n", to: '' }),
  M9: () => mutate(F.lib, { anchorStart: 'function matches(open, ev, idKey)', anchorEnd: 'function lastEventOf', from: '  if (ev.data?.cycle != null && open.cycle != null && ev.data.cycle !== open.cycle) return false;\n', to: '' }),
  M10: () => mutate(F.bin, { anchorStart: 'function closing(path, type, data)', anchorEnd: 'function buildData', from: '\n    && !(data.cycle != null && item.cycle != null && data.cycle !== item.cycle)', to: '' }),
  M11: () => mutate(F.lib, { anchorStart: 'function matches(open, ev, idKey)', anchorEnd: 'function lastEventOf', from: '  if (ev.data?.cycle != null && open.cycle != null && ev.data.cycle !== open.cycle) return false;\n', to: '  if (ev.data?.cycle !== open.cycle) return false;\n' }),
};

function restore() { for (const f of Object.values(F)) copyFileSync(pristine(f), f); }

function run(name) {
  restore();
  const line = MUTANTS[name]();
  // show the mutated diff (assert-applied, at the site)
  const diffs = Object.values(F).map((f) => spawnSync('diff', ['-u', pristine(f), f], { encoding: 'utf8' }).stdout).filter(Boolean);
  if (!diffs.length) throw new Error(`${name}: no diff after mutation`);
  console.log(`\n===== ${name} (first site at pristine line ${line}) =====`);
  console.log(diffs.join('\n'));
  const r = spawnSync('node', ['--test'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  const summary = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map((k) => [k, Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1])]));
  const failing = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]);
  const red = [...new Set(failing)].filter((n) => !BASELINE_RED.has(n));
  console.log(`${name}: ${JSON.stringify(summary)}\n${name} RED (excluding scratch baseline artifact):\n${red.map((x) => `  - ${x}`).join('\n') || '  (none — SURVIVOR)'}`);
  restore();
  return { name, summary, red };
}

const which = process.argv[2] === 'all' ? Object.keys(MUTANTS) : process.argv.slice(2);
const results = [];
for (const m of which) results.push(run(m));
restore();
console.log('\n===== SUMMARY =====');
for (const r of results) console.log(`${r.name}: ${r.red.length} red — ${r.red.map((x) => x.split(':')[0]).join(', ') || 'SURVIVOR'}`);
