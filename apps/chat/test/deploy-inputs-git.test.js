// deploy-inputs-git.test.js — AS-86. The acceptance recipe for F2, run as a
// test against REAL git instead of written down as a recipe nobody re-runs.
//
// WHY THIS FILE EXISTS, and why it is separate from watcher.test.js. Every
// deploy-ops test in watcher.test.js injects `run`, so it proves the decision
// logic while saying nothing about whether `git ls-tree HEAD -- <inputs>`
// actually moves when a context-shaping file is committed — which is the exact
// property F2 was filed about. Proving that needs a real repository and a real
// commit, so this file builds one in a temp directory: NEVER the live checkout,
// never the task worktree. It is host-only; the mountless test image
// (node:24-slim) ships no git, and both tests SKIP there as a counted outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  IMAGE_INPUTS, classifyImagePaths, makeDeployOps, decideDeploy, DEFAULTS,
} from '../watch/advance-watcher.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Real git, with the ambient environment deliberately walled off: no global or
 *  system config (a developer's `core.excludesfile` must not decide what this
 *  repo tracks), and the identity supplied per call so `commit` never depends
 *  on the host having one. */
function git(cwd, args) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'developer-lena',
      GIT_AUTHOR_EMAIL: 'developer-lena@agents.american-software.local',
      GIT_COMMITTER_NAME: 'developer-lena',
      GIT_COMMITTER_EMAIL: 'developer-lena@agents.american-software.local',
    },
  });
}

