#!/usr/bin/env node
// AS-57 mutation harness (Lena). One counted compose run per invocation.
//   node mutate.mjs <name> [mutation]
// <name>     -> project asc-impl-as57-<name>; node --test output in <name>.log, receipt in <name>.receipt
// [mutation] -> one of the recipes below (omit for a plain run). Each recipe: back up / plant,
//              assert the mutation landed, run, ALWAYS restore, then print git porcelain for the
//              guarded paths (must be empty).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/forrest/Code/american-software-company';
const WT = join(ROOT, '.worktrees', 'AS-57');
const APP = join(WT, 'apps', 'invoicing');
const SP = join(ROOT, 'scratchpad', 'agent-developer-lena', 'AS-57');
const [name, mutation] = process.argv.slice(2);
if (!name) { console.error('usage: mutate.mjs <name> [mutation]'); process.exit(2); }

const restores = [];
// Backups live OUTSIDE the worktree: since item 1 the whole app directory is
// the image, so a `<file>.as57bak` beside the original is itself an
// unclassified file in the closed world (observed on the first M3 run).
const backup = (f) => { const b = join(SP, `${name}.bak-${f.split('/').pop()}`); copyFileSync(f, b); restores.push(() => renameSync(b, f)); };
const plant = (f, text) => { mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); restores.push(() => rmSync(f, { force: true })); };
const assertApplied = (ok, what) => { if (!ok) { console.error(`MUTATION DID NOT APPLY: ${what}`); restoreAll(); process.exit(99); } };
const restoreAll = () => { while (restores.length) restores.pop()(); };
const has = (f, needle) => readFileSync(f, 'utf8').includes(needle);

const M1B_BLOCK = [
  'COPY apps/invoicing/app.js apps/invoicing/server.js ./',
  'COPY apps/invoicing/lib ./lib',
  'COPY apps/invoicing/routes ./routes',
  'COPY apps/invoicing/views ./views',
  'COPY apps/invoicing/public ./public',
  'COPY apps/invoicing/test ./test',
  'COPY apps/invoicing/demo ./demo',
  'COPY apps/invoicing/compose.yaml apps/invoicing/Dockerfile ./',
].join('\n');

