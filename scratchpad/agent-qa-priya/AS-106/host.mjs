// qa-priya AS-106 review helper: run `node --test` in a given dir, print the tail summary.
// usage: node host.mjs <dir> [outfile]
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [dir, outfile] = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test'], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0' } });
const out = (r.stdout || '') + (r.stderr || '');
if (outfile) writeFileSync(outfile, out);
const lines = out.split('\n');
const failing = lines.filter((l) => /^not ok|✖/.test(l));
console.log(failing.join('\n'));
console.log(lines.slice(-12).join('\n'));
console.log(`status=${r.status}`);
