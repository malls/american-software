// AS-99 mutation battery — developer-marcus.
//
// Every mutant runs on a FRESH COPY of apps/chat under scratchpad; the task
// worktree is never mutated. Each mutant asserts its pattern matched EXACTLY
// ONCE and prints the mutated line number plus context, so a survivor can be
// diagnosed as "weak guard" vs "mutation hit the wrong site" (the AS-95 lesson).

import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-99/apps/chat';
const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/mut99';
const WORK = join(ROOT, 'work');

const MUTANTS = [
  {
    id: 'M1-AC1-parser-drops-detached',
    file: 'watch/advance-watcher.mjs',
    find: `    else if (key === 'detached') cur.detached = true;`,
    repl: `    else if (key === 'detached') { /* MUT: dropped */ }`,
    predict: ['lanes-parse-detached'],
  },
  {
    id: 'M2-AC2-skip-write-when-unchanged',
    file: 'watch/advance-watcher.mjs',
    find: `  let lastWriteWarn = null;

  function persist(body) {
    try {
      writeState(statePath, body);`,
    repl: `  let lastWriteWarn = null;
  let __mutLast = null;

  function persist(body) {
    try {
      const __j = JSON.stringify({ ...body, generatedAt: null });
      if (__j === __mutLast) return; /* MUT: content-equal poll writes nothing */
      __mutLast = __j;
      writeState(statePath, body);`,
    predict: ['watcher-lanes-generatedAt-advances'],
  },
  {
    id: 'M3a-AC3-git-down-writes-nothing',
    file: 'watch/advance-watcher.mjs',
    find: `        persist({ ...base, master: { head: null }, error, worktrees: [] });
        return;`,
    repl: `        return; /* MUT: a failed worktree list leaves no file at all */`,
    predict: ['watcher-lanes-git-down'],
  },
  {
    id: 'M3b-AC3-evaluate-rethrows',
    file: 'watch/advance-watcher.mjs',
    find: `      persist({ ...base, master: { head: null }, error: \`worktree-list-failed: \${err.message}\`, worktrees: [] });`,
    repl: `      throw err; /* MUT: evaluate() rejects instead of recording the fact */`,
    predict: ['watcher-lanes-* (any test that drives the catch path)'],
  },
  {
    id: 'M4-AC4-abort-snapshot-on-row-error',
    file: 'watch/advance-watcher.mjs',
    find: `          out.errors.push(\`status: exit \${status.code} \${firstLine(status.stderr)}\`.trim());`,
    repl: `          throw new Error(\`MUT abort on first row error: status exit \${status.code}\`);`,
    predict: ['watcher-lanes-row-isolation'],
  },
  {
    id: 'M5-AC5-drop-no-optional-locks',
    file: 'watch/advance-watcher.mjs',
    find: `        const status = git(['--no-optional-locks', 'status', '--porcelain'], cwd);`,
    repl: `        const status = git(['status', '--porcelain'], cwd); /* MUT */`,
    predict: ['watcher-lanes-argv-pin'],
  },
  {
    id: 'M6-AC6-drop-first-parent-check',
    file: 'watch/advance-watcher.mjs',
    find: `  return ahead === 0 && isAncestor === true && onFirstParent === false;`,
    repl: `  return ahead === 0 && isAncestor === true; /* MUT: first-parent dropped */`,
    predict: ['lanes-merged-fresh-branch-is-not-merged'],
  },
  {
    id: 'M7a-AC7-filter-unjoined-rows',
    file: 'lib/lanes.js',
    find: `    if (task) joined.add(task.id);
    const view = worktreeView(row);`,
    repl: `    if (!task) continue; /* MUT: a worktree with no task join is dropped */
    joined.add(task.id);
    const view = worktreeView(row);`,
    predict: ['lanes-compose-unknown-task-kept'],
  },
  {
    id: 'M7b-AC7-branch-name-beats-link',
    file: 'lib/lanes.js',
    find: `    if (typeof row.branch === 'string' && byBranch.has(row.branch)) {
      task = byBranch.get(row.branch);
      joinedBy = 'branch-link';
    } else if (typeof row.branch === 'string') {
      const match = SHORT_ID_RE.exec(row.branch);
      const taskId = match ? ids[match[0]] : null;
      if (taskId && byId.has(taskId)) {
        task = byId.get(taskId);
        joinedBy = 'branch-name';
      }
    }`,
    repl: `    /* MUT: the parsed name is consulted FIRST, the explicit link second */
    if (typeof row.branch === 'string') {
      const match = SHORT_ID_RE.exec(row.branch);
      const taskId = match ? ids[match[0]] : null;
      if (taskId && byId.has(taskId)) {
        task = byId.get(taskId);
        joinedBy = 'branch-name';
      }
    }
    if (!task && typeof row.branch === 'string' && byBranch.has(row.branch)) {
      task = byBranch.get(row.branch);
      joinedBy = 'branch-link';
    }`,
    predict: ['lanes-compose-link-beats-name'],
  },
  {
    id: 'M8-AC8-wrong-membership-set',
    file: 'lib/lanes.js',
    find: `    if (!MID_LIFECYCLE.includes(task.status)) continue;`,
    repl: `    if (!['in_planning', 'planned', 'in_progress', 'review', 'backlog', 'needs_human'].includes(task.status)) continue; /* MUT */`,
    predict: ['lanes-compose-task-only-membership'],
  },
  {
    id: 'M9-AC9-stale-flags-on-ahead-zero',
    file: 'lib/lanes.js',
    find: `  if (row?.merged === true) reasons.push('merged');`,
    repl: `  if (row?.ahead === 0) reasons.push('merged'); /* MUT: ahead===0 is not merged */`,
    predict: ['lanes-stale-reasons'],
  },
  {
    id: 'M10-AC10-coalesce-employee',
    file: 'lib/lanes.js',
    find: `      employee: {
        assignee: task?.assigned_to ?? null,
        lastCommitAuthor: row.lastCommit?.authorName ?? null,
        agree: authorsAgree(task?.assigned_to ?? null, row.lastCommit?.authorName ?? null),
      },`,
    repl: `      employee: { /* MUT: one merged identity, echoed into both fields */
        assignee: task?.assigned_to ?? row.lastCommit?.authorName ?? null,
        lastCommitAuthor: task?.assigned_to ?? row.lastCommit?.authorName ?? null,
        agree: true,
      },`,
    predict: ['lanes-employee-both-fields'],
  },
  {
    id: 'M11a-AC11-double-the-stale-window',
    file: 'lib/lanes.js',
    find: `  const stale = !(Number.isFinite(ageS) && ageS * 1000 <= staleMs);`,
    repl: `  const stale = !(Number.isFinite(ageS) && ageS * 1000 <= staleMs * 2); /* MUT */`,
    predict: ['api-lanes-stale-boundary', 'lanes-stale-boundary'],
  },
  {
    id: 'M11b-AC11-age-from-file-mtime',
    file: 'server.js',
    // v2. The first attempt replaced the CLOCK (nowMs := file mtime), which is
    // not the defect at all: age was still (now - generatedAt), and a file's
    // mtime is ~now, so behaviour barely moved and the mutant survived for the
    // mutation's reason, not the guard's. The real defect is substituting the
    // AGE SOURCE: take the freshness timestamp from the file's mtime instead of
    // from the payload's own generatedAt.
    find: `      snapshot: readLoopFile(WORKTREES_PATH),`,
    repl: `      snapshot: (() => { /* MUT: freshness taken from the FILE's mtime */
        const __s = readLoopFile(WORKTREES_PATH);
        if (!__s || typeof __s !== 'object' || Array.isArray(__s)) return __s;
        try { return { ...__s, generatedAt: new Date(statSync(WORKTREES_PATH).mtimeMs).toISOString() }; } catch { return __s; }
      })(),`,
    predict: ['api-lanes-stale-boundary'],
  },
  {
    id: 'M12-AC12-push-every-poll',
    file: 'server.js',
    find: `    const key = lanesKey(projection);
    if (key === lastLanesKey) return;
    lastLanesKey = key;`,
    repl: `    const key = lanesKey(projection); /* MUT: change detection removed */
    lastLanesKey = key;`,
    predict: ['stream-lanes-change-only'],
  },
  {
    id: 'M13-AC13-spread-the-snapshot-row',
    file: 'lib/lanes.js',
    find: `function worktreeView(row) {
  const out = {};`,
    repl: `function worktreeView(row) {
  const out = { ...row }; /* MUT: whatever the watcher grows reaches the browser */`,
    predict: ['api-lanes-key-whitelist', 'lanes-compose-shape'],
  },
  {
    id: 'M14-AC14-null-payload-reads-zero',
    file: 'public/lanes.js',
    // Anchored to the NULL-PAYLOAD branch specifically: the literal
    // "badge: 'Lanes · –'," appears twice in this file (the other is the
    // lanes===null branch), which is exactly the AS-95 wrong-site hazard.
    find: `  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return {
      badge: 'Lanes · –',`,
    repl: `  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return {
      badge: 'Lanes · 0', /* MUT: an unanswered fetch reports a measurement */`,
    predict: ['lanes-label-null-is-dash'],
  },
];

