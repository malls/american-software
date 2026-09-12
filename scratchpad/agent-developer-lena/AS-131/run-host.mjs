// Run the apps/chat host suite (bare `node --test`, the package.json script)
// with cwd = the AS-131 worktree's apps/chat, and print the summary lines.
//   node scratchpad/agent-developer-lena/AS-131/run-host.mjs [<label>] [<cwd>]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const label = process.argv[2] || 'run';
const cwd = process.argv[3] || '/Users/forrest/Code/american-software-company/.worktrees/AS-131/apps/chat';
const r = spawnSync('node', ['--test'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
const log = `/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-131/host-${label}.log`;
writeFileSync(log, out);
const pick = (k) => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1];
const failing = [...out.matchAll(/^✖ (.*?) \(\d/gm)].map((m) => m[1]);
console.log(`${label}: tests=${pick('tests')} pass=${pick('pass')} fail=${pick('fail')} skipped=${pick('skipped')} exit=${r.status} log=${log}`);
if (failing.length) console.log('failing:\n  ' + failing.join('\n  '));
