// AS-84 mutation battery (qa-ruben). In-place mutants on the worktree's
// advance-watcher.mjs, backup in the scratchpad (outside the scanned tree),
// restore in finally, git diff --exit-code after each restore.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-84';
const CWD = `${WT}/apps/chat`;
const FILE = `${CWD}/watch/advance-watcher.mjs`;
const PAD = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-84';
const BACKUP = `${PAD}/advance-watcher.mjs.orig`;
const files = fs.readdirSync(`${CWD}/test`).filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);

const mutants = [
  { id: 'M1(AC-1)', from: 'if (held && held.pid === pid && held.source === source) {', to: 'if (held && held.pid === pid) {', predicted: 'AC-1, AC-11' },
  { id: 'M2(AC-2)', from: 'if (verify && verify.pid === pid && verify.nonce === nonce) return true;', to: 'if (verify && verify.pid === pid) return true;', predicted: 'AC-2' },
  { id: 'M3(AC-3)', from: 'let lastAttempt = hydrateAttempt(readState(statePath)?.lastAttempt);', to: 'let lastAttempt = null;', predicted: 'AC-3, AC-4' },
  { id: 'M4(AC-4)', from: "return { id: record.id, at, outcome: 'fail', detail: 'interrupted: watcher exited mid-build' };", to: "return { id: record.id, at, outcome: 'started', detail: 'building' };", predicted: 'AC-4' },
  { id: 'M5(AC-5)', from: "      lastAttempt = { id: desiredId, at: startedAt, outcome: 'started', detail: 'building' };\n      persist(stateFields);\n      const result = await deploy({", to: "      const result = await deploy({", predicted: 'AC-5' },
  { id: 'M6a(AC-6 no-signal)', from: '    const pending = deployDone;\n    if (deployChild) {', to: '    const pending = deployDone;\n    if (false) {', predicted: 'AC-6' },
  { id: 'M6b(AC-6 fail-not-aborted)', from: "          outcome = 'aborted';\n          detail = `aborted by shutdown (${abortSignal})`;", to: "          outcome = 'fail';\n          detail = `aborted by shutdown (${abortSignal})`;", predicted: 'AC-6' },
  { id: 'M7(AC-7)', from: "  async function abort(signal = 'SIGTERM') {\n    if (!deploying) return;", to: "  async function abort(signal = 'SIGTERM') {\n    if (!deploying) { persist({}); return; }", predicted: 'AC-7' },
  { id: 'M8(AC-8)', from: '  async function evaluate(opts = {}) {\n    try {\n      return await evaluateInner(opts);', to: '  async function evaluate(opts = {}) {\n    return evaluateInner(opts);\n    try {\n      return await evaluateInner(opts);', predicted: 'AC-8' },
  { id: 'M9(AC-9 sync exit)', from: '    if (waits.length === 0) return finish(dying);', to: '    return finish(dying);', predicted: 'AC-9, AC-10, AC-11 (plan)' },
  { id: 'M10(AC-10 no abort)', from: "      waits.push(deployOps.abort('SIGTERM'));", to: '      /* mutant: no abort */', predicted: 'AC-10, AC-14' },
  { id: 'M12(AC-12 no grace)', from: '    return Promise.race([Promise.all(waits), grace]).then(() => {', to: '    return Promise.all(waits).then(() => {', predicted: 'AC-12' },
  { id: 'M13(AC-13 no catch)', from: "      .evaluate({ busy: Boolean(child) })\n      .catch((err) => log(`ERROR deploy poll rejected: ${err.message}`));", to: '      .evaluate({ busy: Boolean(child) });', predicted: 'AC-13' },
];

const orig = fs.readFileSync(FILE, 'utf8');
fs.writeFileSync(BACKUP, orig);
const results = [];
for (const m of mutants) {
  const count = orig.split(m.from).length - 1;
  if (count !== 1) {
    results.push({ id: m.id, applied: false, note: `pattern matched ${count} sites, refusing` });
    continue;
  }
  try {
    const mutated = orig.replace(m.from, m.to);
    fs.writeFileSync(FILE, mutated);
    const applied = fs.readFileSync(FILE, 'utf8') !== orig && fs.readFileSync(FILE, 'utf8').includes(m.to);
    if (!applied) throw new Error('mutation did not apply');
    const diff = spawnSync('git', ['-C', WT, 'diff', '--stat'], { encoding: 'utf8' }).stdout.trim();
    const r = spawnSync('node', ['--test', '--test-reporter=tap', ...files], { cwd: CWD, encoding: 'utf8', maxBuffer: 1e9 });
    const out = r.stdout + r.stderr;
    fs.writeFileSync(`${PAD}/mutant-${m.id.replace(/[^A-Za-z0-9-]/g, '_')}.log`, out);
    const red = [...out.matchAll(/^\s*not ok \d+ - (.*)$/gm)].map((x) => x[1]).filter((n) => !/\.test\.js$/.test(n));
    const total = (out.match(/^# tests (\d+)/m) || [])[1];
    const fail = (out.match(/^# fail (\d+)/m) || [])[1];
    results.push({ id: m.id, applied: true, diffStat: diff, exit: r.status, total, fail, red, predicted: m.predicted });
  } catch (err) {
    results.push({ id: m.id, applied: true, error: err.message });
  } finally {
    fs.writeFileSync(FILE, orig);
    const clean = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--', 'apps/chat/watch/advance-watcher.mjs'], { encoding: 'utf8' });
    results[results.length - 1].restoredClean = clean.status === 0;
  }
  console.log(JSON.stringify(results[results.length - 1]));
}
fs.writeFileSync(`${PAD}/mutants.json`, JSON.stringify(results, null, 2));
const finalClean = spawnSync('git', ['-C', WT, 'diff', '--exit-code'], { encoding: 'utf8' });
console.log('FINAL tree clean:', finalClean.status === 0);
