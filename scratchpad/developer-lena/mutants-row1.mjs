// AS-100 row-1 mutation battery. Scratch copies only; the task worktree is
// never mutated. Each mutant asserts its pattern occurs EXACTLY ONCE (the
// AS-95 sharpening: a mutation that lands at the wrong site looks identical to
// a weak guard from the outside) before the suite is run.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat';

const MUTANTS = [
  ['M1 AC-1 drop schema_version', 'lib/events.js', '    schema_version: SCHEMA_VERSION,\n', '', 'events-envelope-keys'],
  ['M2 AC-1 readTaskEvents keeps a private loop', 'lib/lattice.js',
    '    for (const ev of parseJsonl(text).events) events.push(ev);',
    "    for (const line of text.split('\\n')) { if (!line.trim()) continue; try { const ev = JSON.parse(line); if (ev && ev.id) events.push(ev); } catch { /* skip */ } }",
    'lattice-events-share-parser'],
  ['M3 AC-2 no same-ms increment', 'lib/events.js',
    '    lastRand = lastRand >= RAND_MAX ? 0n : lastRand + 1n;', '    lastRand = lastRand;', 'events-id-monotonic'],
  ['M4 AC-3 writer stops terminating its line', 'lib/events.js',
    '  const line = `${serialiseEvent(ev)}\\n`;', '  const line = `${serialiseEvent(ev)}`;', 'events-append-only'],
  ['M5 AC-3 a truncating writer appears in the module', 'lib/events.js',
    '  mkdir(dirname(path), { recursive: true });',
    '  if (bytes < 0) writeFileSync(path, line);\n  mkdir(dirname(path), { recursive: true });',
    'events-no-truncating-path'],
  ['M6 AC-6 timeout reported as error', 'lib/events.js',
    "  if (timedOut) return 'timeout';", "  if (timedOut) return 'error';", 'watcher-events-outcome-timeout'],
  ['M7 AC-15 liveness bound doubled', 'lib/events.js',
    '    const alive = open && (tickLive || ageMs < tickTimeoutMs);',
    '    const alive = open && (tickLive || ageMs < 2 * tickTimeoutMs);', 'events-liveness-bound'],
  ['M8 AC-15 reducer ignores the spawned sub-agent', 'lib/events.js',
    '    const startedAt = sub ? sub.ts : lane.stage.ts;', '    const startedAt = lane.stage.ts;', 'events-liveness-shapes'],
];

const lines = [];
for (const [name, file, from, to, expect] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'as100-mutant-'));
  cpSync(SRC, dir, { recursive: true });
  const path = join(dir, file);
  const src = readFileSync(path, 'utf8');
  const hits = src.split(from).length - 1;
  if (hits !== 1) {
    lines.push(`${name}: SITE ERROR — pattern occurs ${hits} times, need exactly 1. NOT A GUARD RESULT.`);
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  const mutated = src.replace(from, to);
  writeFileSync(path, mutated);
  const back = readFileSync(path, 'utf8');
  const applied = back !== src && (to === '' ? !back.includes(from) : back.includes(to));
  if (!applied) {
    lines.push(`${name}: MUTATION DID NOT LAND. NOT A GUARD RESULT.`);
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  const res = spawnSync('node', ['--test'], { cwd: dir, encoding: 'utf8' });
  const out = `${res.stdout}${res.stderr}`;
  const red = [...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]).filter((n) => !/^test at /.test(n));
  const counts = (out.match(/ℹ (tests|pass|fail) \d+/g) ?? []).join(' ');
  lines.push(`${name}\n  expect red: ${expect}\n  observed red: ${red.length ? red.join(', ') : 'NONE — SURVIVOR'}\n  ${counts}`);
  rmSync(dir, { recursive: true, force: true });
}
const report = lines.join('\n\n');
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/developer-lena/mutants-row1.log', `${report}\n`);
console.log(report);
