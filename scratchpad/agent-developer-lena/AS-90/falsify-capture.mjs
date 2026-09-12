// AC-5 falsifiers for capture.mjs, each to its own scratch output dir.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SKILL = '/Users/forrest/Code/american-software-company/.worktrees/AS-90/docs/demo/d1-demo-artifact-skill/capture.mjs';
const run = (script, args, label) => {
  const out = join(here, `cap-${label}`);
  mkdirSync(out, { recursive: true });
  const r = spawnSync('node', [script, '--out', out, ...args], { encoding: 'utf8', timeout: 60_000 });
  console.log(`[${label}] exit=${r.status}`);
  console.log(`[${label}] stderr: ${(r.stderr ?? '').trim().split('\n')[0]}`);
  console.log(`[${label}] files written: ${readdirSync(out).length} (${readdirSync(out).join(', ') || 'none'})`);
};

// (a) no web at the base → exit 2, nothing written
run(SKILL, ['--base', 'http://127.0.0.1:8350'], 'a-unreachable');

// (b) scratch copy whose first capture points at `/` (no data-state) → refused, nothing written
const src = readFileSync(SKILL, 'utf8');
const anchor = "{ file: 'screen-1-signin-375.png', width: 375, height: 812, mobile: true, path: '/signin', state: 'S1-DEFAULT-SIGNIN' },";
if (src.split(anchor).length !== 2) throw new Error('anchor not exactly once');
const mutated = src.replace(anchor, "{ file: 'screen-1-signin-375.png', width: 375, height: 812, mobile: true, path: '/', state: 'S1-DEFAULT-SIGNIN' },");
const scratch = join(here, 'capture.mutant-root.mjs');
writeFileSync(scratch, mutated);
run(scratch, ['--base', 'http://127.0.0.1:8349'], 'b-root');

// (c) scratch copy that claims the signup state for the signin URL → refused (state mismatch), nothing written
const mutated2 = src.replace(anchor, "{ file: 'screen-1-signin-375.png', width: 375, height: 812, mobile: true, path: '/signin', state: 'S1-DEFAULT-SIGNUP' },");
const scratch2 = join(here, 'capture.mutant-state.mjs');
writeFileSync(scratch2, mutated2);
run(scratch2, ['--base', 'http://127.0.0.1:8349'], 'c-state');
console.log(`profiles left in /tmp: ${readdirSync('/tmp').filter((n) => n.startsWith('asc-demo-chrome-')).length}`);
