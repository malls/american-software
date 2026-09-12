// Run the apps/chat host suite in a given checkout, write the full output to a
// log, print the summary line. Usage: node run-host.mjs <chat-dir> <log-path>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [dir, log] = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(log, out + `\nexit ${r.status}\n`);
const pick = (k) => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1];
console.log(`tests ${pick('tests')} pass ${pick('pass')} fail ${pick('fail')} skipped ${pick('skipped')} exit ${r.status}`);
const fails = [...out.matchAll(/^✖ (.*) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]);
for (const f of fails) console.log('  RED: ' + f);
