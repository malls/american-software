// AS-100 row-2 (CLI) mutation battery — same harness as mutants-row1.mjs.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat';

const MUTANTS = [
  ['M9 AC-4 CLI accepts cut_by_timeout', 'bin/events.js',
    "const CLI_STAGE_OUTCOMES = ['completed', 'error'];",
    "const CLI_STAGE_OUTCOMES = ['completed', 'error', 'cut_by_timeout'];",
    'events-cli-rejects-cut'],
  ['M10 AC-5 unresolved short id exits 1', 'bin/events.js',
    "    if (!id) process.stderr.write(`warning: ${short} does not resolve to a Lattice task; emitting with task_id: null\\n`);",
    "    if (!id) { process.stderr.write(`warning: ${short} unresolved\\n`); process.exit(1); }",
    'events-cli-unresolved-task-still-emits'],
  ['M11 AC-19 appendEvent stops creating the directory', 'lib/events.js',
    '  mkdir(dirname(path), { recursive: true });\n', '',
    'events-cli-creates-dir'],
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
  lines.push(`${name}\n  expect red: ${expect}\n  observed red: ${[...new Set(red)].join(', ') || 'NONE — SURVIVOR'}\n  ${counts}`);
  rmSync(dir, { recursive: true, force: true });
}
const report = lines.join('\n\n');
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/developer-lena/mutants-row2.log', `${report}\n`);
console.log(report);
