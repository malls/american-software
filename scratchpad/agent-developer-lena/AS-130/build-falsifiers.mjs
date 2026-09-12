// AC-1/2/3 falsifiers for build.mjs, each on a SCRATCH COPY of the repo layout
// (docs/demo/d1 + docs/design/tokens) so the committed record is never touched.
// AC-2 also runs the appended-bullet mutant through MASTER's build.mjs against
// master's own transcript, to record the survivor that F3 closed.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/forrest/Code/american-software-company';
const W = `${ROOT}/.worktrees/AS-130`;
const S = `${ROOT}/scratchpad/agent-developer-lena/AS-130`;
const BUILD = `${W}/.claude/skills/d1-demo-artifact/build.mjs`;
const MASTER_BUILD = `${ROOT}/.claude/skills/d1-demo-artifact/build.mjs`;

const scratchRoot = (name, from = W) => {
  const dir = `${S}/scratch-build-${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(`${dir}/docs/demo`, { recursive: true });
  mkdirSync(`${dir}/docs/design`, { recursive: true });
  cpSync(`${from}/docs/demo/d1`, `${dir}/docs/demo/d1`, { recursive: true });
  cpSync(`${from}/docs/design/tokens`, `${dir}/docs/design/tokens`, { recursive: true });
  return dir;
};
const build = (script, root) => {
  const r = spawnSync('node', [script, root, `${root}/out.html`], { encoding: 'utf8' });
  const err = (r.stderr.match(/Error: (.*)/) ?? [null, ''])[1];
  return { status: r.status, stdout: r.stdout.trim(), err };
};
const mutate = (root, edit) => {
  const p = join(root, 'docs/demo/d1', edit.file);
  const before = readFileSync(p, 'utf8');
  const after = edit.fn(before);
  if (after === before) throw new Error(`${edit.file}: mutation did not apply`);
  writeFileSync(p, after);
};

const results = [];
const record = (name, expectPattern, r) => {
  const red = r.status !== 0 && expectPattern.test(r.err);
  results.push({ name, red, status: r.status, err: r.err });
  console.log(`${red ? 'RED (as expected)' : 'NOT RED — finding'}: ${name}\n  exit ${r.status}; ${r.err || r.stdout.split('\n').slice(-1)[0]}`);
};

// AC-1: one word of the block changed
{
  const root = scratchRoot('ac1');
  mutate(root, { file: 'transcript.txt', fn: (s) => s.replace('All seven screens in a real browser', 'All seven screens in a real browsers') });
  record('AC-1 one word of the block changed', /digest mismatch/, build(BUILD, root));
}
// AC-2: a bullet appended after the block's last line — new build.mjs (red) and master's (survivor)
{
  const append = (s) => s.replace("  state machine, not Stripe's delivery.\n", "  state machine, not Stripe's delivery.\n- An appended bullet that the page must not silently drop.\n");
  const root = scratchRoot('ac2');
  mutate(root, { file: 'transcript.txt', fn: append });
  record('AC-2 bullet appended after the last line (new build.mjs)', /digest mismatch/, build(BUILD, root));
  const masterRoot = scratchRoot('ac2-master', ROOT);
  mutate(masterRoot, { file: 'transcript.txt', fn: append });
  const r = build(MASTER_BUILD, masterRoot);
  results.push({ name: 'AC-2 before: same mutant through master build.mjs on master transcript', survivor: r.status === 0, status: r.status, stdout: r.stdout.split('\n')[0] });
  console.log(`${r.status === 0 ? 'SURVIVOR (the before, F3)' : 'unexpected red'}: master build.mjs on the appended-bullet mutant — exit ${r.status}; ${r.stdout.split('\n')[0]}`);
}
// AC-3a: one PNG removed
{
  const root = scratchRoot('ac3a');
  unlinkSync(join(root, 'docs/demo/d1/screen-5-default-paid-1280.png'));
  record('AC-3a one PNG removed', /missing screenshot .*screen-5-default-paid-1280\.png/, build(BUILD, root));
}
// AC-3b: one state renamed in capture.json
{
  const root = scratchRoot('ac3b');
  mutate(root, { file: 'capture.json', fn: (s) => s.replace('"state": "S5-DEFAULT-PAID"', '"state": "S5-DEFAULT-SETTLED"') });
  record('AC-3b one state renamed in capture.json', /does not record screen-5-default-paid-375\.png as S5-DEFAULT-PAID/, build(BUILD, root));
}
// extra: layer dropped from capture.json (the new layer check)
{
  const root = scratchRoot('layer');
  mutate(root, { file: 'capture.json', fn: (s) => s.replace('"layer": "S3-GATED-STRIPENOTREADY"', '"layer": "S3-GATED-NOPE"') });
  record('extra: layer renamed in capture.json', /does not record screen-3-empty-firstrun-375\.png as S3-EMPTY-FIRSTRUN at 375px with layer/, build(BUILD, root));
}
// control: the untouched record builds green and byte-identical to the committed index.html
{
  const root = scratchRoot('control');
  const r = build(BUILD, root);
  const same = readFileSync(`${root}/out.html`).equals(readFileSync(`${W}/docs/demo/d1/index.html`));
  results.push({ name: 'control: untouched record', status: r.status, identicalToCommitted: same, stdout: r.stdout });
  console.log(`control: exit ${r.status}; identical to committed index.html: ${same}\n${r.stdout.split('\n').slice(0, 3).join('\n')}`);
}
writeFileSync(`${S}/build-falsifiers.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(`\n${results.filter((r) => r.red).length} of ${results.filter((r) => 'red' in r).length} mutants red`);
