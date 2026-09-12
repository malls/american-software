#!/usr/bin/env node
// Scratch runner: `node compose.mjs <label> <compose args...>` runs docker
// compose (absolute path) from the AS-90 worktree's apps/invoicing with the
// isolated project name, tees stdout/stderr to <label>.log / <label>.err in
// this directory, and prints exit code + the Built line + a node --test summary.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [, , label, ...args] = process.argv;
const cwd = process.env.ASC_CWD ?? '/Users/forrest/Code/american-software-company/.worktrees/AS-90/apps/invoicing';
const r = spawnSync('/usr/local/bin/docker', ['compose', '-p', 'asc-inv-as90', ...args], {
  cwd,
  env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
writeFileSync(join(here, `${label}.log`), r.stdout ?? '');
writeFileSync(join(here, `${label}.err`), r.stderr ?? '');
// The demo's own stdout starts at its title line; compose v5 prints build
// progress on stdout ahead of it. Cut there for the transcript copy.
const marker = (r.stdout ?? '').indexOf('D1 core-loop walkthrough (AS-90)\n');
if (marker >= 0) writeFileSync(join(here, `${label}.transcript.txt`), r.stdout.slice(marker));
const built = (r.stderr ?? '').split('\n').filter((l) => /Image .* Built/.test(l)).map((l) => l.trim());
console.log(`exit=${r.status} signal=${r.signal ?? ''}`);
console.log(`built: ${built.join(' | ') || '(no Built line)'}`);
const summary = (r.stdout ?? '').split('\n').filter((l) => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(l));
if (summary.length) console.log(summary.join('\n'));
console.log(`stdout lines: ${(r.stdout ?? '').split('\n').length}`);
