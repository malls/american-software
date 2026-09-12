// AS-99 mutant runner — qa-ruben. Runs against a SCRATCH copy, never the worktree.
// Each mutant: assert the anchor occurs exactly once (site-anchored), apply, run the
// named test files, collect failing test names, restore from the pristine copy.
import { readFileSync, writeFileSync, copyFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename } from 'node:path';

// argv: <source apps/chat> <scratch dir> <pristine dir> [only ids]
const SOURCE = process.argv[2];
const SCRATCH = process.argv[3];
const PRISTINE = process.argv[4];
const only = process.argv[5] ? process.argv[5].split(',') : null;
const filter = (src) => basename(src) !== 'data' && basename(src) !== 'node_modules';
for (const d of [SCRATCH, PRISTINE]) {
  if (existsSync(d)) rmSync(d, { recursive: true, force: true }); // my own scratch dirs only
  cpSync(SOURCE, d, { recursive: true, filter });
}

const W = 'watch/advance-watcher.mjs';
const L = 'lib/lanes.js';
const S = 'server.js';
const P = 'public/lanes.js';
const T_W = ['test/watcher-lanes.test.js', 'test/lanes.test.js'];
const T_L = ['test/lanes.test.js', 'test/api.test.js'];

const mutants = [
  { id: 'AC-1', file: W, find: `    else if (key === 'detached') cur.detached = true;\n`, replace: ``, tests: T_W },
  { id: 'AC-1b', file: W, find: `    if (cur.head === null) cur.errors.push('head: missing from porcelain record');\n`, replace: `    if (cur.head === null) throw new Error('no HEAD');\n`, tests: T_W },
  { id: 'AC-2', file: W, find: `  function persist(body) {\n    try {\n      writeState(statePath, body);`, replace: `  function persist(body) {\n    const k = JSON.stringify({ ...body, generatedAt: null });\n    if (k === persist.last) return;\n    persist.last = k;\n    try {\n      writeState(statePath, body);`, tests: T_W },
  { id: 'AC-3', file: W, find: `      const list = git(['worktree', 'list', '--porcelain'], repoRoot);\n      if (list.code !== 0) {\n`, replace: `      const list = git(['worktree', 'list', '--porcelain'], repoRoot);\n      if (list.code !== 0) {\n        throw new Error('git down');\n`, tests: T_W },
  { id: 'AC-3b', file: W, find: `    } catch (err) {\n      // Nothing above is allowed to take the watcher down`, replace: `    } catch (err) {\n      throw err;\n      // Nothing above is allowed to take the watcher down`, tests: T_W },
  { id: 'AC-4', file: W, find: `        } else {\n          out.errors.push(\`status: exit \${status.code}`, replace: `        } else {\n          throw new Error('abort snapshot');\n          out.errors.push(\`status: exit \${status.code}`, tests: T_W },
  { id: 'AC-5', file: W, find: `git(['--no-optional-locks', 'status', '--porcelain'], cwd)`, replace: `git(['status', '--porcelain'], cwd)`, tests: T_W },
  { id: 'AC-6', file: W, find: `  return ahead === 0 && isAncestor === true && onFirstParent === false;`, replace: `  return ahead === 0 && isAncestor === true;`, tests: T_W },
  { id: 'AC-7a', file: L, find: `    if (task) joined.add(task.id);\n`, replace: `    if (!task) continue;\n    joined.add(task.id);\n`, tests: T_L },
  { id: 'AC-7b', file: L, find: `    if (typeof row.branch === 'string' && byBranch.has(row.branch)) {\n      task = byBranch.get(row.branch);\n      joinedBy = 'branch-link';\n    } else if (typeof row.branch === 'string') {\n      const match = SHORT_ID_RE.exec(row.branch);\n      const taskId = match ? ids[match[0]] : null;\n      if (taskId && byId.has(taskId)) {\n        task = byId.get(taskId);\n        joinedBy = 'branch-name';\n      }\n    }`, replace: `    const m0 = typeof row.branch === 'string' ? SHORT_ID_RE.exec(row.branch) : null;\n    const t0 = m0 ? ids[m0[0]] : null;\n    if (t0 && byId.has(t0)) {\n      task = byId.get(t0);\n      joinedBy = 'branch-name';\n    } else if (typeof row.branch === 'string' && byBranch.has(row.branch)) {\n      task = byBranch.get(row.branch);\n      joinedBy = 'branch-link';\n    }`, tests: T_L },
  { id: 'AC-8', file: L, find: `    if (!MID_LIFECYCLE.includes(task.status)) continue;`, replace: `    if (!['in_planning', 'planned', 'in_progress', 'review', 'blocked', 'needs_human'].includes(task.status)) continue;`, tests: T_L },
  { id: 'AC-9', file: L, find: `  if (row?.merged === true) reasons.push('merged');`, replace: `  if (row?.ahead === 0) reasons.push('merged');`, tests: T_L },
  { id: 'AC-10', file: L, find: `      employee: {\n        assignee: task?.assigned_to ?? null,\n        lastCommitAuthor: row.lastCommit?.authorName ?? null,\n        agree: authorsAgree(task?.assigned_to ?? null, row.lastCommit?.authorName ?? null),\n      },`, replace: `      employee: {\n        assignee: task?.assigned_to ?? row.lastCommit?.authorName ?? null,\n        lastCommitAuthor: task?.assigned_to ?? row.lastCommit?.authorName ?? null,\n        agree: true,\n      },`, tests: T_L },
  { id: 'AC-11a', file: L, find: `  const stale = !(Number.isFinite(ageS) && ageS * 1000 <= staleMs);`, replace: `  const stale = !(Number.isFinite(ageS) && ageS * 1000 <= 2 * staleMs);`, tests: T_L },
  { id: 'AC-11b', file: S, find: `      snapshot: readLoopFile(WORKTREES_PATH),`, replace: `      snapshot: (() => { const s = readLoopFile(WORKTREES_PATH); if (s && typeof s === 'object' && s.generatedAt) { try { s.generatedAt = statSync(WORKTREES_PATH).mtime.toISOString(); } catch {} } return s; })(),`, tests: ['test/api.test.js'] },
  { id: 'AC-12', file: S, find: `    if (key === lastLanesKey) return;\n`, replace: ``, tests: ['test/stream.test.js'] },
  { id: 'AC-13', file: L, find: `      worktree: view,\n`, replace: `      worktree: { ...row, ...view },\n`, tests: T_L },
  { id: 'AC-14', file: P, find: `    return {\n      badge: 'Lanes · –',\n      title: 'The server did not answer /api/lanes.`, replace: `    return {\n      badge: 'Lanes · 0',\n      title: 'The server did not answer /api/lanes.`, tests: ['test/lanes-label.test.js'] },
];

