// AS-130 review: AC-1, AC-2, AC-3 falsifiers for build.mjs, in scratch copies
// (never the worktree). Each mutant: assert the mutation applied, run the
// build, record the thrown message. Control: unmutated scratch copy builds.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130';
const SCRATCH = join(S, 'scratch-build');
rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });

/** A scratch repo-root holding only what build.mjs reads. */
function freshRoot(name, { fromMaster = false } = {}) {
  const root = join(SCRATCH, name);
  mkdirSync(join(root, 'docs', 'design', 'tokens'), { recursive: true });
  mkdirSync(join(root, 'docs', 'demo'), { recursive: true });
  cpSync(join(W, 'docs', 'design', 'tokens', 'tokens.css'), join(root, 'docs', 'design', 'tokens', 'tokens.css'));
  if (fromMaster) {
    // master's docs/demo/d1 via git archive
    mkdirSync(join(root, 'docs', 'demo', 'd1'), { recursive: true });
    const tar = execFileSync('git', ['-C', W, 'archive', 'master', 'docs/demo/d1'], { maxBuffer: 64 * 1024 * 1024 });
    const r = spawnSync('tar', ['-x', '-C', root], { input: tar });
    if (r.status !== 0) throw new Error('tar failed');
  } else {
    cpSync(join(W, 'docs', 'demo', 'd1'), join(root, 'docs', 'demo', 'd1'), { recursive: true });
  }
  return root;
}

function build(root, script) {
  const r = spawnSync('node', [script, root, join(root, 'out.html')], { encoding: 'utf8' });
  const err = (r.stderr.match(/Error: (.*)/) ?? [])[1] ?? null;
  return { status: r.status, stdout: r.stdout.trim(), error: err };
}

const BRANCH_BUILD = join(W, '.claude', 'skills', 'd1-demo-artifact', 'build.mjs');
const MASTER_BUILD = join(SCRATCH, 'master-build.mjs');
writeFileSync(MASTER_BUILD, execFileSync('git', ['-C', W, 'show', 'master:.claude/skills/d1-demo-artifact/build.mjs'], { encoding: 'utf8' }));

const results = [];
const record = (name, expectRed, r) => {
  const red = r.status !== 0;
  results.push({ name, expectRed, red, ok: red === expectRed, error: r.error, lastStdout: r.stdout.split('\n').pop() });
  console.log(`${red === expectRed ? 'OK ' : 'XX '} ${name}: exit ${r.status}${r.error ? ` — ${r.error.slice(0, 160)}` : ''}${!red ? ` — ${r.stdout.split('\n')[2] ?? ''}` : ''}`);
};

// control
{
  const root = freshRoot('control');
  record('control: unmutated scratch copy builds (branch build.mjs)', false, build(root, BRANCH_BUILD));
}

// AC-1: one word of the block changed
{
  const root = freshRoot('ac1-word');
  const p = join(root, 'docs', 'demo', 'd1', 'transcript.txt');
  const t = readFileSync(p, 'utf8');
  const m = t.replace('- Email of any kind. There is no email provider, by design.', '- Email of any kind. There is no email provider, by choice.');
  if (m === t) throw new Error('AC-1 mutation did not apply');
  writeFileSync(p, m);
  console.log('  [AC-1] mutation applied: "by design" -> "by choice" in the CANNOT block');
  record('AC-1: one word changed inside the block -> digest mismatch', true, build(root, BRANCH_BUILD));
}

// AC-2: a bullet appended after the block's last line — branch refuses
{
  const root = freshRoot('ac2-branch');
  const p = join(root, 'docs', 'demo', 'd1', 'transcript.txt');
  const t = readFileSync(p, 'utf8');
  const last = '  state machine, not Stripe\'s delivery.\n';
  if (!t.includes(last)) throw new Error('AC-2 anchor missing');
  const m = t.replace(last, `${last}- A bullet nobody pinned.\n`);
  writeFileSync(p, m);
  const idx = m.indexOf('- A bullet nobody pinned.');
  console.log(`  [AC-2] mutation applied on branch transcript at offset ${idx}; next chars after it: ${JSON.stringify(m.slice(idx + 25, idx + 28))}`);
  record('AC-2 (branch build.mjs): bullet appended after the block -> digest mismatch', true, build(root, BRANCH_BUILD));
}

// AC-2 before: master's build.mjs + master's transcript with the same appended bullet — expected SURVIVOR (builds)
{
  const root = freshRoot('ac2-master', { fromMaster: true });
  const p = join(root, 'docs', 'demo', 'd1', 'transcript.txt');
  const t = readFileSync(p, 'utf8');
  const last = '  state machine, not Stripe\'s delivery.\n';
  if (!t.includes(last)) throw new Error('AC-2 master anchor missing');
  writeFileSync(p, t.replace(last, `${last}- A bullet nobody pinned.\n`));
  console.log('  [AC-2 before] mutation applied on master transcript');
  const r = build(root, MASTER_BUILD);
  record('AC-2 before (master build.mjs, master record): same mutant BUILDS (F3 survivor, the before)', false, r);
  if (r.status === 0) {
    const html = readFileSync(join(root, 'out.html'), 'utf8');
    console.log(`  [AC-2 before] appended bullet present on master's page: ${html.includes('A bullet nobody pinned')} (F3: the digest passed and the bullet is missing from the page)`);
  }
  // and control: master build on unmutated master record
  const root2 = freshRoot('ac2-master-control', { fromMaster: true });
  record('control: master build.mjs on master record builds', false, build(root2, MASTER_BUILD));
}

