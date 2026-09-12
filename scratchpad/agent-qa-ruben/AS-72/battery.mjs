// AS-72 QA mutation battery (agent:qa-ruben). Mutates the worktree IN PLACE with
// backup + finally-restore, asserts each mutation applied at the intended site
// (occurrence-accurate, region-scoped), runs the named test file, records the
// exact failing test set, restores, proves by sha256 + git status --porcelain.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-72';
const CHAT = WT + '/apps/chat';
const APP = CHAT + '/public/app.js';
const MD = CHAT + '/public/markdown.js';
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function failing(testFile) {
  const r = spawnSync('node', ['--test', '--test-reporter=tap', testFile], { cwd: CHAT, encoding: 'utf8', maxBuffer: 1e8 });
  const out = r.stdout + r.stderr;
  const fails = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  const total = (out.match(/^# tests (\d+)/m) || [])[1];
  return { fails, total, status: r.status };
}

function runMutant(name, file, testFile, mutate) {
  const orig = fs.readFileSync(file, 'utf8');
  const h0 = sha(file);
  let result;
  try {
    const { next, applied } = mutate(orig);
    if (!applied) throw new Error(name + ': mutation did NOT apply at intended site');
    if (next === orig) throw new Error(name + ': mutation produced identical content');
    fs.writeFileSync(file, next);
    result = failing(testFile);
  } finally {
    fs.writeFileSync(file, orig);
  }
  const h1 = sha(file);
  const porcelain = spawnSync('git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim();
  console.log(`\n=== ${name}`);
  console.log(`tests ran: ${result.total}, exit ${result.status}`);
  console.log(`RED SET (${result.fails.length}):`);
  for (const f of result.fails) console.log('  - ' + f);
  console.log(`restore: sha match=${h0 === h1}; porcelain='${porcelain}'`);
}

const which = process.argv[2];

// R1 — Ruben's original demonstrated shape: an extra similar-shape timer call
// BELOW the anchored region (after init() closes, i.e. after `init().catch(`).
if (!which || which === 'R1') runMutant('R1 extra setTimeout below init()', APP, 'test/api.test.js', (s) => {
  const anchor = 'init().catch(';
  const idx = s.indexOf(anchor);
  const count = s.split(anchor).length - 1;
  if (idx < 0 || count !== 1) return { applied: false };
  const lineEnd = s.indexOf('\n', idx);
  const next = s.slice(0, lineEnd + 1) + 'setTimeout(() => {}, 60_000);\n' + s.slice(lineEnd + 1);
  return { next, applied: next.indexOf('setTimeout(() => {}, 60_000);') > idx };
});

// M1 — plan mutant: inside the reconcile interval body, 60_000 -> 5_000 and a nested setTimeout(fn, 60_000).
if (!which || which === 'M1') runMutant('M1 nested setTimeout + 5_000 cadence', APP, 'test/api.test.js', (s) => {
  const initAt = s.indexOf('async function init()');
  const initEnd = s.indexOf('init().catch(');
  const region = s.slice(initAt, initEnd);
  const re = /setInterval\(\(\) => \{\n(\s*)refreshSidebar\(\)\.catch\(\(\) => \{\}\);\n(\s*)\}, 60_000\);/;
  const m = region.match(re);
  if (!m) return { applied: false };
  const replaced = region.replace(re, `setInterval(() => {\n$1refreshSidebar().catch(() => {});\n$1setTimeout(() => {}, 60_000);\n$2}, 5_000);`);
  const applied = replaced !== region && (replaced.match(/setTimeout\(\(\) => \{\}, 60_000\)/g) || []).length === 1 && replaced.includes('}, 5_000);');
  return { next: s.slice(0, initAt) + replaced + s.slice(initEnd), applied };
});

// M4 — drop the alnum first-host-char from URL_RE.
if (!which || which === 'M4') runMutant('M4 URL_RE drops alnum first-host-char', MD, 'test/markdown.test.js', (s) => {
  const from = 'const URL_RE = /https?:\\/\\/[A-Za-z0-9][^\\s<>"\'`\\\\\\p{Cf}]*/gu;';
  const to = 'const URL_RE = /https?:\\/\\/[^\\s<>"\'`\\\\\\p{Cf}]*/gu;';
  const count = s.split(from).length - 1;
  if (count !== 1) return { applied: false };
  return { next: s.replace(from, to), applied: true };
});

// M5 — remove the en dash from SENTENCE_TAIL.
if (!which || which === 'M5') runMutant('M5 en dash removed from SENTENCE_TAIL', MD, 'test/markdown.test.js', (s) => {
  const from = "const SENTENCE_TAIL = '.,;:!?–—…';";
  const to = "const SENTENCE_TAIL = '.,;:!?—…';";
  const count = s.split(from).length - 1;
  if (count !== 1) return { applied: false };
  return { next: s.replace(from, to), applied: true };
});

// M6 — drop \p{Cf} from URL_RE (keep the u flag so the regex still compiles the same way).
if (!which || which === 'M6') runMutant('M6 \\p{Cf} dropped from URL_RE', MD, 'test/markdown.test.js', (s) => {
  const from = 'const URL_RE = /https?:\\/\\/[A-Za-z0-9][^\\s<>"\'`\\\\\\p{Cf}]*/gu;';
  const to = 'const URL_RE = /https?:\\/\\/[A-Za-z0-9][^\\s<>"\'`\\\\]*/gu;';
  const count = s.split(from).length - 1;
  if (count !== 1) return { applied: false };
  return { next: s.replace(from, to), applied: true };
});