function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

const results = [];
for (const m of mutants) {
  if (only && !only.includes(m.id)) continue;
  const path = join(SCRATCH, m.file);
  const orig = readFileSync(path, 'utf8');
  const n = count(orig, m.find);
  if (n !== 1) { results.push({ id: m.id, error: `anchor matched ${n} times (need exactly 1)` }); continue; }
  const mutated = orig.replace(m.find, m.replace);
  if (mutated === orig) { results.push({ id: m.id, error: 'mutation did not change the file' }); continue; }
  writeFileSync(path, mutated);
  // assert applied at the intended site
  const check = readFileSync(path, 'utf8');
  const applied = count(check, m.find) === 0 && (m.replace === '' || count(check, m.replace) >= 1);
  const r = spawnSync('node', ['--test', ...m.tests], { cwd: SCRATCH, encoding: 'utf8', timeout: 180000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const fails = [...new Set(out.split('\n').filter((l) => /^\s*✖ /.test(l)).map((l) => l.replace(/^\s*✖ /, '').replace(/ \(\d+(\.\d+)?ms\)\s*$/, '')))];
  const totals = { tests: (out.match(/ℹ tests (\d+)/) || [])[1], fail: (out.match(/ℹ fail (\d+)/) || [])[1] };
  copyFileSync(join(PRISTINE, m.file), path);
  const restored = readFileSync(path, 'utf8') === orig;
  results.push({ id: m.id, file: m.file, applied, restored, exit: r.status, totals, fails });
}
for (const r of results) console.log(JSON.stringify(r));
