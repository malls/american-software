// AC-2 / AC-3 (and extra) falsifiers for build.mjs, each on a scratch copy of
// the capture directory under a scratch repo root.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-90';
const BUILD = join(WT, 'docs/demo/d1-demo-artifact-skill/build.mjs');

function scratchRoot(label) {
  const root = join(here, `build-${label}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'docs/demo'), { recursive: true });
  mkdirSync(join(root, 'docs/design'), { recursive: true });
  cpSync(join(WT, 'docs/demo/d1'), join(root, 'docs/demo/d1'), { recursive: true });
  cpSync(join(WT, 'docs/design/tokens'), join(root, 'docs/design/tokens'), { recursive: true });
  return root;
}

function run(label, mutate) {
  const root = scratchRoot(label);
  const t = join(root, 'docs/demo/d1/transcript.txt');
  const before = readFileSync(t, 'utf8');
  const after = mutate(before, root);
  if (after !== null) {
    if (after === before) throw new Error(`[${label}] mutation is a no-op`);
    writeFileSync(t, after);
  }
  const r = spawnSync('node', [BUILD, root, join(root, 'out.html')], { encoding: 'utf8' });
  const err = (r.stderr ?? '').split('\n').find((l) => /^Error: /.test(l)) ?? (r.stderr ?? '').trim().split('\n').slice(0, 2).join(' | ');
  console.log(`[${label}] exit=${r.status} ${r.status === 0 ? '(BUILT — survived)' : err}`);
}

// control: unmodified copy builds
run('control', () => null);
// AC-2: delete one label line (step 7's)
run('ac2-label', (s) => {
  const needle = '[7/12] Contract\nREAL APP BEHAVIOUR\n';
  if (s.split(needle).length !== 2) throw new Error('anchor');
  return s.replace(needle, '[7/12] Contract\n');
});
// AC-3: change one word in the CAN/CANNOT block
run('ac3-word', (s) => {
  const needle = '- Screens 2-7. They are not built.';
  if (s.split(needle).length !== 2) throw new Error('anchor');
  return s.replace(needle, '- Screens 2-7. They are now built.');
});
// extra: a STOPPED run / truncated transcript (no epilogue sentence)
run('x-truncated', (s) => s.replace(/\nNone of these creates a charge.*\n?$/, '\n'));
// extra: a missing PNG
run('x-missing-png', (s, root) => { rmSync(join(root, 'docs/demo/d1/screen-1-signup-375.png')); return null; });
// extra: capture.json disagrees with a file's state
run('x-capture-json', (s, root) => {
  const p = join(root, 'docs/demo/d1/capture.json');
  const j = JSON.parse(readFileSync(p, 'utf8'));
  j.captures[0].state = 'S1-DEFAULT-SIGNUP';
  writeFileSync(p, JSON.stringify(j));
  return null;
});
