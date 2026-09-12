// AS-121 review cycle 1 (developer-lena): host suite, counted compose receipt, and the M1–M4 mutants
// against the reworked bin (handler armed inside the exec wrapper on the run recipe only).
// Mutants are applied in place to the worktree's bin/compose-run.mjs with a backup, restored in
// `finally`, and each mutation is asserted to have applied before its run.
// Usage: node battery.mjs [host|compose|mutants|all]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company';
const W = `${ROOT}/.worktrees/AS-121`;
const CHAT = `${W}/apps/chat`;
const BIN = `${CHAT}/bin/compose-run.mjs`;
const S = `${ROOT}/scratchpad/agent-developer-lena/AS-121/cycle1`;
const D = JSON.parse(readFileSync(`${ROOT}/apps/chat/data/deploy-state.json`, 'utf8')).dockerBin;
const what = process.argv[2] || 'all';

const summary = (out) => {
  const c = (k) => { const m = new RegExp(`^(?:#|ℹ)\\s*${k} (\\d+)`, 'm').exec(out); return m ? m[1] : '?'; };
  return `tests=${c('tests')} pass=${c('pass')} fail=${c('fail')} skipped=${c('skipped')}`;
};
const failing = (out) => [...out.matchAll(/^\s*✖ (T\d+[a-z]?) /gm)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);

function hostSuite(label, files = []) {
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: CHAT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync(`${S}/${label}.log`, out);
  return { status: r.status, out };
}

if (what === 'host' || what === 'all') {
  const h = hostSuite('host-branch');
  console.log(`HOST branch: exit=${h.status} ${summary(h.out)} red=${JSON.stringify(failing(h.out))}`);
}

if (what === 'compose' || what === 'all') {
  const r = spawnSync(process.execPath, [BIN, '--project', 'asc-impl-as121', '--cwd', CHAT, '--log', `${S}/compose-impl-as121.log`], {
    encoding: 'utf8', env: { ...process.env, ADVANCE_DOCKER_BIN: D }, maxBuffer: 256 * 1024 * 1024,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync(`${S}/compose-impl-as121.receipt`, out);
  console.log(`COMPOSE exit=${r.status}\n${out.trim()}`);
}

if (what === 'mutants' || what === 'all') {
  const MUTANTS = [
    { id: 'M1', ac: 'AC-1', expect: ['T12a', 'T12b'],
      from: '      for (const sig of RUN_SIGNALS) process.on(sig, onSignal);\n',
      to: '      // M1: no handlers\n' },
    { id: 'M2', ac: 'AC-3', expect: ['T12a'],
      from: '  if (interrupted && result.exit === 0) result.exit = 128 + os.constants.signals[interrupted];\n',
      to: '  // M2: no 128+signum override\n' },
    { id: 'M3', ac: 'AC-2', expect: ['T12a', 'T12b'],
      from: '  await new Promise((r) => setImmediate(r));\n',
      to: '  // M3: no yield for the deferred handler\n' },
    // M4: the cycle-0 shape — handlers armed in main before runCounted (before the guard).
    { id: 'M4', ac: 'AC-4 / F1', expect: ['T12c'],
      from: '  const result = runCounted(armedExec(onSignal), {\n',
      to: '  for (const sig of RUN_SIGNALS) process.on(sig, onSignal); // M4: armed before the guard\n  const result = runCounted(exec, {\n' },
  ];
  const original = readFileSync(BIN, 'utf8');
  try {
    for (const m of MUTANTS) {
      if (!original.includes(m.from)) { console.log(`${m.id}: MUTATION SITE NOT FOUND — skipped`); continue; }
      const mutated = original.replace(m.from, m.to);
      writeFileSync(BIN, mutated);
      const now = readFileSync(BIN, 'utf8');
      const applied = now !== original && now.includes(m.to) && !now.includes(m.from);
      const r = hostSuite(`mutant-${m.id}`, ['test/compose-run.test.js']);
      const red = failing(r.out);
      const exact = JSON.stringify(red) === JSON.stringify(m.expect);
      console.log(`${m.id} (${m.ac}): applied=${applied} exit=${r.status} ${summary(r.out)} red=${JSON.stringify(red)} expected=${JSON.stringify(m.expect)} ${exact ? 'EXACT' : 'DIFFERS'}`);
      writeFileSync(BIN, original);
    }
  } finally {
    writeFileSync(BIN, original);
  }
  const diff = spawnSync('git', ['-C', W, 'diff', '--exit-code', '--', 'apps/chat/bin/compose-run.mjs'], { encoding: 'utf8' });
  console.log(`restore check: git diff --exit-code -> ${diff.status}`);
  const h = hostSuite('host-branch-after-mutants', ['test/compose-run.test.js']);
  console.log(`post-restore compose-run.test.js: exit=${h.status} ${summary(h.out)} red=${JSON.stringify(failing(h.out))}`);
}
