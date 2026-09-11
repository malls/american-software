// AS-106: the counted compose run's logic, host-tested with a scripted exec
// stub that records every argv — no docker on the host path, none in the
// compose image. Test names carry the plan's T-numbers so a mutant's red set
// can be read off the runner output.
//
// The opt-in real run (T11) needs AS106_REAL=1 plus a docker binary, same
// shape as AS-87's; otherwise it registers as one SKIPPED test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveDockerBin } from '../watch/advance-watcher.mjs';
import {
  DEFAULT_CEILING, EXIT,
  buildDownArgs, buildRunArgs, classifyNetworks, composeProjectName, guessOwner,
  isAllowedProject, parseReceipt, preflight, runCheck, runCounted,
} from '../lib/compose-run.js';

const PRODUCTION = ['asc-chat', 'asc-invoicing'];
const D = '/usr/local/bin/docker';

// The 13-network listing measured in the plan §1 (tick watcher:86819) plus the
// compose ls that tick saw: 3 production / 1 live / 9 leftover.
const NETWORK_LS_13 = [
  'asc-as93-marcus_default', 'asc-as93-mutant_default', 'asc-as94-lena_default',
  'asc-as95-qa-2_default', 'asc-as95-qa-3_default', 'asc-as95-qa-master_default', 'asc-as95-qa_default',
  'asc-chat-qa23_default', 'asc-chat_default', 'asc-invoicing_default', 'asc-invoicing_stripe-mock',
  'asc-marcus95_default', 'asc-review-as102_default',
  'bridge', 'host', 'none', 'bettereads_default',
].join('\n') + '\n';
const COMPOSE_LS = JSON.stringify([
  { Name: 'asc-chat', Status: 'running(1)' }, { Name: 'asc-invoicing', Status: 'running(1)' },
  { Name: 'asc-review-as102', Status: 'running(1)' }, { Name: 'bettereads', Status: 'running(5)' },
  { Name: 'whatever-sticks', Status: 'running(2)' },
]);

const RUN_OUTPUT_OK = 'ℹ tests 554\nℹ pass 547\nℹ fail 0\nℹ skipped 7\n Image asc-impl-as106-test Built \n';

/** A scripted docker: `script` maps a subcommand key to a responder. Records every argv. */
function stubExec(script = {}) {
  const calls = [];
  const exec = (argv, opts) => {
    calls.push(argv);
    const key = argv[1] === 'compose' ? `compose ${argv[2] === '-p' ? argv[4] : argv[2]}` : argv.slice(1, 3).join(' ');
    const r = script[key];
    if (typeof r === 'function') return r(argv, opts);
    return r || { status: 0, stdout: '', stderr: '' };
  };
  exec.calls = calls;
  exec.has = (...words) => calls.some((a) => words.every((w) => a.includes(w)));
  return exec;
}

const nets = (names) => ({ status: 0, stdout: names.join('\n') + '\n', stderr: '' });
const baseScript = (overrides = {}) => ({
  'network ls': nets(['asc-chat_default', 'bridge']),
  'compose ls': { status: 0, stdout: COMPOSE_LS, stderr: '' },
  'compose run': { status: 0, stdout: RUN_OUTPUT_OK, stderr: '' },
  'compose down': { status: 0, stdout: '', stderr: '' },
  'images --format': nets([]),
  ...overrides,
});

// --- AC-3: the project-name guard ------------------------------------------

test('T1 isAllowedProject rejects production names', () => {
  for (const name of PRODUCTION) {
    const r = isAllowedProject(name, { productionNames: PRODUCTION });
    assert.equal(r.ok, false, `${name} must be refused`);
    assert.match(r.reason, /production/);
  }
  const live = isAllowedProject('asc-review-as102', { productionNames: PRODUCTION, runningProjects: ['asc-review-as102'] });
  assert.equal(live.ok, false, 'a project compose already reports is someone else\'s lane');
});

