// Counted compose run with --build, project as83rev. Output tee'd to compose.txt.
import { spawnSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-83/apps/chat';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-83';
const args = process.argv.slice(2);
const label = args[0] || 'compose';
appendFileSync(`${S}/notes.md`, `${label} start ${new Date().toISOString()}\n`);
const r = spawnSync('/usr/local/bin/docker', ['compose', '-f', `${W}/compose.yaml`, '--project-directory', W, '-p', 'as83rev', 'run', '--rm', '--build', 'test'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + '\n--- STDERR ---\n' + (r.stderr || '');
writeFileSync(`${S}/${label}.txt`, out);
appendFileSync(`${S}/notes.md`, `${label} exit ${r.status} ${new Date().toISOString()}\n`);
const lines = out.split('\n');
const built = lines.filter((l) => /Built|Building|Image /.test(l));
const summary = lines.filter((l) => /^# (tests|pass|fail|duration_ms|suites)|^not ok/.test(l));
console.log('BUILD LINES:\n' + built.join('\n'));
console.log('SUMMARY:\n' + summary.join('\n'));
console.log('exit', r.status);
