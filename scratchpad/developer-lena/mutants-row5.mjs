// AS-100 AC-16 mutant — same harness as mutants-row1.mjs.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat';
const MUTANTS = [
  ['M12 AC-16 a top-level lastEvent is added to the lane card', 'lib/lanes.js',
    '      stageStartedAt: live(key)?.stageStartedAt ?? null,',
    '      stageStartedAt: live(key)?.stageStartedAt ?? null,\n      lastEvent: live(key)?.subAgent?.lastEvent ?? null,',
    'lanes-liveness-shape-unchanged + AS-99 api-lanes-key-whitelist'],
  ['M13 AC-16 liveness is smeared across every lane instead of joined on key', 'lib/lanes.js',
    '  const live = (key) => (liveness && key && liveness[key]) || null;',
    '  const live = () => (liveness && Object.values(liveness)[0]) || null;',
    'lanes-liveness-shape-unchanged'],
];

const lines = [];
for (const [name, file, from, to, expect] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'as100-mutant-'));
  cpSync(SRC, dir, { recursive: true });
  const path = join(dir, file);
  const src = readFileSync(path, 'utf8');
  const hits = src.split(from).length - 1;
  if (hits !== 1) {
    lines.push(`${name}: SITE ERROR — pattern occurs ${hits} times. NOT A GUARD RESULT.`);
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  writeFileSync(path, src.replace(from, to));
  if (!readFileSync(path, 'utf8').includes(to)) {
    lines.push(`${name}: MUTATION DID NOT LAND. NOT A GUARD RESULT.`);
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  const res = spawnSync('node', ['--test'], { cwd: dir, encoding: 'utf8' });
  const out = `${res.stdout}${res.stderr}`;
  const red = [...new Set([...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]).filter((n) => !/^test at /.test(n)))];
  const counts = (out.match(/ℹ (tests|pass|fail) \d+/g) ?? []).join(' ');
  lines.push(`${name}\n  expect red: ${expect}\n  observed red: ${red.join(' | ') || 'NONE — SURVIVOR'}\n  ${counts}`);
  rmSync(dir, { recursive: true, force: true });
}
const report = lines.join('\n\n');
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/developer-lena/mutants-row5.log', `${report}\n`);
console.log(report);