test('T2 isAllowedProject rejects non-asc and malformed names', () => {
  for (const name of ['chat', 'review-as106', 'asc_review', 'asc-review/as106', 'asc-review as106', 'asc-Review-AS106', '', null, 'asc-']) {
    assert.equal(isAllowedProject(name, { productionNames: PRODUCTION }).ok, false, `${JSON.stringify(name)} must be refused`);
  }
});

test('T3 isAllowedProject accepts a scratch project', () => {
  assert.deepEqual(isAllowedProject('asc-review-as106', { productionNames: PRODUCTION, runningProjects: PRODUCTION }), { ok: true });
  assert.deepEqual(isAllowedProject('asc-impl-as106', { productionNames: PRODUCTION }), { ok: true });
});

// --- AC-4: argv ----------------------------------------------------------------

test('T4 buildDownArgs and buildRunArgs are exactly the recipe', () => {
  assert.deepEqual(buildDownArgs('asc-x'), ['compose', '-p', 'asc-x', 'down', '-v', '--rmi', 'local', '--remove-orphans']);
  assert.deepEqual(buildRunArgs('asc-x'), ['compose', '-p', 'asc-x', 'run', '--rm', '--build', 'test']);
});

// --- AC-5: down always runs ------------------------------------------------------

function downAfterRun(exec) {
  const runIdx = exec.calls.findIndex((a) => a.includes('run'));
  const downIdx = exec.calls.findIndex((a) => a.includes('down'));
  assert.ok(runIdx >= 0, 'run was called');
  assert.ok(downIdx > runIdx, `down (${downIdx}) called after run (${runIdx})`);
  assert.deepEqual(exec.calls[downIdx], [D, ...buildDownArgs('asc-impl-as106')]);
}

test('T5a runCounted: run exits 0 -> down runs, status 0, receipt parsed', () => {
  const exec = stubExec(baseScript());
  const r = runCounted(exec, { docker: D, project: 'asc-impl-as106', cwd: '/x', productionNames: PRODUCTION });
  downAfterRun(exec);
  assert.equal(r.runStatus, 0);
  assert.equal(r.exit, 0);
  assert.equal(r.receipt.tests, 554);
  assert.equal(r.receipt.built, true);
  assert.deepEqual(r.leaks, []);
});

test('T5b runCounted: run exits 1 -> down still runs, status 1 preserved', () => {
  const exec = stubExec(baseScript({ 'compose run': { status: 1, stdout: RUN_OUTPUT_OK.replace('fail 0', 'fail 3'), stderr: '' } }));
  const r = runCounted(exec, { docker: D, project: 'asc-impl-as106', cwd: '/x', productionNames: PRODUCTION });
  downAfterRun(exec);
  assert.equal(r.runStatus, 1);
  assert.equal(r.exit, 1);
  assert.equal(r.receipt.fail, 3);
});

test('T5c runCounted: run throws -> down still runs, error reported', () => {
  const exec = stubExec(baseScript({ 'compose run': () => { throw new Error('SIGTERM'); } }));
  const r = runCounted(exec, { docker: D, project: 'asc-impl-as106', cwd: '/x', productionNames: PRODUCTION });
  downAfterRun(exec);
  assert.equal(r.runError, 'SIGTERM');
  assert.notEqual(r.exit, 0);
});

// --- AC-6: post-teardown leak assertion -------------------------------------------

test('T6 runCounted: a network or image surviving down is reported as LEAK, exit 4, anchored at ^<project>_', () => {
  let after = false;
  const exec = stubExec(baseScript({
    'compose down': () => { after = true; return { status: 0, stdout: '', stderr: '' }; },
    'network ls': () => nets(after
      ? ['asc-impl-as106_default', 'asc-impl-as1060_default', 'asc-chat_default']
      : ['asc-chat_default']),
    'images --format': () => nets(after ? ['asc-impl-as106-test:latest', 'asc-chat-server:latest'] : []),
  }));
  const r = runCounted(exec, { docker: D, project: 'asc-impl-as106', cwd: '/x', productionNames: PRODUCTION });
  assert.equal(r.exit, EXIT.LEAK);
  assert.deepEqual(r.leaks, ['asc-impl-as106_default', 'asc-impl-as106-test:latest'], 'the prefix-sibling asc-impl-as1060 is not ours');
});

