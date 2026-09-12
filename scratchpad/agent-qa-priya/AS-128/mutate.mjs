// AS-128 falsifier battery (qa-priya). In place, one mutant at a time: back up,
// apply, ASSERT the mutation landed exactly once at the intended site, run the
// counted suite (--build), record the red set, restore, prove the restore with
// git diff --exit-code. Usage: node mutate.mjs [M1 M2 ...]
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-128';
const APP = `${WT}/apps/invoicing`;
const COMPOSE = `${APP}/compose.yaml`;
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-128';

const TRY_BLOCK = /        let created;\n        try \{\n          created = repos\.clients\.create\(freelancerId, \{ name: clientName, email \}\);\n        \} catch \(err\) \{\n(?:          \/\/.*\n)*          if \(err instanceof ValidationError && err\.field === 'email'\) \{\n            return \w+\(res, \w+\(\{ \.\.\.base, clientEmailRefused: true \}\)\);\n          \}\n          throw err;\n        \}\n/g;

const MUTANTS = {
  M1: { file: 'routes/invoices.js', find: TRY_BLOCK, replace: '        const created = repos.clients.create(freelancerId, { name: clientName, email });\n', expect: ['S4-CLIENT-ERROR-VALIDATION (AS-128)'] },
  M2: { file: 'routes/invoices.js', find: /const email = clientEmail\.trim\(\);/g, replace: 'const email = clientEmail;', expect: ['add-client (AS-128) trims'] },
  M3: { file: 'routes/contracts.js', find: TRY_BLOCK, replace: '        const created = repos.clients.create(freelancerId, { name: clientName, email });\n', expect: ['S6-CLIENT-ERROR-VALIDATION (AS-128)'] },
  M4: { file: 'routes/contracts.js', find: /const email = clientEmail\.trim\(\);/g, replace: 'const email = clientEmail;', expect: ['add-client (AS-128) trims'] },
  M5: { file: 'lib/screens/invoice-form-view.js', find: /const clientEmailRefused = intent === 'add-client' && input\.clientEmailRefused === true;/g, replace: 'const clientEmailRefused = false;', expect: ['S4-CLIENT-ERROR-VALIDATION (AS-128)', 'clientEmailRefused (AS-128)'] },
  M6: { file: 'lib/screens/contract-form-view.js', find: /const clientEmailRefused = intent === 'add-client' && input\.clientEmailRefused === true;/g, replace: 'const clientEmailRefused = false;', expect: ['S6-CLIENT-ERROR-VALIDATION (AS-128)', 'clientEmailRefused (AS-128)'] },
};

const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const gitClean = () => sh('git', ['-C', WT, 'diff', '--exit-code', '--quiet']).status === 0;

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTANTS);
const results = [];
for (const id of wanted) {
  const m = MUTANTS[id];
  const path = `${APP}/${m.file}`;
  const bak = `${OUT}/${id}.${m.file.replace(/\//g, '_')}.bak`;
  if (!gitClean()) throw new Error(`${id}: worktree not clean before mutation`);
  copyFileSync(path, bak);
  const original = readFileSync(path, 'utf8');
  const hits = original.match(m.find) || [];
  if (hits.length !== 1) { unlinkSync(bak); throw new Error(`${id}: pattern occurs ${hits.length} times in ${m.file}, expected 1`); }
  const mutated = original.replace(m.find, m.replace);
  if (mutated === original) { unlinkSync(bak); throw new Error(`${id}: replace produced no change`); }
  writeFileSync(path, mutated);
  const restore = () => { copyFileSync(bak, path); };
  process.on('exit', restore);
  try {
    // Assert the mutation landed at the intended site: show the diff.
    const diff = sh('git', ['-C', WT, 'diff', '--', `apps/invoicing/${m.file}`]).stdout;
    writeFileSync(`${OUT}/${id}.mutation.diff`, diff);
    const changedFiles = sh('git', ['-C', WT, 'diff', '--name-only']).stdout.trim().split('\n');
    if (changedFiles.length !== 1 || changedFiles[0] !== `apps/invoicing/${m.file}`) throw new Error(`${id}: diff touches ${changedFiles}`);
    const r = sh(DOCKER, ['compose', '-p', 'asc-review-as128', '-f', COMPOSE, 'run', '--rm', '--build', 'test']);
    const log = (r.stdout || '') + (r.stderr || '');
    writeFileSync(`${OUT}/${id}.log`, log);
    const built = log.split('\n').some((l) => /Image asc-review-as128-test Built/.test(l));
    const summary = Object.fromEntries(log.split('\n').filter((l) => /^ℹ (tests|pass|fail) /.test(l)).map((l) => l.slice(2).split(' ')));
    const red = [...new Set(log.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l)).map((l) => l.slice(2).replace(/ \(\d+(\.\d+)?ms\)$/, '')))];
    const exact = red.length === m.expect.length && m.expect.every((e) => red.some((n) => n.startsWith(e)));
    results.push({ id, file: m.file, built, exit: r.status, tests: summary.tests, pass: summary.pass, fail: summary.fail, red, expect: m.expect, exact });
    console.log(JSON.stringify(results[results.length - 1]));
  } finally {
    restore();
    process.off('exit', restore);
    unlinkSync(bak);
    if (!gitClean()) throw new Error(`${id}: restore failed — worktree dirty`);
    console.log(`${id}: restored, git diff --exit-code clean`);
  }
}
writeFileSync(`${OUT}/mutation-results.json`, JSON.stringify(results, null, 2));
