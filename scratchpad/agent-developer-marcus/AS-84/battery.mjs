// AS-84 mutation battery runner. Node rather than shell, because the tick's
// bash surface refuses a script invocation; the discipline is identical —
// backup, mutate, ASSERT THE MUTATION LANDED AT THE INTENDED SITE, run the FULL
// host suite (so a wider-than-predicted red set is visible), restore, prove the
// tree clean with `git diff --exit-code` before the next mutant.
import { readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { MUTANTS } from './mutants.mjs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-84';
const SRC = `${WT}/apps/chat/watch/advance-watcher.mjs`;
const PAD = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/AS-84';
const BAK = `${PAD}/advance-watcher.mjs.bak`;

const ids = process.argv.slice(2);
const wanted = ids.length ? MUTANTS.filter((m) => ids.includes(m.id)) : MUTANTS;

copyFileSync(SRC, BAK);
const restore = () => copyFileSync(BAK, SRC);
process.on('exit', restore);
process.on('SIGINT', () => process.exit(130));

const report = [];
for (const m of wanted) {
  restore();
  const before = readFileSync(m.file, 'utf8');
  const occurrences = before.split(m.from).length - 1;
  if (occurrences !== 1) {
    console.log(`ANCHOR FAIL ${m.id}: from-text occurs ${occurrences} times (expected 1)`);
    process.exit(1);
  }
  writeFileSync(m.file, before.replace(m.from, m.to));
  const after = readFileSync(m.file, 'utf8');
  if (!m.site.test(after)) {
    console.log(`SITE FAIL ${m.id}: mutation did not land at the intended site`);
    process.exit(1);
  }
  const lines = after.split('\n');
  const needle = (m.to.split('\n').find((l) => l.trim()) ?? m.from.split('\n').find((l) => l.trim())).trim();
  const hits = lines.map((l, i) => [i + 1, l.trim()]).filter(([, l]) => l.includes(needle));
  const anchor = `grep -c ${JSON.stringify(needle)} => ${hits.length}` + hits.map(([n, l]) => `\n      line ${n}: ${l}`).join('');

  // The counted run's exact file set — the glob the tick names, expanded here.
  const testFiles = readdirSync(`${WT}/apps/chat/test`)
    .filter((n) => n.endsWith('.test.js'))
    .map((n) => `${WT}/apps/chat/test/${n}`);
  const run = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: WT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = run.stdout + run.stderr;
  writeFileSync(`${PAD}/run-${m.id}.txt`, out);
  const counts = Object.fromEntries(
    [...out.matchAll(/^ℹ (tests|pass|fail) (\d+)$/gm)].map((x) => [x[1], Number(x[2])])
  );
  const tail = out.slice(out.indexOf('failing tests:'));
  const red = [
    ...new Set(
      [...tail.matchAll(/^✖ (.+?) \(\d[\d.]*ms\)$/gm)].map((x) => x[1])
    ),
  ];
  restore();
  const diff = spawnSync('git', ['-C', WT, 'diff', '--exit-code'], { encoding: 'utf8' });

  report.push({ id: m.id, ac: m.ac, what: m.what, anchor, counts, red, clean: diff.status === 0 });
  console.log(`=== ${m.id} (${m.ac}) — ${m.what}`);
  console.log(`    ${anchor}`);
  console.log(`    tests=${counts.tests} pass=${counts.pass} fail=${counts.fail}`);
  for (const r of red) console.log(`    RED: ${r}`);
  console.log(`    tree clean after restore: ${diff.status === 0}`);
  if (diff.status !== 0) {
    console.log('TREE DIRTY — stopping');
    process.exit(1);
  }
}
writeFileSync(`${PAD}/battery-report.json`, JSON.stringify(report, null, 2));
console.log('battery done');
