// AS-85 mutation battery — runs in a scratch copy OUTSIDE the scanned tree.
// usage: node battery.mjs [mutantName ...]   (no args = all)
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-85/apps/chat';
const SCRATCH = '/tmp/as85-scratch';
const OUTDIR = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-85';
const ANCHOR = 'build: { id: s.build.id, desiredId: s.build.desiredId, current: s.build.current, reason: s.build.reason },';
const SERVER = `${SCRATCH}/server.js`;
const STREAM = `${SCRATCH}/test/stream.test.js`;

const count = (text, needle) => text.split(needle).length - 1;

const mutants = {
  baseline: { file: null },
  M1_checkedAt: { file: SERVER, from: ANCHOR, to: ANCHOR.replace('reason: s.build.reason', 'reason: s.build.reason, checkedAt: s.build.checkedAt') },
  M2_no_current: { file: SERVER, from: ANCHOR, to: ANCHOR.replace(', current: s.build.current', '') },
  M3_no_desiredId: { file: SERVER, from: ANCHOR, to: ANCHOR.replace('desiredId: s.build.desiredId, ', '') },
  M4_no_reason: { file: SERVER, from: ANCHOR, to: ANCHOR.replace(', reason: s.build.reason', '') },
  M5_null: { file: SERVER, from: ANCHOR, to: 'build: null,' },
  // F1: Test A booted without buildId — anchor on the shared boot opts (both tests use it; plan says B identical if applied)
  F1_no_buildId: { file: STREAM, from: 'eventsPollMs: 60_000, buildId: BUILD_ID,', to: 'eventsPollMs: 60_000,' },
  // F2: churn loop writes the SAME computedAt each time (anchored on the loop's fresh-computedAt line)
  F2_same_computedAt: { file: STREAM, from: 'computedAt: new Date(Date.now() + i + 1).toISOString(),', to: 'computedAt: firstCheckedAt,' },
  // R10 recipe from the task description = M1 on this branch; extra: id alone removed (plan does not name it; M6)
  X1_no_id: { file: SERVER, from: ANCHOR, to: ANCHOR.replace('id: s.build.id, ', '') },
};

function fresh() {
  rmSync(SCRATCH, { recursive: true, force: true });
  cpSync(SRC, SCRATCH, { recursive: true });
}

function runSuite(name) {
  const files = readdirSync(`${SCRATCH}/test`).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);
  const r = spawnSync('node', ['--test', ...files], { cwd: SCRATCH, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  const out = r.stdout + r.stderr;
  writeFileSync(`${OUTDIR}/run-${name}.txt`, `# files=${files.length}\n` + out + `\n# exit=${r.status}\n`);
  const tally = { files: files.length };
  for (const k of ['tests', 'pass', 'fail', 'skipped', 'cancelled']) {
    const m = out.match(new RegExp(`^[#ℹ] ${k} (\\d+)`, 'm'));
    tally[k] = m ? Number(m[1]) : null;
  }
  // failing test names: node --test spec reporter prints "✖ <name>" lines (and "not ok" in tap)
  const fails = [...new Set(out.split('\n').filter((l) => /^\s*✖ /.test(l) || /^not ok/.test(l)).map((l) => l.replace(/^\s*✖ /, '').replace(/ \(\d+(\.\d+)?ms\)$/, '').trim()))];
  return { exit: r.status, tally, fails };
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(mutants);
const results = {};
for (const name of names) {
  const m = mutants[name];
  fresh();
  let applied = null;
  if (m.file) {
    const before = readFileSync(m.file, 'utf8');
    const nBefore = count(before, m.from);
    if (nBefore !== 1) { results[name] = { error: `anchor count ${nBefore} != 1, mutation NOT applied` }; console.log(name, results[name]); continue; }
    const after = before.replace(m.from, m.to);
    writeFileSync(m.file, after);
    const check = readFileSync(m.file, 'utf8');
    applied = { anchorBefore: nBefore, anchorAfter: count(check, m.from), mutantPresent: count(check, m.to) };
    if (applied.anchorAfter !== 0 || applied.mutantPresent < 1) { results[name] = { error: 'mutation did not apply', applied }; console.log(name, results[name]); continue; }
    // record the diff of the mutated file so the site can be re-read
    const d = spawnSync('diff', ['-u', `${SRC}/${m.file.slice(SCRATCH.length + 1)}`, m.file], { encoding: 'utf8' });
    writeFileSync(`${OUTDIR}/mutant-${name}.diff`, d.stdout);
  }
  const r = runSuite(name);
  results[name] = { applied, ...r };
  console.log(JSON.stringify({ name, ...results[name] }));
}
writeFileSync(`${OUTDIR}/battery-results.json`, JSON.stringify(results, null, 2));
fresh(); // leave scratch pristine
rmSync(SCRATCH, { recursive: true, force: true });
