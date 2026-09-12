// Host suite runner: node run-host.mjs <apps/chat dir> [label] [--filter <regex>]
// Prints the summary block and the failing test names; writes full output to host-<label>.log.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [cwd, label = 'run', ...rest] = process.argv.slice(2);
const args = ['--test'];
const fi = rest.indexOf('--filter');
if (fi >= 0) args.push('--test-name-pattern', rest[fi + 1]);
const r = spawnSync('node', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(join(HERE, `host-${label}.log`), out);
const summary = out.match(/ℹ tests \d+[\s\S]*?ℹ duration_ms [\d.]+/);
const failing = [...new Set([...out.matchAll(/^✖ ([^\n]+?) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]).filter((n) => !n.startsWith('test/')))];
console.log(`[${label}] cwd=${cwd}`);
console.log(summary ? summary[0] : out.slice(-1500));
console.log(`failing (${failing.length}):`);
for (const f of failing) console.log('  - ' + f);
console.log('exit', r.status);
