// tools/lanes/test/fixture.mjs — scratch-repo fixture generator for the AS-60
// falsification suites (plan §8).
//
// Every fixture is a throwaway git repo under a mkdtemp directory — never the
// real repo, never a task worktree, so no trap/restore machinery exists by
// construction. Fixture git runs with global/system config neutralized
// (GIT_CONFIG_GLOBAL/SYSTEM=/dev/null) so a developer's gpg signing, hooks,
// or aliases cannot leak into a test. The suites additionally assert the
// real tree byte-identical before/after (realTreeSnapshot below, §8.4).
//
// Not a test file itself: node --test discovers *.test.mjs only.

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOOLS_DIR = resolve(HERE, '..');

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

export function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

// --- §8.4: the real tree the suites run inside must never be touched --------

export function realTreeRoot() {
  return git(HERE, 'rev-parse', '--show-toplevel').trim();
}

export function realTreeSnapshot() {
  return git(realTreeRoot(), 'status', '--porcelain');
}

// --- fixture repos -----------------------------------------------------------

export function write(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

/**
 * A minimal repo shaped like the real one where the checkers care: master
 * holds app files, a committed .lattice/ tree (board state lives on master),
 * and a .gitignore for .worktrees/ (so fixture worktrees don't dirty the
 * fixture's main porcelain, exactly as in the real repo).
 */
export function makeFixtureRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lanes-fx-')));
  git(root, 'init', '-q', '-b', 'master');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'user.email', 'fixture@fixture.local');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, '.gitignore', '.worktrees/\n');
  write(root, 'apps/invoicing/server.js', 'base\n');
  write(root, 'apps/chat/store.js', 'base\n');
  write(root, 'README.md', 'fixture\n');
  mkdirSync(join(root, '.lattice/events'), { recursive: true });
  mkdirSync(join(root, '.lattice/plans'), { recursive: true });
  write(root, '.lattice/events/.keep', '');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return root;
}

export function destroy(root) {
  rmSync(root, { recursive: true, force: true });
}

/**
 * A bare (non-git) fixture dir with .lattice/events and .lattice/plans, for
 * checkers that read only the event log (c, e).
 */
export function makeBareFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lanes-fx-')));
  mkdirSync(join(root, '.lattice/events'), { recursive: true });
  mkdirSync(join(root, '.lattice/plans'), { recursive: true });
  return root;
}

/**
 * Commit files on a branch (created from master if missing) under a chosen
 * author identity, then return the fixture's checkout to master. Returns the
 * commit sha.
 *
 * Adds ONLY the named paths (never `git add -A`): a fixture may hold
 * untracked board files (.lattice/events, plans) that belong to no branch,
 * and sweeping them into a task-branch commit is exactly the AS-26 failure
 * class the checkers under test exist to catch. The first draft of this
 * helper did sweep, and the resume-preconditions fixtures lost their plan
 * files to a branch checkout — the bug class polices its own tooling.
 */
export function commitOn(root, branch, files, opts = {}) {
  const author = opts.author || 'fixture';
  const email = opts.email || `${author}@agents.american-software.local`;
  const msg = opts.msg || 'change';
  const exists =
    spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { env: GIT_ENV })
      .status === 0;
  if (exists) git(root, 'checkout', '-q', branch);
  else git(root, 'checkout', '-q', '-b', branch, 'master');
  const rels = Object.keys(files);
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  git(root, 'add', '--', ...rels);
  git(root, '-c', `user.name=${author}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg);
  const sha = git(root, 'rev-parse', 'HEAD').trim();
  git(root, 'checkout', '-q', 'master');
  return sha;
}

/** git worktree add <root>/<rel> <branch>; returns the absolute path. */
export function addWorktree(root, branch, rel) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  git(root, 'worktree', 'add', '-q', p, branch);
  return p;
}

// --- synthetic .lattice event streams ----------------------------------------

/** Real-envelope event: {actor, data, id, schema_version, task_id, ts, type}. */
export function ev(id, type, taskId, ts, actor, data) {
  return { actor, data, id, schema_version: 1, task_id: taskId, ts, type };
}

export function writeEventsFile(root, taskId, events) {
  write(root, `.lattice/events/${taskId}.jsonl`, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

export function writeLedger(path, entries) {
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

export function ledgerEntry(ts, cmd, note = '') {
  return { ts, actor: 'agent:cto-owen', cmd, note };
}

export function writeConfig(path, cfg) {
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
}

// --- running checkers and parsing the house output grammar --------------------

/**
 * Run a checker by file name. Bash checkers run via `bash` explicitly and
 * .mjs checkers via the current node binary, so the suite result cannot
 * depend on exec bits or PATH.
 */
export function runChecker(name, args, opts = {}) {
  const p = join(TOOLS_DIR, name);
  const argv = name.endsWith('.mjs') ? [process.execPath, [p, ...args]] : ['bash', [p, ...args]];
  const r = spawnSync(argv[0], argv[1], { encoding: 'utf8', cwd: opts.cwd || HERE, env: GIT_ENV });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Parse the §7 house output contract:
 *   line 1: "examined ..." (cardinality)
 *   line 2: "PASS: ..." or "FAIL: K violation(s)"
 *   items:  "  - <item>" lines (violations)
 *   rest:   any other non-empty lines (e.g. the metrics block of (e))
 */
export function parseReport(stdout) {
  const lines = stdout.split('\n');
  return {
    first: lines[0] || '',
    verdict: lines[1] || '',
    items: lines.slice(2).filter((l) => l.startsWith('  - ')).map((l) => l.slice(4)),
    rest: lines.slice(2).filter((l) => l.trim() && !l.startsWith('  - ')),
  };
}
