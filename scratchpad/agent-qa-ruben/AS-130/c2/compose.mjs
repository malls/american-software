#!/usr/bin/env node
// AS-130 review: docker compose runner (docker is off PATH for sub-agents).
// usage: node compose.mjs <project> <logfile> [-f override]... -- <compose args...>
// Runs from the AS-130 worktree's apps/invoicing so relative paths in
// compose.yaml resolve; the override path is given absolute by the caller.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const W = process.env.ASC_WORKTREE ?? '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const [project, logfile, ...rest] = process.argv.slice(2);
const sep = rest.indexOf('--');
const overrides = rest.slice(0, sep);
const composeArgs = rest.slice(sep + 1);
const args = ['compose', '-p', project, '-f', `${W}/apps/invoicing/compose.yaml`, ...overrides, ...composeArgs];
const started = Date.now();
const r = spawnSync(DOCKER, args, { cwd: `${W}/apps/invoicing`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
const out = `$ docker ${args.join(' ')}\n(cwd ${W}/apps/invoicing, ${((Date.now() - started) / 1000).toFixed(1)} s, exit ${r.status})\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}\n`;
if (logfile !== '-') writeFileSync(logfile, out);
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.stderr.write(`\n[compose.mjs] exit ${r.status} in ${((Date.now() - started) / 1000).toFixed(1)} s${logfile !== '-' ? `, log ${logfile}` : ''}\n`);
process.exit(r.status ?? 1);
