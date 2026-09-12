// qa-priya AS-106 review: M11 — in the SCRATCH copy of bin/compose-run.mjs, the `down`
// argv becomes `stop` (the plan's wording). Applied inside the script's exec wrapper so the
// lib (and T4's argv pin) stays intact and the predicted red set is exactly {T11}.
// Asserts the mutation applied at the intended site, runs T11 for real (AS106_REAL=1) in the
// scratch copy, records the red set, restores byte-identical, then proves with the real docker
// that the mutant's project left nothing behind (the test's own t.after runs the correct down;
// a hand `down` is run as well and the listing printed).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const D = '/usr/local/bin/docker';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-106/apps/chat';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-106/scratch/apps/chat';
const path = `${S}/bin/compose-run.mjs`;
const original = readFileSync(`${W}/bin/compose-run.mjs`, 'utf8');
if (readFileSync(path, 'utf8') !== original) throw new Error('scratch bin not pristine');

const find = /const exec = \(argv, opts = \{\}\) => \{\n  const \[bin, \.\.\.args\] = argv;\n/;
const matches = original.match(new RegExp(find.source, 'g')) || [];
if (matches.length !== 1) throw new Error(`M11 pattern matched ${matches.length} times`);
const mutated = original.replace(find, (m) => m + "  if (args[0] === 'compose' && args[3] === 'down') args.splice(3, args.length - 3, 'stop'); // M11\n");
writeFileSync(path, mutated);
if (readFileSync(path, 'utf8') !== mutated) throw new Error('M11 did not apply');
const changed = mutated.split('\n').filter((l, i) => original.split('\n')[i] !== l)[0];
console.log(`M11 applied; first changed line: ${JSON.stringify(changed)}`);

const list = (project) => ({
  nets: spawnSync(D, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}_`)),
  imgs: spawnSync(D, ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}-`)),
});
let project = null;
try {
  const r = spawnSync(process.execPath, ['--test', 'test/compose-run.test.js'], {
    cwd: S, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, AS106_REAL: '1', ADVANCE_DOCKER_BIN: D, FORCE_COLOR: '0' },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-106/mutant-M11.log', out);
  const red = [...new Set(out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/ \(\d+(\.\d+)?ms\)$/, '')))];
  const sum = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l)).join(' | ');
  const pm = /asc-as106-real-\d+/.exec(out);
  project = pm ? pm[0] : `asc-as106-real-<unknown>`;
  console.log(`suite (compose-run.test.js only): ${sum}\nred set: ${JSON.stringify(red)}\nstatus=${r.status}`);
  const why = out.split('\n').filter((l) => /LEAK|leak check|AssertionError|expected|actual|\+ |- /.test(l)).slice(0, 12);
  console.log(`failure detail:\n  ${why.join('\n  ')}`);
} finally {
  writeFileSync(path, original);
  if (readFileSync(path, 'utf8') !== original) throw new Error('restore failed');
  console.log('restored: scratch bin byte-identical to worktree');
}
console.log(`after test (t.after ran the correct down): ${project} -> ${JSON.stringify(list(project))}`);
const down = spawnSync(D, ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { encoding: 'utf8', cwd: S });
console.log(`hand down exit=${down.status} ${(down.stderr || '').trim().split('\n').slice(-2).join(' / ')}`);
console.log(`after hand down: ${JSON.stringify(list(project))}`);
