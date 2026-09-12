// AS-106 mutants M2-M10, in place with backup + restore, each anchored so the
// pattern can only hit the intended site; the applied diff is printed and
// asserted to contain the expected removed/added line; the failing-test set
// is read off `node --test` output for compose-run.test.js + deploy-shape.
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const APP = '/Users/forrest/Code/american-software-company/.worktrees/AS-106/apps/chat';
const LIB = `${APP}/lib/compose-run.js`;
const COMPOSE = `${APP}/compose.yaml`;

const M = [
  { id: 'M2', file: COMPOSE, find: '    network_mode: none\n', repl: '', anchor: '  test:\n', expectDiff: /^-\s+network_mode: none$/m,
    predicted: ['deploy-shape: the test service has no network (AS-106 network_mode: none)'] },
  { id: 'M3', file: LIB, find: "  if (typeof name !== 'string' || !PROJECT_RE.test(name)) {", repl: "  if (false) { return { ok: true };\n  if (typeof name !== 'string' || !PROJECT_RE.test(name)) {", anchor: 'export function isAllowedProject', expectDiff: /^\+\s+if \(false\) \{ return \{ ok: true \};$/m,
    // M3 as written in the plan: return true unconditionally.
    override: (src) => src.replace(/export function isAllowedProject\(name, \{ productionNames = \[\], runningProjects = \[\] \} = \{\}\) \{\n/, (m) => m + '  return { ok: true };\n'),
    expectDiff2: /^\+\s+return \{ ok: true \};$/m,
    predicted: ['T1 isAllowedProject rejects production names', 'T2 isAllowedProject rejects non-asc and malformed names'] },
  { id: 'M4', file: LIB, find: "  return ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'];", repl: "  return ['compose', '-p', project, 'down', '-v', '--remove-orphans'];", anchor: 'export function buildDownArgs', expectDiff: /^-\s+return \['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'\];$/m,
    predicted: ['T4 buildDownArgs and buildRunArgs are exactly the recipe'] },
  { id: 'M5', file: LIB, find: "    downStatus = exec([docker, ...buildDownArgs(project)], { cwd, env: runEnv }).status;", repl: "    downStatus = runStatus === 0 ? exec([docker, ...buildDownArgs(project)], { cwd, env: runEnv }).status : 'skipped';", anchor: 'export function runCounted', expectDiff: /^\+\s+downStatus = runStatus === 0 \? exec/m,
    predicted: ['T5b runCounted: run exits 1 -> down still runs, status 1 preserved', 'T5c runCounted: run throws -> down still runs, error reported'] },
  { id: 'M6', file: LIB, find: "  const leaks = [...leftNets, ...leftImgs];", repl: "  const leaks = [];", anchor: 'export function runCounted', expectDiff: /^\+\s+const leaks = \[\];$/m,
    predicted: ['T6 runCounted: a network or image surviving down is reported as LEAK, exit 4, anchored at ^<project>_'] },
  { id: 'M7', file: LIB, find: "    built: builtLine !== null,", repl: "    built: true,", anchor: 'export function parseReceipt', expectDiff: /^\+\s+built: true,$/m,
    predicted: ['T7b runCounted: a run with no Built line is exit 5 even when every test passes'] },
  { id: 'M8', file: LIB, find: "    if (productionNames.includes(project)) out.production.push(network);\n    else if (runningProjects.includes(project)) out.live.push(network);\n    else out.leftover.push", repl: "    if (false) out.production.push(network);\n    else if (false) out.live.push(network);\n    else out.leftover.push", anchor: 'export function classifyNetworks', expectDiff: /^\+\s+if \(false\) out\.production\.push\(network\);$/m,
    predicted: ['T8 classifyNetworks: the plan §1 fixture splits 3 production / 1 live / 9 leftover'] },
  { id: 'M9', file: LIB, find: "  return { ok: count < ceiling, count, ceiling, classified };", repl: "  return { ok: count <= ceiling, count, ceiling, classified };", anchor: 'export function preflight', expectDiff: /^\+\s+return \{ ok: count <= ceiling/m,
    predicted: ['T9a runCounted refuses at exactly the ceiling: 20 asc-* networks -> exit 3, no run'] },
  { id: 'M10', file: LIB, find: "  const classified = classifyNetworks(networks, running, productionNames);\n  return { exit: classified.leftover.length ? 1 : 0,", repl: "  const classified = classifyNetworks(networks, running, productionNames);\n  for (const l of classified.leftover) exec([docker, ...buildDownArgs(l.project)], {});\n  return { exit: classified.leftover.length ? 1 : 0,", anchor: 'export function runCheck', expectDiff: /^\+\s+for \(const l of classified\.leftover\) exec/m,
    predicted: ['T10b runCheck is read-only: never down, rm, or prune'] },
];

const results = [];
for (const m of M) {
  const bak = `${m.file}.${m.id}.bak`;
  copyFileSync(m.file, bak);
  const restore = () => { copyFileSync(bak, m.file); unlinkSync(bak); };
  process.on('exit', restore);
  try {
    const src = readFileSync(m.file, 'utf8');
    let mutated;
    if (m.override) {
      mutated = m.override(src);
    } else {
      const a = src.indexOf(m.anchor);
      if (a < 0) throw new Error(`${m.id}: anchor not found`);
      const region = src.slice(a);
      const i = region.indexOf(m.find);
      if (i < 0) throw new Error(`${m.id}: find not found after anchor`);
      // the site must be the first occurrence after the anchor and before the next `export function`
      const nextFn = region.indexOf('\nexport function', 1);
      if (nextFn >= 0 && i > nextFn) throw new Error(`${m.id}: find landed outside the anchored function`);
      mutated = src.slice(0, a) + region.slice(0, i) + m.repl + region.slice(i + m.find.length);
    }
    if (mutated === src) throw new Error(`${m.id}: mutation did not apply`);
    writeFileSync(m.file, mutated);
    const diff = spawnSync('git', ['-C', APP, 'diff', '--', m.file], { encoding: 'utf8' }).stdout;
    const expect = m.expectDiff2 || m.expectDiff;
    if (!expect.test(diff)) throw new Error(`${m.id}: diff does not show the intended edit:\n${diff}`);
    const r = spawnSync('node', ['--test', 'test/compose-run.test.js', 'test/deploy-shape.test.js'], { cwd: APP, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const failing = [...new Set(out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \(\d.*$/, '')).filter((l) => l !== 'failing tests:'))];
    const summary = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped)/.test(l)).join(' ');
    const match = failing.length === m.predicted.length && m.predicted.every((p) => failing.includes(p));
    results.push({ id: m.id, match, failing, predicted: m.predicted, summary, diff: diff.split('\n').filter((l) => /^[+-][^+-]/.test(l)).join(' | ') });
  } finally {
    restore();
    process.removeListener('exit', restore);
  }
}
const clean = spawnSync('git', ['-C', APP, 'diff', '--exit-code'], { encoding: 'utf8' });
for (const r of results) {
  console.log(`${r.id} ${r.match ? 'RED-AS-PREDICTED' : 'MISMATCH'}  ${r.summary}\n   diff: ${r.diff}\n   failing: ${JSON.stringify(r.failing)}\n   predicted: ${JSON.stringify(r.predicted)}`);
}
console.log(`git diff --exit-code after restore => ${clean.status}`);
writeFileSync('/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-106/mutants-result.json', JSON.stringify({ results, cleanExit: clean.status }, null, 2));