// --- AC-7: receipt ------------------------------------------------------------------

test('T7a parseReceipt: Built line verbatim, counts from TAP and spec summaries', () => {
  const spec = parseReceipt(RUN_OUTPUT_OK);
  assert.deepEqual(spec, { built: true, builtLine: 'Image asc-impl-as106-test Built', tests: 554, pass: 547, fail: 0, skipped: 7 });
  const tap = parseReceipt('# tests 12\n# pass 11\n# fail 1\n# skipped 0\n Image x-test Built \n');
  assert.deepEqual([tap.tests, tap.pass, tap.fail, tap.skipped, tap.built], [12, 11, 1, 0, true]);
  // A test name containing "Built" is not the image line (the first counted
  // run on this branch quoted this very test's name as its receipt).
  const decoy = parseReceipt('✔ T7a parseReceipt: Built line verbatim (1ms)\nℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ skipped 0\n');
  assert.equal(decoy.built, false);
  assert.equal(decoy.builtLine, null);
});

test('T7b runCounted: a run with no Built line is exit 5 even when every test passes', () => {
  const exec = stubExec(baseScript({ 'compose run': { status: 0, stdout: 'ℹ tests 554\nℹ pass 554\nℹ fail 0\nℹ skipped 0\n', stderr: '' } }));
  const r = runCounted(exec, { docker: D, project: 'asc-impl-as106', cwd: '/x', productionNames: PRODUCTION });
  assert.equal(r.receipt.built, false);
  assert.equal(r.exit, EXIT.NO_BUILD);
  downAfterRun(exec);
});

// --- AC-8: classification ---------------------------------------------------------------

test('T8 classifyNetworks: the plan §1 fixture splits 3 production / 1 live / 9 leftover', () => {
  const c = classifyNetworks(NETWORK_LS_13.split('\n').filter(Boolean), ['asc-chat', 'asc-invoicing', 'asc-review-as102', 'bettereads'], PRODUCTION);
  assert.deepEqual(c.production, ['asc-chat_default', 'asc-invoicing_default', 'asc-invoicing_stripe-mock']);
  assert.deepEqual(c.live, ['asc-review-as102_default']);
  assert.deepEqual(c.leftover.map((l) => l.network), [
    'asc-as93-marcus_default', 'asc-as93-mutant_default', 'asc-as94-lena_default',
    'asc-as95-qa-2_default', 'asc-as95-qa-3_default', 'asc-as95-qa-master_default', 'asc-as95-qa_default',
    'asc-chat-qa23_default', 'asc-marcus95_default',
  ]);
  assert.equal([c.production.length, c.live.length, c.leftover.length].join('/'), '3/1/9');
  assert.equal(guessOwner('asc-review-as102_default'), 'AS-102 review');
  assert.equal(guessOwner('asc-as94-lena_default'), 'AS-94 lena');
  assert.equal(guessOwner('asc-marcus95_default'), 'marcus');
  assert.equal(composeProjectName('# c\nname: asc-chat\n\nservices:\n'), 'asc-chat');
  assert.equal(composeProjectName('services:\n'), null);
});

// --- AC-9: pre-flight ceiling -----------------------------------------------------------

const twenty = Array.from({ length: 20 }, (_, i) => `asc-stub-${i}_default`);

test('T9a runCounted refuses at exactly the ceiling: 20 asc-* networks -> exit 3, no run', () => {
  const exec = stubExec(baseScript({ 'network ls': nets([...twenty, 'bridge']) }));
  const r = runCounted(exec, { docker: D, project: 'asc-impl-as106', cwd: '/x', productionNames: PRODUCTION });
  assert.equal(r.exit, EXIT.CEILING);
  assert.match(r.refused, /20 asc-\* networks >= ceiling 20/);
  assert.match(r.refused, /asc-stub-0_default/);
  assert.equal(exec.has('run'), false, 'no run call');
  assert.equal(exec.has('down'), false, 'no down call');
  assert.equal(preflight({ networks: twenty, running: [], productionNames: PRODUCTION }).ok, false);
  assert.equal(DEFAULT_CEILING, 20);
});