const recipes = {
  // item 1, the record's reproducer: a NEW top-level file with an outbound healthcheck
  m1() {
    const f = join(APP, 'compose.override.yaml');
    plant(f, 'services:\n  web:\n    healthcheck:\n      test: ["CMD", "node", "-e", "fetch(\'https://example.invalid/\')"]\n');
    assertApplied(existsSync(f) && has(f, 'example.invalid'), 'compose.override.yaml');
    console.log(`--- planted ${f}:\n${readFileSync(f, 'utf8')}`);
  },
  // item 1, the pin: explicit COPY list reintroduced in place of the whole-directory COPY
  m1b() {
    const f = join(APP, 'Dockerfile');
    backup(f);
    const before = readFileSync(f, 'utf8');
    const after = before.replace(/^COPY apps\/invoicing \.\/\n/m, `${M1B_BLOCK}\n`);
    writeFileSync(f, after);
    assertApplied(after !== before && has(f, 'COPY apps/invoicing/lib ./lib') && !/^COPY apps\/invoicing \.\/$/m.test(after), 'Dockerfile COPY block');
    console.log('--- mutated Dockerfile diff:'); console.log(spawnSync('git', ['-C', WT, 'diff', '--', 'apps/invoicing/Dockerfile'], { encoding: 'utf8' }).stdout);
  },
  // item 2, the record's reproducer: a nested skip-named directory
  m2() {
    const f = join(APP, 'lib', 'vendor', 'probe.js');
    plant(f, "fetch('https://example.invalid/');\n");
    restores.push(() => rmSync(join(APP, 'lib', 'vendor'), { recursive: true, force: true }));
    assertApplied(existsSync(f) && has(f, 'example.invalid'), 'lib/vendor/probe.js');
    console.log(`--- planted ${f}`);
  },
  // item 3, the record's reproducer: escaped quote before ` #` in a double-quoted scalar
  m3() {
    const f = join(APP, 'compose.yaml');
    backup(f);
    const lines = readFileSync(f, 'utf8').split('\n');
    assertApplied(lines[30] === '  web:', `line 31 is ${JSON.stringify(lines[30])}, expected "  web:"`);
    lines.splice(31, 0, `    container_name: "asc-inv \\" # fetch('https://example.invalid/')"`);
    writeFileSync(f, lines.join('\n'));
    assertApplied(has(f, 'example.invalid'), 'compose.yaml line 32');
    console.log('--- mutated compose.yaml lines 30-33:'); console.log(lines.slice(29, 33).join('\n'));
  },
  // item 4 (i): .DS_Store planted with the ignore line in place -> expect GREEN
  m4i() {
    const f = join(APP, 'lib', '.DS_Store');
    plant(f, 'Bud1');
    assertApplied(existsSync(f), 'lib/.DS_Store');
    const ci = spawnSync('git', ['-C', WT, 'check-ignore', '-q', 'apps/invoicing/lib/.DS_Store']);
    console.log(`--- planted ${f}; git check-ignore exit=${ci.status} (0 = ignored)`);
  },
  // item 4 (ii): same plant, .dockerignore line removed -> expect red
  m4ii() {
    const f = join(APP, 'lib', '.DS_Store');
    plant(f, 'Bud1');
    const ig = join(WT, '.dockerignore');
    backup(ig);
    const before = readFileSync(ig, 'utf8');
    const after = before.split('\n').filter((l) => l !== '**/.DS_Store').join('\n');
    writeFileSync(ig, after);
    // The pattern LINE must be gone; the explanatory comment above it (which
    // names .DS_Store) is prose and stays.
    const patternLines = readFileSync(ig, 'utf8').split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'));
    assertApplied(existsSync(f) && before !== after && !patternLines.includes('**/.DS_Store') && patternLines.length === 6, `.dockerignore line removal (patterns now: ${patternLines.join(' ')})`);
    console.log(`--- planted ${f}; .dockerignore now:\n${readFileSync(ig, 'utf8')}`);
  },
  // cycle 2, Ruben's F1 reproducer (his P1): a HOST-side top-level vendor/probe.js with an
  // outbound client, imported by lib/vendor.js. No new scanned file, so no count changes.
  p1() {
    const d = join(APP, 'vendor');
    const f = join(d, 'probe.js');
    const lib = join(APP, 'lib', 'vendor.js');
    backup(lib);
    plant(f, "export function probe() { return fetch('https://example.invalid/'); }\n");
    restores.push(() => rmSync(d, { recursive: true, force: true }));
    const before = readFileSync(lib, 'utf8');
    writeFileSync(lib, "import { probe as __asProbe } from '../vendor/probe.js';\nexport const __asProbeRef = __asProbe;\n" + before);
    assertApplied(existsSync(f) && has(f, 'example.invalid') && has(lib, "from '../vendor/probe.js'"), 'vendor/probe.js + lib/vendor.js import');
    console.log('--- planted vendor/probe.js; lib/vendor.js diff:'); console.log(spawnSync('git', ['-C', WT, 'diff', '--', 'apps/invoicing/lib/vendor.js'], { encoding: 'utf8' }).stdout);
  },
  // cycle 2, half of p1: the vendor file alone, nothing imports it. Only the directory pin should fire.
  p1a() {
    const d = join(APP, 'vendor');
    const f = join(d, 'probe.js');
    plant(f, "export function probe() { return fetch('https://example.invalid/'); }\n");
    restores.push(() => rmSync(d, { recursive: true, force: true }));
    assertApplied(existsSync(f) && has(f, 'example.invalid'), 'vendor/probe.js');
    console.log(`--- planted ${f}`);
  },
  // cycle 2, Ruben's F2: lib/ imports test/helpers/stripe-double.js (exists, carries fetch). Only assertion 5 should fire.
  f2() {
    const lib = join(APP, 'lib', 'vendor.js');
    backup(lib);
    const before = readFileSync(lib, 'utf8');
    writeFileSync(lib, "import * as __asDouble from '../test/helpers/stripe-double.js';\nexport const __asDoubleRef = __asDouble;\n" + before);
    assertApplied(has(lib, "from '../test/helpers/stripe-double.js'") && existsSync(join(APP, 'test', 'helpers', 'stripe-double.js')), 'lib/vendor.js import of test/helpers');
    console.log('--- lib/vendor.js diff:'); console.log(spawnSync('git', ['-C', WT, 'diff', '--', 'apps/invoicing/lib/vendor.js'], { encoding: 'utf8' }).stdout);
  },
  // item 3, the helper's guard: the escape line deleted at the source
  m5() {
    const f = join(APP, 'test', 'helpers', 'hash-comment.js');
    backup(f);
    const before = readFileSync(f, 'utf8');
    const after = before.split('\n').filter((l) => !/quote === '"' && ch === '\\\\'/.test(l)).join('\n');
    writeFileSync(f, after);
    assertApplied(before !== after && !/ch === '\\\\'/.test(after), 'helper escape line removal');
    console.log('--- mutated helper diff:'); console.log(spawnSync('git', ['-C', WT, 'diff', '--', 'apps/invoicing/test/helpers/hash-comment.js'], { encoding: 'utf8' }).stdout);
  },
};

if (mutation && !recipes[mutation]) { console.error(`unknown mutation ${mutation}; have ${Object.keys(recipes).join(', ')}`); process.exit(2); }
process.on('exit', restoreAll);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restoreAll(); process.exit(130); });

let exitCode = 0;
try {
  if (mutation) recipes[mutation]();
  const r = spawnSync('node', ['apps/chat/bin/compose-run.mjs', '--project', `asc-impl-as57-${name}`, '--cwd', APP, '--log', join(SP, `${name}.log`)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const receipt = `${r.stdout}${r.stderr}RUN_EXIT=${r.status}\n`;
  writeFileSync(join(SP, `${name}.receipt`), receipt);
  console.log(receipt);
  exitCode = r.status ?? 1;
} finally {
  restoreAll();
}
const log = existsSync(join(SP, `${name}.log`)) ? readFileSync(join(SP, `${name}.log`), 'utf8') : '';
const failing = [...new Set(log.split('\n').filter((l) => /^✖ /.test(l) && !/^✖ failing tests:/.test(l)).map((l) => l.replace(/ \([0-9.]+ms\)$/, '')))];
console.log(`--- failing tests (${failing.length}):\n${failing.join('\n')}`);
const p = spawnSync('git', ['-C', WT, 'status', '--porcelain', '--', 'apps/invoicing', '.dockerignore', '.gitignore'], { encoding: 'utf8' });
console.log(`--- porcelain after restore (must be empty):\n${p.stdout}--- end`);
process.exit(exitCode);