function freshCopy() {
  rmSync(WORK, { recursive: true, force: true });
  cpSync(SRC, WORK, {
    recursive: true,
    filter: (src) => !/\/(node_modules|data|\.git)$/.test(src),
  });
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function runSuite(cwd) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const failed = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(?:✖|not ok)\s+(.+?)(?:\s+\(\d[\d.]*ms\))?\s*$/.exec(line);
    // "✖ failing tests:" is the spec reporter's own summary header, not a test.
    if (m && m[1].trim() !== 'failing tests:') failed.push(m[1].trim());
  }
  const nums = {};
  for (const k of ['tests', 'pass', 'fail']) {
    const m = new RegExp(`^ℹ ${k} (\\d+)$`, 'm').exec(out);
    if (m) nums[k] = Number(m[1]);
  }
  return { code: r.status, failed: [...new Set(failed)], ...nums };
}

const results = [];
mkdirSync(ROOT, { recursive: true });

// Baseline first: the scratch copy must be green before any mutant means anything.
freshCopy();
const base = runSuite(WORK);
console.log(`BASELINE (scratch copy): tests=${base.tests} pass=${base.pass} fail=${base.fail} exit=${base.code}`);
if (base.fail !== 0) {
  console.log('BASELINE NOT GREEN — every mutant below is uninterpretable.');
  console.log(base.failed.join('\n'));
  process.exit(1);
}

