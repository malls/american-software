// AS-72 markdown.js mutation driver (M4/M5/M6). Backup -> anchored mutate ->
// suite -> restore -> hash proof. Usage: node as72-battery-md.mjs M4 [M5 ...]
import { readFileSync, writeFileSync, copyFileSync, appendFileSync, globSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-72';
const MD = `${WT}/apps/chat/public/markdown.js`;
const SP = '/Users/forrest/Code/american-software-company/scratchpad/developer-marcus';
const BAK = `${SP}/markdown.js.bak`;
const LOG = `${SP}/as72-md-mutants.log`;

const log = (s) => { console.log(s); appendFileSync(LOG, s + '\n'); };
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const occurrences = (hay, needle) => hay.split(needle).length - 1;
const lineOf = (hay, idx) => hay.slice(0, idx).split('\n').length;
const testFiles = globSync(`${WT}/apps/chat/test/*.test.js`);

const MUTANTS = {
  // M4pre: the same mutation against today's URL_RE (`/g`, pre-D4) — used to
  // observe the fuzz test's VACUOUS PASS before the generator gains its
  // SALT+PUNCT branch.
  M4pre: {
    anchor: "const URL_RE = /https?:\\/\\/[A-Za-z0-9][^\\s<>\"'`\\\\]*/g;",
    replacement: "const URL_RE = /https?:\\/\\/[^\\s<>\"'`\\\\]*/g;",
    marker: "const URL_RE = /https?:\\/\\/[^\\s<>\"'`\\\\]*/g;",
  },
  // M4: drop the alnum first-host-char from URL_RE (the assertion the fuzz
  // generator could never exercise).
  M4: {
    anchor: "const URL_RE = /https?:\\/\\/[A-Za-z0-9][^\\s<>\"'`\\\\]*/gu;",
    replacement: "const URL_RE = /https?:\\/\\/[^\\s<>\"'`\\\\]*/gu;",
    marker: "const URL_RE = /https?:\\/\\/[^\\s<>\"'`\\\\]*/gu;",
  },
  // M5: remove the en dash from the tail-trim set (D3).
  M5: { anchor: "const SENTENCE_TAIL = '.,;:!?–—…';", replacement: "const SENTENCE_TAIL = '.,;:!?—…';", marker: "const SENTENCE_TAIL = '.,;:!?—…';" },
  // M6: drop \p{Cf} from the URL body class (D4).
  M6: {
    anchor: "const URL_RE = /https?:\\/\\/[A-Za-z0-9][^\\s<>\"'`\\\\\\p{Cf}]*/gu;",
    replacement: "const URL_RE = /https?:\\/\\/[A-Za-z0-9][^\\s<>\"'`\\\\]*/gu;",
    marker: "const URL_RE = /https?:\\/\\/[A-Za-z0-9][^\\s<>\"'`\\\\]*/gu;",
  },
};

const runSuite = () => {
  const r = spawnSync('node', ['--test', ...testFiles], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  const fails = [...new Set([...out.matchAll(/^✖ (.+?) \(\d[\d.]*ms\)$/gm)].map((m) => m[1].trim()))];
  const counts = Object.fromEntries([...out.matchAll(/^ℹ (tests|pass|fail) (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
  return { fails, counts };
};

copyFileSync(MD, BAK);
const BEFORE = sha(MD);
const restore = () => copyFileSync(BAK, MD);
process.on('exit', restore);
log(`\n=== AS-72 markdown battery ${new Date().toISOString()} === files ${testFiles.length}, baseline ${BEFORE}`);

for (const name of process.argv.slice(2)) {
  const m = MUTANTS[name];
  log(`\n--- ${name} ---`);
  const src = readFileSync(MD, 'utf8');
  const n = occurrences(src, m.anchor);
  if (n !== 1) { log(`${name}: ANCHOR MISS — occurs ${n} times, expected 1`); continue; }
  const line = lineOf(src, src.indexOf(m.anchor));
  writeFileSync(MD, src.replace(m.anchor, m.replacement));
  const after = readFileSync(MD, 'utf8');
  const mn = occurrences(after, m.marker);
  if (mn !== 1) { log(`${name}: VERIFY MISS — marker present ${mn} times`); restore(); continue; }
  log(`${name} applied at line ${lineOf(after, after.indexOf(m.marker))} (anchor was line ${line}), marker count ${mn}`);
  const { fails, counts } = runSuite();
  log(`${name} counts: ${JSON.stringify(counts)}`);
  log(`${name} red set (${fails.length}):`);
  for (const f of fails) log(`   RED: ${f}`);
  restore();
  log(`${name} restored-hash-match: ${sha(MD) === BEFORE ? 'YES' : 'NO'}`);
}

const st = spawnSync('git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' });
log(`\nworktree status: ${st.stdout.trim() || '(clean)'}`);
