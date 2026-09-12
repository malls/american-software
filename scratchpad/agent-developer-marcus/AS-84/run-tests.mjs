// Runs `node --test <files>` in the AS-84 worktree's apps/chat with an optional
// PATH override, writes the full TAP to a log, and prints the summary lines and
// the exit code. Usage:
//   node run-tests.mjs <logName> [--nogit] [files...]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = '/Users/forrest/Code/american-software-company/.worktrees/AS-84/apps/chat';
const [logName, ...rest] = process.argv.slice(2);
const nogit = rest.includes('--nogit');
const files = rest.filter((a) => a !== '--nogit');
const env = { ...process.env };
if (nogit) env.PATH = join(here, 'emptypath');

const r = spawnSync(process.execPath, ['--test', ...files], { cwd: APP, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(join(here, logName), out);
const lines = out.split('\n');
for (const l of lines) {
  if (/^(ℹ (tests|suites|pass|fail|cancelled|skipped|todo)|[✔✖﹣] AS-8[24] entry point)/.test(l)) console.log(l);
  if (/git init failed|git not runnable/.test(l)) console.log('   ' + l.trim());
}
console.log(`exit=${r.status} signal=${r.signal}`);
