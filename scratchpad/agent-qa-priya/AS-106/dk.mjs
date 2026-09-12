// qa-priya AS-106 review helper: run docker by absolute path, print stdout+stderr.
// usage: node dk.mjs <docker args...>
import { spawnSync } from 'node:child_process';
const D = '/usr/local/bin/docker';
const r = spawnSync(D, process.argv.slice(2), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status ?? 1);
