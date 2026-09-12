// AS-132 QA: run `node --test` in a given apps/chat dir, write the full log, print the tail.
// usage: node run-host.mjs <cwd> <logfile>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [cwd, logfile] = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test'], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const out = (r.stdout ?? '') + (r.stderr ?? '');
writeFileSync(logfile, out);
const lines = out.trim().split('\n');
console.log(lines.slice(-12).join('\n'));
console.log(`exit=${r.status}`);
