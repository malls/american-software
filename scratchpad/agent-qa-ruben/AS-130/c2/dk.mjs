#!/usr/bin/env node
// AS-130 c2 review: raw docker runner (docker is off PATH for sub-agents).
// usage: node dk.mjs <docker args...>
import { spawnSync } from 'node:child_process';
const r = spawnSync('/usr/local/bin/docker', process.argv.slice(2), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
process.exit(r.status ?? 1);