function gitRunnable() {
  const probe = spawnSync('git', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

/** A throwaway repository holding a stub at every image input. Directory inputs
 *  (lib, bin, ...) get one file inside; which inputs are directories is read
 *  from the real apps/chat rather than hard-coded, so a future directory input
 *  is stubbed correctly without editing this helper. */
function scratchRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'as86-inputs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appDir = join(root, 'apps', 'chat');
  mkdirSync(appDir, { recursive: true });

  const init = git(root, ['init', '-q', '-b', 'main']);
  assert.equal(init.status, 0, `git init: ${init.stderr}`);

  let dirStubs = 0;
  for (const input of IMAGE_INPUTS) {
    const isDir = statSync(join(APP_DIR, input)).isDirectory();
    if (isDir) {
      mkdirSync(join(appDir, input), { recursive: true });
      writeFileSync(join(appDir, input, 'stub.txt'), `${input} v1\n`);
      dirStubs += 1;
    } else {
      writeFileSync(join(appDir, input), `${input} v1\n`);
    }
  }
  // Tracked, in the build context, and NOT an image input: the negative
  // control's subject.
  writeFileSync(join(appDir, 'README.md'), 'readme v1\n');
  assert.equal(IMAGE_INPUTS.length, 10, '10 image inputs stubbed');
  assert.ok(dirStubs > 0 && dirStubs < IMAGE_INPUTS.length, 'the stubs mix files and directories');

  return {
    root,
    appDir,
    commit(message) {
      const add = git(root, ['add', '-A']);
      assert.equal(add.status, 0, `git add: ${add.stderr}`);
      const c = git(root, ['commit', '-q', '--no-gpg-sign', '-m', message]);
      assert.equal(c.status, 0, `git commit: ${c.stderr}`);
    },
    /** makeDeployOps over this repo with the REAL `run` (default runSync) and
     *  real git resolution — everything else injected, as the AS-75 harness
     *  does it. No docker, no network, no process exit. */
    ops() {
      return makeDeployOps({
        repoRoot: root,
        appDir,
        watchDir: join(appDir, 'watch'),
        logsDir: root,
        statePath: join(root, 'deploy-state.json'),
        lockPath: join(root, 'advance.lock'),
        lockStaleMs: DEFAULTS.lockStaleMin * 60 * 1000,
        cooldownMs: DEFAULTS.deployCooldownMin * 60 * 1000,
        deployTimeoutMs: DEFAULTS.deployTimeoutMin * 60 * 1000,
        retentionMs: 14 * 24 * 60 * 60 * 1000,
        log: () => {},
        env: {},
        fetchJson: async () => null,
        deploy: async () => ({ code: 0, signal: null, timedOut: false }),
        readSources: () => [],
        exit: () => {},
        sleep: async () => {},
        composeProject: 'asc-test', // AS-88: required; `deploy` is faked, so never reaches compose
      });
    },
  };
}

test('AS-86 deploy-inputs-git: a committed change to .dockerignore changes the desired id', (t) => {
  if (!gitRunnable()) {
    t.skip('git not runnable here — host-only acceptance recipe');
    return;
  }
  const repo = scratchRepo(t);
  repo.commit('stub apps/chat');
  const ops = repo.ops();

  const first = ops.computeDesired();
  assert.notEqual(first.desired, null, `a clean stub repo digests: reason ${first.reason}`);
  assert.equal(first.desired.dirty, false, 'the stub tree is committed, so not dirty');
  const A = first.desired.id;
  assert.match(A, /^[0-9a-f]{16}$/);

  // The acceptance line. Before AS-86 this file was outside IMAGE_INPUTS, so
  // this commit moved nothing and the deployer never rebuilt for it.
  writeFileSync(join(repo.appDir, '.dockerignore'), 'data\nREADME.md\nchat\ntest/fixtures\n');
  repo.commit('shrink the build context');
  const second = ops.computeDesired();
  assert.notEqual(second.desired, null, `still digests: reason ${second.reason}`);
  assert.equal(second.desired.dirty, false);
  const B = second.desired.id;
  assert.notEqual(B, A, 'a committed .dockerignore change must move the desired id');

  // ...and "the id moved" is worth nothing unless the deployer acts on it. A
  // container still serving A is stale-build, i.e. it rebuilds.
  assert.deepEqual(
    decideDeploy({
      desired: { id: B, dirty: false },
      running: { id: A },
      watcherSourceChanged: false,
      busy: false,
      dockerBin: '/x/docker',
      lastAttempt: null,
      now: 0,
      cooldownMs: 60_000,
    }),
    { action: 'deploy', reason: 'stale-build' },
  );

  // NEGATIVE CONTROL: a predicate that fires on everything is not a predicate.
  // README.md is tracked and inside the build context, and is NOT an input, so
  // committing it must leave the id exactly where it was.
  writeFileSync(join(repo.appDir, 'README.md'), 'readme v2\n');
  repo.commit('touch a non-input');
  const third = ops.computeDesired();
  assert.notEqual(third.desired, null, `still digests: reason ${third.reason}`);
  assert.equal(third.desired.id, B, 'a non-input commit must not move the id (no rebuild on chat traffic)');
});

test('AS-86 deploy-inputs-git: a stray compose.override.yaml is rejected by the classifier', (t) => {
  if (!gitRunnable()) {
    t.skip('git not runnable here — host-only acceptance recipe');
    return;
  }
  const repo = scratchRepo(t);
  repo.commit('stub apps/chat');

  // The realistic regression: compose auto-merges an override file if it is
  // present, so it shapes the build while being in no COPY line. The COPY-set
  // guard cannot see it; the index-backed classifier must.
  writeFileSync(join(repo.appDir, 'compose.override.yaml'), 'services:\n  server:\n    build: .\n');
  repo.commit('add a stray context-shaping file');

  const res = spawnSync('git', ['ls-files', '--', '.'], { cwd: repo.appDir, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ls-files: ${res.stderr}`);
  const tracked = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  // Cardinality first: 10 inputs (directory ones stubbed one file deep),
  // README.md, and the stray.
  assert.equal(tracked.length, IMAGE_INPUTS.length + 2, `tracked: ${tracked.join(', ')}`);
  assert.ok(tracked.includes('compose.override.yaml'), 'the stray is really tracked');

  const { inputs, declared, unclassified } = classifyImagePaths(tracked);
  assert.deepEqual(unclassified, ['compose.override.yaml']);
  assert.deepEqual(declared, ['README.md']);
  assert.equal(inputs.length, IMAGE_INPUTS.length, 'every stubbed input classified as an input');
});