// AC-3a: one PNG removed
{
  const root = freshRoot('ac3-png');
  const p = join(root, 'docs', 'demo', 'd1', 'screen-5-default-paid-1280.png');
  rmSync(p);
  console.log(`  [AC-3a] mutation applied: screen-5-default-paid-1280.png exists = ${existsSync(p)}`);
  record('AC-3a: one PNG removed -> missing screenshot', true, build(root, BRANCH_BUILD));
}

// AC-3b: one state renamed in capture.json
{
  const root = freshRoot('ac3-state');
  const p = join(root, 'docs', 'demo', 'd1', 'capture.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const hit = c.captures.find((x) => x.file === 'screen-2-return-ready-375.png');
  hit.state = 'S2-RETURN-NOTREADY';
  writeFileSync(p, JSON.stringify(c, null, 2));
  console.log(`  [AC-3b] mutation applied: capture.json now says ${hit.file} is ${JSON.parse(readFileSync(p, 'utf8')).captures.find((x) => x.file === hit.file).state}`);
  record('AC-3b: one state renamed in capture.json -> does not record', true, build(root, BRANCH_BUILD));
}

// probe past the list: capture.json with an extra capture entry (count disagreement)
{
  const root = freshRoot('probe-extra');
  const p = join(root, 'docs', 'demo', 'd1', 'capture.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  c.captures.push({ ...c.captures[0], file: 'screen-9-extra-375.png' });
  writeFileSync(p, JSON.stringify(c, null, 2));
  console.log(`  [probe] capture.json now records ${c.captures.length}`);
  record('probe: capture.json records 35, script lays out 34 -> the two lists disagree', true, build(root, BRANCH_BUILD));
}

// probe past the list: layer dropped from capture.json for #6
{
  const root = freshRoot('probe-layer');
  const p = join(root, 'docs', 'demo', 'd1', 'capture.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const hit = c.captures.find((x) => x.file === 'screen-3-empty-firstrun-375.png');
  delete hit.layer;
  writeFileSync(p, JSON.stringify(c, null, 2));
  console.log('  [probe] layer removed from screen-3-empty-firstrun-375.png');
  record('probe: layer dropped from capture.json -> does not record (layer)', true, build(root, BRANCH_BUILD));
}

// probe past the list: media dropped for the print PNG
{
  const root = freshRoot('probe-media');
  const p = join(root, 'docs', 'demo', 'd1', 'capture.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const hit = c.captures.find((x) => x.file === 'screen-7-default-1280-print.png');
  delete hit.media;
  writeFileSync(p, JSON.stringify(c, null, 2));
  console.log('  [probe] media removed from screen-7-default-1280-print.png');
  record('probe: media dropped from capture.json -> does not record (media)', true, build(root, BRANCH_BUILD));
}

// probe past the list: a merge commit missing
{
  const root = freshRoot('probe-merge');
  const p = join(root, 'docs', 'demo', 'd1', 'capture.json');
  const c = JSON.parse(readFileSync(p, 'utf8'));
  delete c.screenMergeCommits['6'];
  writeFileSync(p, JSON.stringify(c, null, 2));
  console.log('  [probe] screenMergeCommits[6] removed');
  record('probe: no merge commit for screen 6 -> names no merge commit', true, build(root, BRANCH_BUILD));
}

// probe past the list: block with NO empty line after it (blank line removed) — the new end rule's edge
{
  const root = freshRoot('probe-noblank');
  const p = join(root, 'docs', 'demo', 'd1', 'transcript.txt');
  const t = readFileSync(p, 'utf8');
  const last = '  state machine, not Stripe\'s delivery.\n\n';
  if (!t.includes(last)) throw new Error('probe anchor missing');
  writeFileSync(p, t.replace(last, '  state machine, not Stripe\'s delivery.\n'));
  console.log('  [probe] blank line after the block removed (block now runs into the intro paragraph)');
  record('probe: blank line after block removed -> digest mismatch (block extends to next blank line)', true, build(root, BRANCH_BUILD));
}

// probe: empty PNG
{
  const root = freshRoot('probe-empty');
  const p = join(root, 'docs', 'demo', 'd1', 'screen-1-signin-375.png');
  writeFileSync(p, '');
  console.log('  [probe] screen-1-signin-375.png truncated to 0 bytes');
  record('probe: empty PNG -> empty screenshot', true, build(root, BRANCH_BUILD));
}

const okCount = results.filter((r) => r.ok).length;
console.log(`\nmutants+controls: ${results.length}; behaved as predicted: ${okCount}; unexpected: ${results.length - okCount}`);
writeFileSync(join(S, 'build-falsifiers.json'), JSON.stringify(results, null, 2));
rmSync(SCRATCH, { recursive: true, force: true });
