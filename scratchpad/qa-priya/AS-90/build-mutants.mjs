// AC-2 / AC-3 + probes: mutate a SCRATCH copy of docs/demo/d1/transcript.txt and
// run build.mjs against a scratch repo root. Worktree untouched.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-90';
const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/qa-priya/AS-90/scratch-root';
const BUILD = `${WT}/.claude/skills/d1-demo-artifact/build.mjs`;
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(`${ROOT}/docs/design/tokens`, { recursive: true });
cpSync(`${WT}/docs/demo/d1`, `${ROOT}/docs/demo/d1`, { recursive: true });
cpSync(`${WT}/docs/design/tokens/tokens.css`, `${ROOT}/docs/design/tokens/tokens.css`);
const orig = readFileSync(`${ROOT}/docs/demo/d1/transcript.txt`, 'utf8');

function attempt(label, mutate) {
  const t = mutate(orig);
  if (t === orig) throw new Error(`${label}: mutation did not apply`);
  writeFileSync(`${ROOT}/docs/demo/d1/transcript.txt`, t);
  const r = spawnSync('node', [BUILD, ROOT, `${ROOT}/out-${label}.html`], { encoding: 'utf8' });
  const err = r.stderr.split('\n').find((l) => /Error:/.test(l)) ?? '(no error)';
  console.log(`${label}: exit=${r.status}  ${r.status === 0 ? 'BUILT (survived)' : err.replace(/^.*Error: /, '').slice(0, 140)}`);
  return r;
}
// baseline on the scratch root
writeFileSync(`${ROOT}/docs/demo/d1/transcript.txt`, orig);
const b = spawnSync('node', [BUILD, ROOT, `${ROOT}/out-baseline.html`], { encoding: 'utf8' });
console.log(`baseline: exit=${b.status}`);

// AC-2: delete one label line (step 6's)
attempt('ac2-delete-label', (t) => t.replace('[6/12] Client\nREAL APP BEHAVIOUR\n', '[6/12] Client\n'));
// AC-2 variant: delete one header instead (label without a step)
attempt('ac2-delete-header', (t) => t.replace('[6/12] Client\nREAL APP BEHAVIOUR\n', 'REAL APP BEHAVIOUR\n'));
// AC-3: change one word inside the block
attempt('ac3-one-word', (t) => t.replace('- Screens 2-7. They are not built.', '- Screens 2-7. They are not built yet.'));
// AC-3 variant: change a word in the CAN half
attempt('ac3-can-word', (t) => t.replace('the platform key never charges anyone', 'the platform key rarely charges anyone'));
// probe: truncated transcript (no epilogue sentence)
attempt('probe-truncated', (t) => t.replace(/None of these creates a charge.*\n?$/, ''));
// probe: a STOPPED run pasted as a transcript
attempt('probe-stopped', (t) => t.replace('[12/12] Read back\n', 'STOPPED at step 12: reviewer\n[12/12] Read back\n'));
// probe: a bullet APPENDED after the block's end marker — does the build silently drop it?
attempt('probe-appended-bullet', (t) => t.replace("  state machine, not Stripe's delivery.\n", "  state machine, not Stripe's delivery.\n- A fifth CANNOT bullet the demo never printed.\n"));
// probe: a fourth label string
attempt('probe-fourth-label', (t) => t.replace('[6/12] Client\nREAL APP BEHAVIOUR\n', '[6/12] Client\nREAL APP BEHAVIOR\n'));