for (const mut of MUTANTS) {
  freshCopy();
  const path = join(WORK, mut.file);
  const before = readFileSync(path, 'utf8');
  const idx = before.indexOf(mut.find);
  const last = before.lastIndexOf(mut.find);
  if (idx === -1) {
    results.push({ id: mut.id, status: 'PATTERN-NOT-FOUND' });
    console.log(`\n### ${mut.id}\nPATTERN NOT FOUND in ${mut.file} — mutant void.`);
    continue;
  }
  if (idx !== last) {
    results.push({ id: mut.id, status: 'PATTERN-AMBIGUOUS' });
    console.log(`\n### ${mut.id}\nPATTERN MATCHES MORE THAN ONCE in ${mut.file} — mutant void (wrong-site hazard).`);
    continue;
  }
  const line = lineOf(before, idx);
  const after = before.replace(mut.find, mut.repl);
  if (after === before) {
    console.log(`\n### ${mut.id}\nREPLACEMENT WAS A NO-OP — mutant void.`);
    results.push({ id: mut.id, status: 'NOOP' });
    continue;
  }
  writeFileSync(path, after);

  // Prove the mutation landed at the intended site: re-read the file and show
  // the neighbourhood of the changed line.
  const reread = readFileSync(path, 'utf8').split('\n');
  const ctx = reread.slice(Math.max(0, line - 3), line + mut.repl.split('\n').length + 2)
    .map((l, i) => `    ${String(Math.max(1, line - 2) + i).padStart(4)}| ${l}`)
    .join('\n');

  const r = runSuite(WORK);
  const status = r.fail > 0 ? 'RED' : 'SURVIVED';
  console.log(`\n### ${mut.id}  [${status}]`);
  console.log(`  site: ${mut.file}:${line} (exactly one match)`);
  console.log(`  mutated neighbourhood (re-read from disk):`);
  console.log(ctx);
  console.log(`  predicted red: ${mut.predict.join(', ')}`);
  console.log(`  observed: tests=${r.tests} pass=${r.pass} fail=${r.fail} exit=${r.code}`);
  console.log(`  failing set (${r.failed.length}):`);
  for (const f of r.failed) console.log(`    - ${f}`);
  results.push({ id: mut.id, file: mut.file, line, status, predict: mut.predict, failed: r.failed, ...r });
}

rmSync(WORK, { recursive: true, force: true });
writeFileSync(join(ROOT, 'results.json'), JSON.stringify({ baseline: base, results }, null, 2));
console.log('\n=== SUMMARY ===');
for (const r of results) console.log(`${r.status.padEnd(18)} ${r.id}  (${r.failed ? r.failed.length : 0} failing)`);
