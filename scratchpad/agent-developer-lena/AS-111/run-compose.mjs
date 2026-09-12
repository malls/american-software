// Compose receipt runner: node run-compose.mjs <apps/chat dir> <label>
// Writes compose-<label>.log; prints the receipt tail incl. the Built line.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const M = '/Users/forrest/Code/american-software-company';
const [cwd, label = 'run'] = process.argv.slice(2);
const log = join(HERE, `compose-${label}.log`);
const r = spawnSync('node', [join(M, 'apps/chat/bin/compose-run.mjs'), '--project', 'asc-impl-as111', '--cwd', cwd, '--log', join(HERE, `compose-${label}-full.log`)],
  { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(log, out);
console.log(`[${label}] exit ${r.status}`);
console.log(out.slice(-3000));