test('T9b runCounted proceeds below the ceiling: 19 asc-* networks -> run happens', () => {
  const exec = stubExec(baseScript({ 'network ls': nets(twenty.slice(0, 19)) }));
  const r = runCounted(exec, { docker: D, project: 'asc-impl-as106', cwd: '/x', productionNames: PRODUCTION });
  assert.equal(r.exit, 0);
  assert.equal(exec.has('run'), true);
});

// --- AC-10: --check ------------------------------------------------------------------------

test('T10a runCheck exits 1 with leftovers and 0 when production+live only', () => {
  const dirty = runCheck(stubExec(baseScript({ 'network ls': { status: 0, stdout: NETWORK_LS_13, stderr: '' } })), { docker: D, productionNames: PRODUCTION });
  assert.equal(dirty.exit, 1);
  assert.equal(dirty.classified.leftover.length, 9);
  const clean = runCheck(stubExec(baseScript({ 'network ls': nets(['asc-chat_default', 'asc-invoicing_default', 'asc-review-as102_default', 'bridge']) })), { docker: D, productionNames: PRODUCTION });
  assert.equal(clean.exit, 0);
  assert.equal(clean.classified.live.length, 1);
});

test('T10b runCheck is read-only: never down, rm, or prune', () => {
  const exec = stubExec(baseScript({ 'network ls': { status: 0, stdout: NETWORK_LS_13, stderr: '' } }));
  runCheck(exec, { docker: D, productionNames: PRODUCTION });
  assert.ok(exec.calls.length >= 2, 'it observed something');
  for (const argv of exec.calls) {
    for (const verb of ['down', 'rm', 'prune', 'run', 'stop', 'kill']) {
      assert.equal(argv.includes(verb), false, `--check must not call ${verb}: ${argv.join(' ')}`);
    }
  }
});

// --- AC-11: the real thing, opt in ------------------------------------------------------------

const enabled = process.env.AS106_REAL === '1';
const docker = resolveDockerBin(process.env, existsSync);
const skip = !enabled ? 'opt-in: set AS106_REAL=1' : (docker.bin ? false : `docker not runnable: ${docker.reason}`);

test('T11 real run: the script leaves zero networks and zero images for its project and prints a Built line', { skip, timeout: 10 * 60_000 }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'asc-as106-real-'));
  const project = `asc-as106-real-${process.pid}`;
  t.after(() => {
    spawnSync(docker.bin, ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { cwd: dir, stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(join(dir, 'Dockerfile'), `FROM alpine\nRUN echo AS106-${Date.now()}\nCMD ["sh", "-c", "echo 'ℹ tests 1'; echo 'ℹ pass 1'; echo 'ℹ fail 0'; echo 'ℹ skipped 0'"]\n`);
  // No network_mode here on purpose: this compose DOES create a default
  // network, so the script's teardown (not the pin) is what T11 exercises.
  writeFileSync(join(dir, 'compose.yaml'), 'services:\n  test:\n    build: .\n');
  const script = new URL('../bin/compose-run.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, '--project', project, '--cwd', dir], { encoding: 'utf8', env: { ...process.env, ADVANCE_DOCKER_BIN: docker.bin } });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, out);
  assert.match(out, /built: .*Built/);
  assert.match(out, /leak check: clean/);
  const left = spawnSync(docker.bin, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}_`));
  assert.deepEqual(left, [], 'no network for the project after the script');
  const imgs = spawnSync(docker.bin, ['images', '--format', '{{.Repository}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}-`));
  assert.deepEqual(imgs, [], 'no image for the project after the script');
});
