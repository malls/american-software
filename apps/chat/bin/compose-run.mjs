#!/usr/bin/env node
// bin/compose-run.mjs — AS-106: the one way to take a counted compose receipt.
//
//   node apps/chat/bin/compose-run.mjs --project asc-<stage>-as<n> --cwd <worktree>/apps/chat [--log <file>]
//   node apps/chat/bin/compose-run.mjs --check
//
// A counted run: guards the -p name (asc-* only, never production, never a
// project compose already reports), refuses when the daemon already carries
// >= ASC_NETWORK_CEILING (20) asc-* networks, runs `compose run --rm --build
// test`, ALWAYS runs `down -v --rmi local --remove-orphans` (also after a
// SIGINT/SIGTERM mid-run — AS-121; the run is then reported as interrupted and
// exits 128 + signal), asserts nothing of the project survives, and prints the
// receipt. `--check` lists every
// asc-* network as production / live / leftover with an owner guess and
// removes nothing. Exit codes: lib/compose-run.js EXIT. Docker is resolved by
// absolute path (ADVANCE_DOCKER_BIN, else the watcher's candidate list) —
// it is off PATH in ticks.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDockerBin } from '../watch/advance-watcher.mjs';
import { DEFAULT_CEILING, EXIT, composeProjectName, formatReceipt, runCheck, runCounted } from '../lib/compose-run.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS = resolve(HERE, '..', '..');
/** The signals a counted run survives long enough to tear down (AS-121). */
const RUN_SIGNALS = ['SIGINT', 'SIGTERM'];

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

// AS-121: from the moment `compose … run` starts until the counted run reports,
// SIGINT/SIGTERM must not end this process — with no handler node dies before
// any JS runs, `down` never happens, and the project's image (and, off the
// network_mode: none pin, its network) survives. The handler only records the
// signal; spawnSync defers the callback, so the process survives, the compose
// child ends (killed with the process group, or run to completion on
// parent-only delivery), and runCounted's always-down path runs as it would for
// any other run outcome. It is armed *inside* the exec wrapper, on the run
// recipe only (review cycle 1, F1): a signal during the guard or pre-flight has
// nothing to tear down and keeps the default disposition, so the build never
// starts. The caller disarms after runCounted returns.
function armedExec(onSignal) {
  let armed = false;
  return (argv, opts) => {
    if (!armed && argv.includes('run')) {
      armed = true;
      for (const sig of RUN_SIGNALS) process.on(sig, onSignal);
    }
    return exec(argv, opts);
  };
}

async function main() {
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
  // AS-121: the handler (see armedExec) records the first signal caught once
  // the run has started; nothing is armed before then.
  let interrupted = null;
  const onSignal = (sig) => { interrupted = interrupted || sig; };
  const result = runCounted(armedExec(onSignal), {
    docker: docker.bin, project: opts.project, cwd: opts.cwd, productionNames, env: process.env, ceiling,
    onOutput: (out) => { if (opts.log) writeFileSync(opts.log, out); },
  });
  // One turn of the loop so a signal caught during spawnSync reaches onSignal
  // before the report; then the default disposition is back (a no-op when the
  // run was refused and nothing was ever armed).
  await new Promise((r) => setImmediate(r));
  for (const sig of RUN_SIGNALS) process.off(sig, onSignal);
  if (result.refused) {
    console.error(`compose-run: refusing (exit ${result.exit}): ${result.refused}`);
    process.exit(result.exit);
  }
  // An interrupted run is not a receipt even when everything else went right:
  // exit 128 + signal number (130 / 143) unless the lib already said non-zero.
  if (interrupted && result.exit === 0) result.exit = 128 + os.constants.signals[interrupted];
  console.log(formatReceipt(result));
  if (result.exit === EXIT.NO_BUILD) console.error('compose-run: no `Built` line — this run is not a receipt (CLAUDE.md --build corollary)');
  if (result.exit === EXIT.LEAK) console.error('compose-run: LEAK — the project survived its own teardown; this run is not a receipt');
  if (interrupted) console.error(`compose-run: interrupted by ${interrupted} during the run — teardown ran; this run is not a receipt`);
  process.exit(result.exit);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
