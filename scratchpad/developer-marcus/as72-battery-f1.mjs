// AS-72 finding-1 mutation battery driver (node-only: `bash <script>` is not
// in the headless tick allowlist). Backup -> mutate (anchored) -> full host
// suite -> restore -> content-hash + git-status proof.
import { readFileSync, writeFileSync, copyFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-72';
const APP = `${WT}/apps/chat/public/app.js`;
const SP = '/Users/forrest/Code/american-software-company/scratchpad/developer-marcus';
const BAK = `${SP}/app.js.bak`;
const LOG = `${SP}/as72-f1-mutants.log`;
const MUT = `${SP}/as72-mutate-f1.mjs`;

const log = (s) => {
  console.log(s);
  appendFileSync(LOG, s + '\n');
};
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const testFiles = globSync(`${WT}/apps/chat/test/*.test.js`);

copyFileSync(APP, BAK);
const BEFORE = sha(APP);
log(`\n=== AS-72 finding-1 battery ${new Date().toISOString()} ===`);
log(`test files: ${testFiles.length}; baseline sha256 ${BEFORE}`);

const restore = () => copyFileSync(BAK, APP);
process.on('exit', restore);

const runSuite = () => {
  const r = spawnSync('node', ['--test', ...testFiles], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  const fails = [
    ...new Set([...out.matchAll(/^✖ (.+?) \(\d[\d.]*ms\)$/gm)].map((m) => m[1].trim())),
  ];
  const counts = Object.fromEntries(
    [...out.matchAll(/^ℹ (tests|pass|fail) (\d+)$/gm)].map((m) => [m[1], Number(m[2])]),
  );
  const tap = [...out.matchAll(/^# (tests|pass|fail) (\d+)$/gm)].map((m) => [m[1], Number(m[2])]);
  return { fails, counts: Object.keys(counts).length ? counts : Object.fromEntries(tap), out };
};

for (const name of ['M1', 'M2', 'M3']) {
  log(`\n--- ${name} ---`);
  const mr = spawnSync('node', [MUT, name], { encoding: 'utf8' });
  log((mr.stdout + mr.stderr).trim());
  if (mr.status !== 0) {
    log(`${name}: MUTATION DID NOT APPLY AT INTENDED SITE — skipping run`);
    restore();
    continue;
  }
  const { fails, counts } = runSuite();
  log(`${name} counts: ${JSON.stringify(counts)}`);
  log(`${name} red set (${fails.length}):`);
  for (const f of fails) log(`   RED: ${f}`);
  restore();
  log(`${name} restored-hash-match: ${sha(APP) === BEFORE ? 'YES' : 'NO'}`);
}

const st = spawnSync('git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' });
log(`\nworktree status after battery:\n${st.stdout.trim() || '(clean)'}`);
