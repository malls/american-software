// Bounded test runner for the AS-81 mutation battery.
// usage: node run.mjs <appRoot> <logName> <capSeconds> [testFile]
//
// It exists for three reasons the bare shell could not give me:
//  - a hard wall-clock cap, so a WEDGE is an observation ("no summary within
//    Ns") rather than a tool timeout with no record;
//  - the full transcript on disk, so the failing set is counted, not eyeballed;
//  - `ℹ tests/pass/fail` echoed alongside the ✖ names, so cardinality is
//    reported before quantification.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, logName, capS, testFile] = process.argv.slice(2);
const SP = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-81';
const cap = Number(capS) * 1000;

const args = ['--test'];
if (testFile) args.push(testFile);
const started = Date.now();
const child = spawn('node', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });

let verdict = null;
const killer = setTimeout(() => {
  verdict = 'WEDGED';
  child.kill('SIGKILL');
}, cap);

child.on('close', (code, signal) => {
  clearTimeout(killer);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  writeFileSync(join(SP, `${logName}.log`), out);

  // node repeats every ✖ name under its trailing "failing tests:" heading, so a
  // naive filter reports double the real cardinality. Cut there first.
  const all = out.split('\n');
  const headingAt = all.findIndex((l) => l.trim().endsWith('failing tests:'));
  const lines = headingAt === -1 ? all : all.slice(0, headingAt);
  const failed = lines.filter((l) => l.startsWith('✖ ')).map((l) => l.slice(2).replace(/ \([\d.]+ms\)$/, ''));
  const summary = lines.filter((l) => /^ℹ (tests|pass|fail|duration_ms)/.test(l));

  console.log(`=== ${logName} :: root=${root}${testFile ? ' file=' + testFile : ''}`);
  console.log(`exit=${code} signal=${signal} elapsed=${elapsed}s cap=${capS}s`);
  console.log(verdict === 'WEDGED'
    ? `VERDICT: WEDGED — no summary within ${capS}s, killed by the cap (summary present in output: ${/^ℹ tests/m.test(out)})`
    : `VERDICT: TERMINATED on its own in ${elapsed}s`);
  console.log(summary.length ? summary.join('\n') : '(no ℹ summary block emitted)');
  console.log(`failing tests (cardinality ${failed.length}):`);
  for (const f of failed) console.log(`  - ${f}`);
  console.log(`log: ${join(SP, logName + '.log')}`);
});
