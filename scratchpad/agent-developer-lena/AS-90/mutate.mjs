// Scratch mutant runner (in place, under a restore-in-finally + signal trap).
// node mutate.mjs <name>   — runs one named mutant, restores, proves the tree.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-90';
const APP = join(WT, 'apps/invoicing');

const MUTANTS = {
  // AC-1: the reconciliation guard stops the chain at step 9.
  'ac1-1500': {
    file: 'demo/run.mjs',
    find: "const LINE_ITEM = { description: 'Website redesign — milestone 1', quantity: 1, unitAmountMinor: 1000 };",
    replace: "const LINE_ITEM = { description: 'Website redesign — milestone 1', quantity: 1, unitAmountMinor: 1500 };",
    service: 'demo',
    expectExit: 1,
    expectOut: /STOPPED at step 9: expected 303, got 409 \(AmountMismatchError: reconcile\)/,
  },
  // AC-8: a forbidden endpoint in the SEQUENCE is refused by the custody guard before any transport call.
  'ac8-charges': {
    file: 'demo/run.mjs',
    find: 'const SEQUENCE = [\n  {\n    n: \'1\',',
    replace: "const SEQUENCE = [\n  { n: '0', title: 'Charge (mutant)', label: LABEL.app, why: 'mutant', async run() { await stripe.request({ method: 'POST', path: '/v1/charges', platform: true }); return []; } },\n  {\n    n: '1',",
    service: 'demo',
    expectExit: 1,
    expectOut: /STOPPED at step 0: StripeCustodyError: /,
  },
  // AC-9a: dropping the COPY turns deploy-shape red.
  'ac9-copy': {
    file: 'Dockerfile',
    find: 'COPY apps/invoicing/demo ./demo\n',
    replace: '',
    service: 'test',
    expectExit: 1,
    expectOut: /not ok/,
  },
  // AC-9b: app source importing from demo/ turns the closed-world case red (a never-called dynamic import: inert at runtime, visible to the scan).
  'ac9-import': {
    file: 'lib/health.js',
    find: "export function",
    replace: "export const mutantDemoImport = () => import('../demo/run.mjs');\nexport function",
    once: 'first', // health.js has several exports; anchor to the FIRST `export function` and assert the specifier landed exactly once
    service: 'test',
    expectExit: 1,
    expectOut: /not ok/,
  },
};

const name = process.argv[2];
const m = MUTANTS[name];
if (!m) { console.error(`unknown mutant ${name}; known: ${Object.keys(MUTANTS).join(', ')}`); process.exit(2); }

const path = join(APP, m.file);
const original = readFileSync(path, 'utf8');
let mutated;
if (m.once === 'first') {
  const i = original.indexOf(m.find);
  if (i < 0) throw new Error('anchor not found');
  mutated = original.slice(0, i) + m.replace + original.slice(i + m.find.length);
  const landed = mutated.split("import('../demo/run.mjs')").length - 1;
  if (landed !== 1) throw new Error(`specifier landed ${landed} times, expected 1`);
} else {
  const n = original.split(m.find).length - 1;
  if (n !== 1) throw new Error(`pattern occurs ${n} times in ${m.file}, expected exactly 1 — refusing to mutate`);
  mutated = original.replace(m.find, m.replace);
}
if (mutated === original) throw new Error('mutation is a no-op');

const restore = () => { writeFileSync(path, original); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { restore(); process.exit(130); });

let result;
try {
  writeFileSync(path, mutated);
  // assert applied at the intended site
  const onDisk = readFileSync(path, 'utf8');
  if (onDisk !== mutated) throw new Error('mutation did not apply');
  if (m.once !== 'first' && onDisk.split(m.replace).length - 1 < 1) throw new Error('replacement text not on disk');
  console.log(`[${name}] mutation applied to ${m.file} (${original.length} -> ${onDisk.length} bytes)`);
  result = spawnSync('/usr/local/bin/docker', ['compose', '-p', 'asc-inv-as90', 'run', '--rm', '--build', m.service], {
    cwd: APP,
    env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} finally {
  restore();
}
const restored = readFileSync(path, 'utf8');
console.log(`[${name}] restored byte-identical: ${restored === original}`);
writeFileSync(join(here, `mutant-${name}.log`), result.stdout ?? '');
writeFileSync(join(here, `mutant-${name}.err`), result.stderr ?? '');
const built = (result.stderr ?? '').split('\n').filter((l) => /Image .* Built/.test(l)).map((l) => l.trim());
console.log(`[${name}] exit=${result.status} (expected ${m.expectExit}) built: ${built.join(' | ') || '(none)'}`);
console.log(`[${name}] expected output present: ${m.expectOut.test(result.stdout ?? '')}`);
const out = result.stdout ?? '';
const failing = out.split('\n').filter((l) => /^not ok/.test(l) || /^STOPPED/.test(l));
console.log(`[${name}] red set (${failing.length}):\n${failing.map((l) => '  ' + l).join('\n')}`);
const summary = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l));
if (summary.length) console.log(summary.map((l) => '  ' + l).join('\n'));
const diff = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--stat'], { encoding: 'utf8' });
console.log(`[${name}] git diff --exit-code: ${diff.status === 0 ? 'clean' : 'DIRTY\n' + diff.stdout}`);
