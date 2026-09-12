// AS-89 mutant battery. Each mutant: fresh scratch copy of the worktree's
// apps/chat, one anchored replacement asserted to match exactly once at the
// intended site, then the relevant test files; report the exact red set.
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-89/apps/chat';
const SCRATCH = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-89/mutant-copy';
const CORE = ['test/identities.test.js', 'test/cli.test.js', 'test/roster-parity.test.js'];

const MUTANTS = [
  {
    id: 'M1/M2', file: 'server.js',
    // anchor: the call directly after `const root = repoRoot || latticeRoot();`
    re: /(const root = repoRoot \|\| latticeRoot\(\);[\s\S]*?)const reconciled = reconcileIdentities\(\{ store, root \}\);/,
    to: '$1const reconciled = { registered: [], existing: [], skipped: [], examined: 0 };',
    tests: [...CORE, 'test/api.test.js'],
    predicted: '{AC-1, AC-2, AC-6} + api ada pin (4)',
  },
  {
    id: 'M3', file: 'lib/identities.js',
    re: /(export function reconcileIdentities[\s\S]*?)\.filter\(\(e\) => e\.status === 'active'\)/,
    to: '$1', tests: CORE, predicted: '{AC-3} (1)',
  },
  {
    id: 'M4/M8', file: 'lib/identities.js',
    re: /(export function reconcileIdentities[\s\S]*?)if \(store\.getIdentity\(actorId\)\) \{/,
    to: '$1if (null) {', tests: CORE, predicted: '{AC-4, AC-8} (2) — or {AC-4, AC-5} if the throw is uncaught',
  },
  {
    id: 'M5', file: 'lib/identities.js',
    re: /(export function reconcileIdentities[\s\S]*?)try \{\n([\s\S]*?)\n    \} catch \(err\) \{\n      skipped\.push\(\{ actorId, reason: err\?\.message \?\? String\(err\) \}\);\n    \}/,
    to: '$1{\n$2\n    }', tests: CORE, predicted: '{AC-5} (1)',
  },
  {
    id: 'M6', file: 'lib/identities.js',
    re: /(export function reconcileIdentities[\s\S]*?)readPersonnel\(root\)\.roster/,
    to: "$1(readdirSync(join(root, 'personnel')), readPersonnel(root).roster)",
    prelude: "import { readdirSync } from 'node:fs';\nimport { join } from 'node:path';\n",
    tests: CORE, predicted: '{AC-6} (1)',
  },
  {
    id: 'M7', file: 'bin/chat.js',
    re: /(function createDirectBackend\(dbPath\) \{[\s\S]*?)  reconcileIdentities\(\{ store, root \}\);\n/,
    to: '$1', tests: CORE, predicted: '{AC-7} + cli roster pin (2); roster-parity green',
  },
  {
    id: 'M9', file: 'lib/identities.js',
    re: /(export function reconcileIdentities[\s\S]*?)  for \(const entry of active\) \{\n    examined\+\+;/,
    to: '$1  examined++;\n  for (const entry of active) {\n    examined++;', tests: CORE, predicted: '{AC-1} (1)',
  },
];

for (const m of MUTANTS) {
  rmSync(SCRATCH, { recursive: true, force: true });
  cpSync(SRC, SCRATCH, { recursive: true, filter: (p) => !p.includes('/data/') && !p.includes('node_modules') });
  const path = `${SCRATCH}/${m.file}`;
  const before = readFileSync(path, 'utf8');
  const matches = before.match(new RegExp(m.re.source, 'g')) ?? [];
  if (matches.length !== 1) { console.log(`${m.id}: ABORT — pattern matched ${matches.length} times`); continue; }
  let after = before.replace(m.re, m.to);
  if (m.prelude) after = m.prelude + after;
  if (after === before) { console.log(`${m.id}: ABORT — mutation did not apply`); continue; }
  writeFileSync(path, after);
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...m.tests.map((t) => `${SCRATCH}/${t}`)], { encoding: 'utf8' });
  const out = run.stdout + run.stderr;
  const red = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((x) => x[1]);
  const total = out.match(/^# tests (\d+)/m)?.[1];
  const fail = out.match(/^# fail (\d+)/m)?.[1];
  console.log(`\n== ${m.id} (${m.file}) predicted ${m.predicted}\n   ran ${total}, red ${fail}:`);
  for (const r of red) console.log(`   - ${r}`);
  if (red.length === 0) console.log('   SURVIVED');
}
rmSync(SCRATCH, { recursive: true, force: true });
