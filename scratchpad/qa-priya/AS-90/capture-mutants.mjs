// AC-5 falsifiers on SCRATCH copies of capture.mjs. Each asserts its mutation applied
// exactly once at the intended site, runs against the scratch web on 8349 (or a dead
// port), and reports exit code + files written.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-90/.claude/skills/d1-demo-artifact/capture.mjs';
const DIR = '/Users/forrest/Code/american-software-company/scratchpad/qa-priya/AS-90/mut';
const orig = readFileSync(SRC, 'utf8');
const SITE = "{ file: 'screen-1-signin-375.png', width: 375, height: 812, mobile: true, path: '/signin', state: 'S1-DEFAULT-SIGNIN' },";
if (orig.split(SITE).length !== 2) throw new Error('first CAPTURES row not found exactly once');

function attempt(label, mutate, base) {
  const out = `${DIR}/cap-${label}`;
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const file = `${DIR}/capture.${label}.mjs`;
  const t = mutate(orig);
  if (label !== 'dead-port' && t === orig) throw new Error(`${label}: mutation did not apply`);
  writeFileSync(file, t);
  const r = spawnSync('node', [file, '--base', base, '--out', out, '--commit', 'afac7a0'], { encoding: 'utf8', timeout: 120_000 });
  const files = readdirSync(out);
  const msg = (r.stderr.trim().split('\n').pop() ?? '').slice(0, 160);
  console.log(`${label}: exit=${r.status}; files written=${files.length} ${JSON.stringify(files)}\n   ${msg}`);
}

attempt('dead-port', (s) => s, 'http://127.0.0.1:8350');
attempt('404-path', (s) => s.replace(SITE, SITE.replace("path: '/signin'", "path: '/nope'")), 'http://127.0.0.1:8349');
attempt('root-redirect', (s) => s.replace(SITE, SITE.replace("path: '/signin'", "path: '/'")), 'http://127.0.0.1:8349');
attempt('wrong-state', (s) => s.replace(SITE, SITE.replace("state: 'S1-DEFAULT-SIGNIN'", "state: 'S1-DEFAULT-SIGNUP'")), 'http://127.0.0.1:8349');
// healthz on a server that is up but is not this app: the chat server on 8347
attempt('other-app', (s) => s, 'http://127.0.0.1:8347');
