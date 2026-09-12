// mutate.mjs — site-anchored mutation battery for AS-99 cycle 2.
// For each mutant: copy pristine file (worktree) -> scratch, apply ONE anchored
// replacement, assert it matched exactly once and at the intended line range,
// run the named test files on the scratch copy, record the failing set, restore
// the pristine file, and assert scratch == worktree byte-for-byte afterwards.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-99/apps/chat';
const SC = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-99/scratch/apps/chat';
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-99/mutants.log';
const TESTS = ['test/lanes.test.js', 'test/lanes-label.test.js', 'test/watcher-lanes.test.js', 'test/api.test.js', 'test/stream.test.js'];

const MUTANTS = [
  {
    id: 'M1-unmeasured-drops-git-error', file: 'public/lanes.js',
    find: "const UNMEASURED_REASONS = new Set(['no-snapshot', 'unreadable-snapshot', 'git-error']);",
    replace: "const UNMEASURED_REASONS = new Set(['no-snapshot', 'unreadable-snapshot']);",
    site: 'UNMEASURED_REASONS declaration',
  },
  {
    id: 'M2-empty-state-git-error-claims-measurement', file: 'public/lanes.js',
    find: "  'git-error': 'No lane data to show.',\n});",
    replace: "  'git-error': 'No lanes in flight.',\n});",
    site: 'EMPTY_STATES table, git-error row',
  },
  {
    id: 'M3-app-rederives-empty-from-badge', file: 'public/app.js',
    find: "    nodes.push(el('div', 'lanes-empty', view.emptyText));",
    replace: "    nodes.push(el('div', 'lanes-empty', view.badge === 'Lanes · 0' ? 'No lanes in flight.' : 'No lane data to show.'));",
    site: 'renderLanes() empty branch',
  },
  {
    id: 'M4-unmeasured-swallows-stale', file: 'public/lanes.js',
    find: "const UNMEASURED_REASONS = new Set(['no-snapshot', 'unreadable-snapshot', 'git-error']);",
    replace: "const UNMEASURED_REASONS = new Set(['no-snapshot', 'unreadable-snapshot', 'git-error', 'stale-snapshot']);",
    site: 'UNMEASURED_REASONS declaration (stale collapses into unmeasured)',
  },
  {
    id: 'M5-compose-git-error-reports-ok', file: 'lib/lanes.js',
    find: "  if (error) return { checkedAt, snapshot: shell('git-error'), count: 0, lanes: [] };",
    replace: "  if (error) return { checkedAt, snapshot: shell('ok'), count: 0, lanes: [] };",
    site: 'composeLanes() error branch',
  },
  {
    id: 'M6-relpath-leaks-outside-path', file: 'watch/advance-watcher.mjs',
    find: "  // Already relative (or empty): nothing to leak, leave it alone.\n  if (!p.startsWith('/')) return p;",
    replace: "  // MUTANT: cycle-1 behaviour restored\n  return p;",
    site: 'relPathOf() outside-root branch',
  },
  {
    id: 'M7-relpath-marker-keeps-host-dirs', file: 'watch/advance-watcher.mjs',
    find: "  const base = p.replace(/\\/+$/, '').split('/').pop();\n  return base ? `${OUTSIDE_REPO}/${base}` : OUTSIDE_REPO;",
    replace: "  const base = p.replace(/\\/+$/, '').slice(1);\n  return base ? `${OUTSIDE_REPO}/${base}` : OUTSIDE_REPO;",
    site: 'relPathOf() basename extraction',
  },
  {
    id: 'M8-factory-bypasses-relPathOf', file: 'watch/advance-watcher.mjs',
    find: "        const out = {\n          relPath: relPathOf(repoRoot, row.path),",
    replace: "        const out = {\n          relPath: row.path,",
    site: 'makeLanesOps().evaluate() row assembly',
  },
];

function lineOf(text, idx) { return text.slice(0, idx).split('\n').length; }

const only = process.argv.slice(2);
appendFileSync(LOG, `\n=== battery ${new Date().toISOString()} ===\n`);
for (const m of MUTANTS) {
  if (only.length && !only.includes(m.id)) continue;
  const pristine = readFileSync(`${WT}/${m.file}`, 'utf8');
  const first = pristine.indexOf(m.find);
  const last = pristine.lastIndexOf(m.find);
  if (first === -1) { appendFileSync(LOG, `${m.id}: ABORT pattern not found\n`); console.log(m.id, 'ABORT not found'); continue; }
  if (first !== last) { appendFileSync(LOG, `${m.id}: ABORT pattern matched more than once\n`); console.log(m.id, 'ABORT ambiguous'); continue; }
  const mutated = pristine.slice(0, first) + m.replace + pristine.slice(first + m.find.length);
  if (mutated === pristine) { appendFileSync(LOG, `${m.id}: ABORT mutation is a no-op\n`); continue; }
  writeFileSync(`${SC}/${m.file}`, mutated);
  // assert applied AT THE SITE: re-read scratch, confirm replacement present exactly once and pattern absent
  const check = readFileSync(`${SC}/${m.file}`, 'utf8');
  const applied = check.includes(m.replace) && !check.includes(m.find) && check !== pristine;
  const line = lineOf(pristine, first);
  let result;
  try {
    const r = spawnSync('node', ['--test', ...TESTS], { cwd: SC, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = r.stdout + r.stderr;
    const fails = [...new Set(out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '')))];
    const tests = (out.match(/^ℹ tests (\d+)/m) || [])[1];
    const pass = (out.match(/^ℹ pass (\d+)/m) || [])[1];
    const fail = (out.match(/^ℹ fail (\d+)/m) || [])[1];
    result = { tests, pass, fail, fails, exit: r.status };
  } finally {
    writeFileSync(`${SC}/${m.file}`, pristine);
  }
  const restored = readFileSync(`${SC}/${m.file}`, 'utf8') === pristine;
  const rec = `${m.id}\n  file=${m.file} site=${m.site} line=${line} applied=${applied} restored=${restored}\n  tests=${result.tests} pass=${result.pass} fail=${result.fail} exit=${result.exit}\n  red=${JSON.stringify(result.fails, null, 0)}\n`;
  appendFileSync(LOG, rec);
  console.log(rec);
}
