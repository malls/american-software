// AS-99 rework cycle 1 — mutation battery for the F1/F2 guards.
// developer-marcus. Same machinery as mut99/run.mjs: every mutant runs on a
// FRESH COPY of apps/chat under this scratchpad, the task worktree is never
// mutated, each pattern must match EXACTLY ONCE (wrong-site hazard, AS-95), and
// the mutated neighbourhood is re-read from disk and printed before the suite
// runs so a survivor can be diagnosed rather than reported.

import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-99/apps/chat';
const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/mut99-c1';
const WORK = join(ROOT, 'work');

const MUTANTS = [
  {
    id: 'MF1a-git-error-is-a-measured-list',
    file: 'public/lanes.js',
    find: `const UNMEASURED_REASONS = new Set(['no-snapshot', 'unreadable-snapshot', 'git-error']);`,
    repl: `const UNMEASURED_REASONS = new Set(['no-snapshot', 'unreadable-snapshot']); /* MUT: git-error falls through to the count branch */`,
    predict: ['lanes-label-git-error-is-not-a-measured-zero', 'api: AS-99 — api-lanes-git-error-badge'],
  },
  {
    id: 'MF1b-git-error-empty-state-claims-nothing-in-flight',
    file: 'public/lanes.js',
    find: `  'git-error': 'No lane data to show.',`,
    repl: `  'git-error': 'No lanes in flight.', /* MUT: the refusal reads as a measurement */`,
    predict: ['lanes-label-empty-state-table', 'lanes-label-git-error-is-not-a-measured-zero'],
  },
  {
    id: 'MF1c-app-keys-empty-state-off-the-badge-string',
    file: 'public/app.js',
    find: `    nodes.push(el('div', 'lanes-empty', view.emptyText));`,
    repl: `    nodes.push(el('div', 'lanes-empty', view.badge === 'Lanes · 0' ? 'No lanes in flight.' : 'No lane data to show.')); /* MUT: the cycle-1 defect, restored */`,
    predict: ['api: AS-99 — api-lanes-git-error-badge'],
  },
  {
    id: 'MF1d-stale-snapshot-loses-its-count',
    file: 'public/lanes.js',
    find: `const UNMEASURED_REASONS = new Set(['no-snapshot', 'unreadable-snapshot', 'git-error']);`,
    repl: `const UNMEASURED_REASONS = new Set(['no-snapshot', 'unreadable-snapshot', 'git-error', 'stale-snapshot']); /* MUT: an old measurement treated as no measurement */`,
    predict: ['lanes-label-stale-caption'],
  },
  {
    id: 'MF2-outside-repo-path-survives-absolute',
    file: 'watch/advance-watcher.mjs',
    find: `  if (!p.startsWith('/')) return p;
  const base = p.replace(/\\/+$/, '').split('/').pop();
  return base ? \`\${OUTSIDE_REPO}/\${base}\` : OUTSIDE_REPO;`,
    repl: `  return p; /* MUT: the absolute host path reaches the snapshot again */`,
    predict: ['lanes-relpath-outside-repo', 'lanes-relpath'],
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
