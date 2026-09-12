// AS-89 review mutants (Priya). Runs on a SCRATCH copy of the worktree's apps/chat,
// never in place. Each mutant: anchored replace, assert applied at the intended site,
// run the targeted test files, record the failing test names, restore.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-89/apps/chat';
const ROOT = mkdtempSync(join(tmpdir(), 'as89-mut-'));
const APP = join(ROOT, 'chat');
cpSync(SRC, APP, { recursive: true, filter: (p) => !p.includes('/data/') && !p.includes('node_modules') });

const TESTS = ['test/identities.test.js', 'test/api.test.js', 'test/cli.test.js', 'test/roster-parity.test.js'];
const IDS = join(APP, 'lib/identities.js');
const SRV = join(APP, 'server.js');
const CLI = join(APP, 'bin/chat.js');

function runTests() {
  const r = spawnSync(process.execPath, ['--test', ...TESTS], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = r.stdout + r.stderr;
  const fails = [...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]);
  const total = (out.match(/^ℹ tests (\d+)/m) || [])[1];
  return { total, fails: [...new Set(fails)] };
}

const mutants = [
  { id: 'M1/M2', file: SRV, from: /const root = repoRoot \|\| latticeRoot\(\);\n([\s\S]*?)const reconciled = reconcileIdentities\(\{ store, root \}\);/,
    to: (m, c) => `const root = repoRoot || latticeRoot();\n${c}const reconciled = { registered: [], existing: [], skipped: [], examined: 0 };`,
    expect: 'AC-1, AC-2, AC-3? no; {AC-1, AC-2, AC-6} + api ada pin' },
  { id: 'M3', file: IDS, from: /(export function reconcileIdentities[\s\S]*?)\.filter\(\(e\) => e\.status === 'active'\)/, to: (m, a) => `${a}.filter(() => true)`, expect: '{AC-3}' },
  { id: 'M4/M8', file: IDS, from: /(export function reconcileIdentities[\s\S]*?)if \(store\.getIdentity\(actorId\)\) \{/, to: (m, a) => `${a}if (null) {`, expect: '{AC-4, AC-8} (+AC-5 if throw uncaught)' },
  { id: 'M5', file: IDS, from: /(export function reconcileIdentities[\s\S]*?)try \{\n([\s\S]*?)\n    \} catch \(err\) \{\n[\s\S]*?\n    \}\n/, to: (m, a, body) => `${a}${body}\n`, expect: '{AC-5}' },
  { id: 'M6', file: IDS, from: /(export function reconcileIdentities[\s\S]*?)readPersonnel\(root\)\.roster/, to: (m, a) => `${a}(readdirSync(join(root, 'personnel')), readPersonnel(root).roster)`,
    pre: (s) => `import { readdirSync } from 'node:fs';\nimport { join } from 'node:path';\n` + s, expect: '{AC-6}' },
  { id: 'M7', file: CLI, from: /(function createDirectBackend\(dbPath\) \{[\s\S]*?)  reconcileIdentities\(\{ store, root \}\);\n/, to: (m, a) => a, expect: '{AC-7} + cli roster pin' },
  { id: 'M9', file: IDS, from: /(export function reconcileIdentities[\s\S]*?)for \(const entry of active\) \{\n    examined\+\+;/, to: (m, a) => `${a}for (const entry of active) {\n    examined += 2;`, expect: '{AC-1}' },
];

for (const m of mutants) {
  const orig = readFileSync(m.file, 'utf8');
  let mutated = orig.replace(m.from, m.to);
  if (m.pre) mutated = m.pre(mutated);
  if (mutated === orig || !m.from.test(orig)) { console.log(`${m.id}: NOT APPLIED`); continue; }
  const matches = orig.match(new RegExp(m.from.source, m.from.flags + 'g')) || [];
  writeFileSync(m.file, mutated);
  const { total, fails } = runTests();
  writeFileSync(m.file, orig);
  console.log(`${m.id}: applied (${matches.length} site) total=${total} killed=${fails.length > 0} expected=${m.expect}\n   red set: ${fails.join(' | ') || '(none — SURVIVOR)'}`);
}
const base = runTests();
console.log(`baseline after restore: total=${base.total} fails=${base.fails.length}`);
rmSync(ROOT, { recursive: true, force: true });
