#!/usr/bin/env node
// bin/compose-run.mjs — AS-106: the one way to take a counted compose receipt.
//
//   node apps/chat/bin/compose-run.mjs --project asc-<stage>-as<n> --cwd <worktree>/apps/chat [--log <file>]
//   node apps/chat/bin/compose-run.mjs --check
//
// A counted run: guards the -p name (asc-* only, never production, never a
// project compose already reports), refuses when the daemon already carries
// >= ASC_NETWORK_CEILING (20) asc-* networks, runs `compose run --rm --build
// test`, ALWAYS runs `down -v --rmi local --remove-orphans`, asserts nothing
// of the project survives, and prints the receipt. `--check` lists every
// asc-* network as production / live / leftover with an owner guess and
// removes nothing. Exit codes: lib/compose-run.js EXIT. Docker is resolved by
// absolute path (ADVANCE_DOCKER_BIN, else the watcher's candidate list) —
// it is off PATH in ticks.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDockerBin } from '../watch/advance-watcher.mjs';
import { DEFAULT_CEILING, EXIT, composeProjectName, formatReceipt, runCheck, runCounted } from '../lib/compose-run.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS = resolve(HERE, '..', '..');

function parseArgs(argv) {
  const opts = { check: false, project: null, cwd: null, log: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--project') opts.project = argv[++i];
    else if (a === '--cwd') opts.cwd = argv[++i];
    else if (a === '--log') opts.log = argv[++i];
    else { console.error(`compose-run: unknown argument ${a}`); process.exit(2); }
  }
  return opts;
}

/** The `name:` of every apps/x/compose.yaml — the names this tool never touches. */
export function productionProjectNames(appsDir = APPS) {
  const names = [];
  for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(appsDir, entry.name, 'compose.yaml');
    if (!existsSync(file)) continue;
    const name = composeProjectName(readFileSync(file, 'utf8'));
    if (name) names.push(name);
  }
  return names;
}

const exec = (argv, opts = {}) => {
  const [bin, ...args] = argv;
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const docker = resolveDockerBin(process.env, existsSync);
  if (!docker.bin) { console.error(`compose-run: docker not runnable (${docker.reason})`); process.exit(2); }
  const productionNames = productionProjectNames();

  if (opts.check) {
    const { exit, classified, count } = runCheck(exec, { docker: docker.bin, productionNames });
    console.log(`asc-* networks: ${count} (ceiling ${process.env.ASC_NETWORK_CEILING || DEFAULT_CEILING})`);
    for (const n of classified.production) console.log(`  production  ${n}`);
    for (const n of classified.live) console.log(`  live        ${n}`);
    for (const l of classified.leftover) console.log(`  leftover    ${l.network}  (${l.owner})`);
    console.log(classified.leftover.length ? `${classified.leftover.length} leftover — removed nothing; owners tear down with: docker compose -p <project> down -v --rmi local --remove-orphans` : 'no leftovers');
    process.exit(exit);
  }

  if (!opts.project || !opts.cwd) { console.error('usage: compose-run.mjs --project asc-<stage>-as<n> --cwd <dir> [--log <file>] | --check'); process.exit(2); }
  const ceiling = Number(process.env.ASC_NETWORK_CEILING) || DEFAULT_CEILING;
  const result = runCounted(exec, {
    docker: docker.bin, project: opts.project, cwd: opts.cwd, productionNames, env: process.env, ceiling,
    onOutput: (out) => { if (opts.log) writeFileSync(opts.log, out); },
  });
  if (result.refused) {
    console.error(`compose-run: refusing (exit ${result.exit}): ${result.refused}`);
    process.exit(result.exit);
  }
  console.log(formatReceipt(result));
  if (result.exit === EXIT.NO_BUILD) console.error('compose-run: no `Built` line — this run is not a receipt (CLAUDE.md --build corollary)');
  if (result.exit === EXIT.LEAK) console.error('compose-run: LEAK — the project survived its own teardown; this run is not a receipt');
  process.exit(result.exit);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
