#!/usr/bin/env node
// apps/chat/watch/advance-watcher.mjs — AS-7 host-side message-triggered advance.
//
// Watches the sentinel file the chat store writes on every human-authored
// message (apps/chat/data/last-human-message.json, written by lib/store.js)
// and fires exactly one `claude -p '/advance'` tick per burst of human
// messages, respecting the single-flight lock shared with loop/manual ticks.
//
// Zero dependencies: node:* builtins only. Requires host node >= 20.
// Runs on the HOST (not in the container) — the container cannot spawn a
// claude session. Supervised by launchd; see ./README.md for install steps.
//
// Design (plan .lattice/plans/task_01M1899QAS56XVKP32A8WPFF9Z.md):
//   - 5s poll of the sentinel (no fswatch: FSEvents is unreliable for
//     container-written bind-mount files, and polling needs no host deps).
//   - 15s NON-extending trailing debounce: first sentinel advance arms the
//     timer; further advances within the window do not extend it, so a steady
//     message stream still ticks at most 15s after the first message.
//   - High-water mark advances at FIRE time, not tick success: a failed tick
//     never refires in a loop; the next human message retries naturally.
//   - The lock is etiquette, not a correctness invariant — correctness lives
//     in Lattice claims and SQLite. Do not "fix" it into something load-bearing.
//
// The fire/skip decision is pure (decide/isLockStale below) and unit-tested in
// apps/chat/test/watcher.test.js; fs/spawn effects live in the thin shell at
// the bottom, which only runs when this file is executed directly. The lock
// ops are lifted into the exported makeLockOps factory (AS-13) so tests can
// drive them against a real temp-dir lockfile without ever running main().

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  appendFileSync,
  statSync,
  readdirSync,
  createWriteStream,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- configuration (env-overridable; defaults per plan §4) ------------------

export const DEFAULTS = Object.freeze({
  pollS: 5, // sentinel poll interval
  debounceS: 15, // trailing debounce window (board band: 10–30s)
  tickTimeoutMin: 30, // hard tick timeout: SIGTERM, 15s grace, SIGKILL
  lockStaleMin: 45, // lock age staleness (> tick timeout, deliberately)
  tickLogRetentionDays: 14, // prune tick-*.log and deploy-*.log older than this
  permissionMode: 'acceptEdits',
  claudeBin: 'claude',
  // AS-75 deploy poll. 60s is far below the human threshold for "did my merge
  // ship" and far above the cost of two git calls plus one loopback fetch.
  deployPollS: 60,
  deployTimeoutMin: 15, // an emulated linux/amd64 rebuild, generously
  deployCooldownMin: 30, // suppress only a REPEAT of a failed attempt at the same id
  chatUrl: 'http://127.0.0.1:8347',
});

// AS-75: the image's git-committed inputs, as repo-relative-to-apps/chat paths.
// This is a hand-maintained copy of a fact that lives in the Dockerfile's COPY
// lines, so it gets a guard: test/deploy-shape.test.js parses those COPY lines
// and asserts set equality against this list. Change one, change both.
//
// Deliberately NOT `apps/chat` wholesale: apps/chat/data/export/ is tracked and
// rewritten by every records export, so a whole-directory digest would rebuild
// the image on chat traffic — a rebuild loop driven by people talking.
export const IMAGE_INPUTS = Object.freeze([
  'package.json',
  'server.js',
  'lib',
  'bin',
  'public',
  'watch',
  'test',
  'compose.yaml',
  'Dockerfile',
]);

function envNum(env, name, fallback) {
  const v = Number(env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function loadConfig(env = process.env) {
  return {
    pollS: envNum(env, 'ADVANCE_POLL_S', DEFAULTS.pollS),
    debounceS: envNum(env, 'ADVANCE_DEBOUNCE_S', DEFAULTS.debounceS),
    tickTimeoutMin: envNum(env, 'ADVANCE_TICK_TIMEOUT_MIN', DEFAULTS.tickTimeoutMin),
    lockStaleMin: envNum(env, 'ADVANCE_LOCK_STALE_MIN', DEFAULTS.lockStaleMin),
    tickLogRetentionDays: DEFAULTS.tickLogRetentionDays,
    permissionMode: env.ADVANCE_PERMISSION_MODE || DEFAULTS.permissionMode,
    claudeBin: env.ADVANCE_CLAUDE_BIN || DEFAULTS.claudeBin,
    repoRoot: env.ADVANCE_REPO_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
    deployPollS: envNum(env, 'ADVANCE_DEPLOY_POLL_S', DEFAULTS.deployPollS),
    deployTimeoutMin: envNum(env, 'ADVANCE_DEPLOY_TIMEOUT_MIN', DEFAULTS.deployTimeoutMin),
    deployCooldownMin: envNum(env, 'ADVANCE_DEPLOY_COOLDOWN_MIN', DEFAULTS.deployCooldownMin),
    chatUrl: env.ADVANCE_CHAT_URL || DEFAULTS.chatUrl,
  };
}

// --- pure decision logic (unit-tested; no fs, no clocks, no processes) ------

/**
 * Lock staleness. `lock` is the parsed lockfile plus a `pidAlive` boolean the
 * shell (or a test) supplies. Stale iff the owner pid is dead OR startedAt is
 * older than staleMs. A stale lock belonged to a crashed tick and may be
 * stolen; a fresh one means a tick is genuinely running.
 */
export function isLockStale(lock, nowMs, staleMs) {
  if (!lock.pidAlive) return { stale: true, reason: 'dead-pid' };
  const started = Date.parse(lock.startedAt);
  if (!Number.isFinite(started) || nowMs - started > staleMs) {
    return { stale: true, reason: 'age' };
  }
  return { stale: false, reason: 'fresh' };
}

/**
 * One poll's fire/skip decision. Pure state-transition function:
 *
 *   decide({ sentinel, highwater, lock, now, config, debounceUntil })
 *     -> { action: 'noop'|'debounce'|'skip-locked'|'fire', reason, debounceUntil }
 *
 * Inputs:
 *   sentinel      parsed sentinel JSON ({messageId,...}) or null (missing/unparsable)
 *   highwater     parsed highwater JSON ({messageId,...}) or null (never fired)
 *   lock          parsed lockfile + pidAlive boolean, or null (lock free)
 *   now           ms epoch
 *   config        { debounceS, lockStaleMin } (other keys ignored)
 *   debounceUntil ms epoch the armed window expires at, or null (not armed)
 *
 * The returned debounceUntil is the caller's next state (non-extending: once
 * armed it is echoed back unchanged until it expires or a fire clears it).
 * On 'skip-locked' the expired window is kept, so the very next poll after
 * the lock clears re-evaluates immediately — no second debounce wait.
 */
export function decide({ sentinel, highwater, lock, now, config, debounceUntil }) {
  const highwaterId = highwater ? highwater.messageId : 0;
  if (!sentinel || !Number.isFinite(sentinel.messageId)) {
    return { action: 'noop', reason: 'no-sentinel', debounceUntil: null };
  }
  if (sentinel.messageId <= highwaterId) {
    return { action: 'noop', reason: 'below-highwater', debounceUntil: null };
  }
  // sentinel > highwater: something human happened that we have not fired for.
  if (debounceUntil === null || debounceUntil === undefined) {
    return {
      action: 'debounce',
      reason: 'debounce-armed',
      debounceUntil: now + config.debounceS * 1000,
    };
  }
  if (now < debounceUntil) {
    // Non-extending window: later sentinel advances do NOT push it out.
    return { action: 'noop', reason: 'debounce-pending', debounceUntil };
  }
  // Window expired — lock check.
  if (lock) {
    const staleness = isLockStale(lock, now, config.lockStaleMin * 60 * 1000);
    if (!staleness.stale) {
      // A running tick's inbox pull delivers the message; sentinel stays
      // above highwater, so we re-check as soon as the lock clears.
      return { action: 'skip-locked', reason: `lock-fresh-${lock.source ?? 'unknown'}`, debounceUntil };
    }
    return { action: 'fire', reason: `lock-stale-${staleness.reason}`, debounceUntil: null };
  }
  return { action: 'fire', reason: 'debounce-elapsed', debounceUntil: null };
}

// AS-16: per-fire nonce. Generated once per fire() before lock acquisition;
// every artifact of that fire (lock body, argv marker, env marker) carries the
// same value. 64 bits of randomness (16 lowercase hex chars) make pid-reuse
// spoofing of the adoption rule in advance.md step 0 impossible in practice —
// a stale marker whose pid was recycled by a new watcher cannot also guess the
// new lock's nonce. node:crypto builtin — still zero external deps.
export function fireNonce() {
  return randomBytes(8).toString('hex');
}

// Exact child env for a spawned tick — per-variable reasons documented at the
// spawn site in fire(). Exported so the test suite pins the set: any future
// narrowing or widening must change this function AND its test, deliberately.
// `nonce` has NO default: a defaulted random would make the pin tests
// nondeterministic, and the sole production caller (fire()) always supplies
// the fire's own nonce.
export function tickChildEnv(env = process.env, watcherPid = process.pid, nonce) {
  return {
    PATH: env.PATH,
    HOME: env.HOME,
    USER: env.USER, // AS-14: macOS Keychain auth needs the user identity
    LOGNAME: env.LOGNAME,
    // AS-15: parent marker — lets the spawned tick's advance.md step 0
    // recognize the watcher's own advance.lock (source:"watcher", this pid)
    // as its own and proceed instead of self-cancelling as "lock held".
    // AS-16: carries the per-fire nonce too — adoption requires source, pid,
    // AND nonce to all match the lock, closing the pid-reuse spoof window.
    ADVANCE_TICK_PARENT: `watcher:${watcherPid}:${nonce}`,
  };
}

// Exact argv for a spawned tick — the parent-lock marker rides as the /advance
// slash-command argument (AS-20): headless ticks cannot read env vars (the
// permission layer denies the read), so the prompt argument is the CONTRACT
// and ADVANCE_TICK_PARENT above stays only as belt for env-readable contexts.
// Exported so the test suite pins the array exactly like tickChildEnv: any
// change to the spawn argv changes this function AND its test, deliberately.
//
// AS-21: permission grants ride the argv too. Project-scope
// .claude/settings.json allowlists never load for headless `claude -p`
// children (workspace trust is granted interactively; a headless child logs
// "Ignoring N permissions.allow entries … this workspace has not been
// trusted"), so fire() passes the settings file's allow/deny lists explicitly
// as --allowedTools / --disallowedTools. Both flags are variadic ("comma or
// space-separated", claude --help 2026-08-30); we spawn without a shell and
// rules contain internal spaces (`Bash(git *)`), so each rule is its own argv
// element. A variadic flag consumes args until the next --flag, so the two
// flag groups go last and the deny group terminates the array — no positional
// args may follow. `rules` stays injected (never read from disk here) so this
// function remains pure; loadPermissionRules below is the effectful reader.
//
// AS-16: the marker is `watcher:<pid>:<nonce>` — the nonce slots directly
// after the pid it composes with, and has NO default (a defaulted random
// would make the pin tests nondeterministic; fire() always supplies one).
export function tickArgv(
  watcherPid = process.pid,
  nonce,
  permissionMode = DEFAULTS.permissionMode,
  rules = { allow: [], deny: [] }
) {
  const argv = [
    '-p',
    `/advance watcher:${watcherPid}:${nonce}`,
    '--permission-mode',
    permissionMode,
    '--output-format',
    'text',
  ];
  if (rules.allow.length > 0) argv.push('--allowedTools', ...rules.allow);
  if (rules.deny.length > 0) argv.push('--disallowedTools', ...rules.deny);
  return argv;
}

// AS-21: fire-time read of .claude/settings.json — the single source of truth
// for permission grants (no hardcoded copy anywhere in this file; drift
// between settings and runtime is the exact failure class that caused the
// bug). Success -> { allow, deny } string arrays from the same parse, so
// "allows passed but force-push denies dropped" is impossible by
// construction. Missing/unreadable/unparsable/non-object -> null; the caller
// logs a WARN and fires without extra grants (degraded, not broken — never a
// hardcoded fallback list). Effectful (readFileSync), separately testable
// against fixture files, composed by fire().
export function loadPermissionRules(settingsPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const onlyStrings = (v) => (Array.isArray(v) ? v.filter((r) => typeof r === 'string') : []);
  return {
    allow: onlyStrings(parsed.permissions?.allow),
    deny: onlyStrings(parsed.permissions?.deny),
  };
}

// --- AS-75: the deploy decision (pure; no fs, no clock, no process) ---------
//
// The watcher owns the deploy because it is the only piece of this company
// that runs as a plain host process: the permission layer that denies `docker`
// to a headless tick does not reach it, and an absolute-path spawn needs no
// PATH. The decision is LEVEL-triggered over three observable facts — what
// master says the image inputs are, what the running container says it is
// serving, and whether this watcher's own source on disk has changed — so it
// needs no cooperation from whoever merged, and it self-corrects after any
// crash. Nothing here writes a marker file; a marker written by a tick that
// then died is exactly the class of bug this shape deletes.

/** Where docker lives on a Mac, in the order worth trying. The launchd plist's
 *  PATH does not include /usr/local/bin, so the watcher resolves the binary
 *  itself rather than depending on a host plist edit. */
export const DOCKER_CANDIDATES = Object.freeze([
  '/usr/local/bin/docker',
  '/opt/homebrew/bin/docker',
  '/Applications/Docker.app/Contents/Resources/bin/docker',
]);

/**
 * -> { bin: string|null, reason: 'override'|'candidate'|'override-missing'|'not-found' }
 *
 * An ADVANCE_DOCKER_BIN that does not exist returns null with reason
 * `override-missing`, and NEVER falls through to the candidates: a typo in an
 * explicit override must be loud, because falling through would "work" while
 * silently ignoring what the operator asked for.
 */
export function resolveDockerBin(env, exists) {
  const override = env.ADVANCE_DOCKER_BIN;
  if (override) {
    return exists(override) ? { bin: override, reason: 'override' } : { bin: null, reason: 'override-missing' };
  }
  for (const candidate of DOCKER_CANDIDATES) {
    if (exists(candidate)) return { bin: candidate, reason: 'candidate' };
  }
  return { bin: null, reason: 'not-found' };
}

/** `git` by absolute path when we can — same reasoning as docker — but `git`
 *  IS on the plist PATH, so the bare name is a sound fallback. */
export function resolveGitBin(env, exists) {
  if (env.ADVANCE_GIT_BIN) return env.ADVANCE_GIT_BIN;
  return exists('/usr/bin/git') ? '/usr/bin/git' : 'git';
}

/**
 * `git ls-tree HEAD -- <paths>` output -> a 16-hex build id.
 *
 * CARDINALITY FIRST, and it is the whole point: ls-tree prints one line per
 * path that exists, and says nothing at all about one that does not. A digest
 * over 8 of 9 inputs would be perfectly stable, entirely wrong, and would stop
 * triggering rebuilds forever — a vacuous pass with no test to fail. So a line
 * count that does not equal the expected path count is a refusal, not a digest.
 *
 * The lines are sorted before hashing so the id does not depend on git's
 * output order.
 */
export function parseLsTree(stdout, expectedPaths) {
  const lines = String(stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const expected = expectedPaths.length;
  if (lines.length !== expected) {
    return { id: null, reason: 'inputs-missing', count: lines.length, expected };
  }
  const id = createHash('sha256').update([...lines].sort().join('\n')).digest('hex').slice(0, 16);
  return { id, reason: 'ok', count: lines.length, expected };
}

/**
 * Digest of the watcher's own source. `files` is [{ name, content }] — only
 * `.mjs` (a README or plist-template edit must not restart the watcher). Sorted
 * and NUL-delimited so neither readdir order nor a rename that shuffles bytes
 * between files can produce a collision.
 */
export function watchSourceDigest(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    hash.update(file.name);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

/** tick-*.log and deploy-*.log share one retention rule and one pruner. */
export function isPrunableLog(name) {
  return (name.startsWith('tick-') || name.startsWith('deploy-')) && name.endsWith('.log');
}

/**
 * One deploy-poll's decision. Pure, and the RULE ORDER IS THE SPECIFICATION —
 * it is asserted in the tests, so do not reorder it for tidiness:
 *
 *   1 busy                            -> noop  busy
 *   2 desired === null                -> noop  no-git
 *   3 desired.dirty                   -> noop  inputs-dirty
 *   4 running current + source changed -> restart-watcher
 *   5 running current                 -> noop  current
 *   6 no docker binary                -> noop  no-docker
 *   7 failed attempt at this id, in cooldown -> noop cooldown
 *   8 otherwise                       -> deploy stale-build
 *
 * Two consequences worth stating out loud. Rule 8 beating rule 4 means the
 * CONTAINER is always brought current before the watcher restarts itself: one
 * action per evaluation, never interleaved, and the restart happens on a later
 * cycle. And the cooldown suppresses only a REPEAT of a failed attempt at the
 * SAME id — a new merge changes the id and retries immediately, because the
 * thing that failed is not the thing being asked for any more.
 */
export function decideDeploy({
  desired,
  running,
  watcherSourceChanged,
  busy,
  dockerBin,
  lastAttempt,
  now,
  cooldownMs,
}) {
  if (busy) return { action: 'noop', reason: 'busy' };
  if (desired === null || desired === undefined) return { action: 'noop', reason: 'no-git' };
  if (desired.dirty) return { action: 'noop', reason: 'inputs-dirty' };

  const serving = Boolean(running) && typeof running.id === 'string' && running.id === desired.id;
  if (serving && watcherSourceChanged) return { action: 'restart-watcher', reason: 'watcher-source-changed' };
  if (serving) return { action: 'noop', reason: 'current' };

  if (!dockerBin) return { action: 'noop', reason: 'no-docker' };
  if (
    lastAttempt &&
    lastAttempt.id === desired.id &&
    lastAttempt.outcome === 'fail' &&
    now - lastAttempt.at < cooldownMs
  ) {
    return { action: 'noop', reason: 'cooldown' };
  }
  return { action: 'deploy', reason: 'stale-build' };
}

// --- thin effectful shell ----------------------------------------------------

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but not ours
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * AS-27: write advance-watcher.pid — the watcher's single-instance marker AND,
 * since AS-27, its liveness beacon. `heartbeatAt` is rewritten at the top of
 * every poll (including the poll that returns early because our own tick is
 * running: the watcher is alive while its child works), so a reader in the
 * container — which cannot check a host pid for liveness — can judge liveness
 * by heartbeat age instead. See apps/chat/lib/loop-status.js.
 *
 * tmp + rename, the same atomic pattern the highwater write uses: a reader
 * polling this file must never observe a half-written body. `pid` and
 * `startedAt` are preserved verbatim across heartbeats — the single-instance
 * check reads `pid` and nothing else, and is unaffected by the new key.
 */
export function writeWatcherPid({ path, pid, startedAt, now }) {
  writeFileSync(path + '.tmp', JSON.stringify({ pid, startedAt, heartbeatAt: now }));
  renameSync(path + '.tmp', path);
}

/**
 * Lock ops over the shared advance.lock (AS-13: lifted out of main() so the
 * container suite can drive them against a real temp-dir lockfile). The shell
 * passes real collaborators; tests may inject `pid`, `isPidAlive`, and
 * `readFile`. The lock is etiquette, not a correctness invariant (see header)
 * — nothing here claims mutual exclusion.
 */
export function makeLockOps({
  lockPath,
  staleMs,
  log,
  pid = process.pid,
  isPidAlive = pidAlive,
  readFile = readFileSync,
  // AS-75: what goes in the lock body's `source`. Defaults to 'watcher' so no
  // existing call site changes. The deploy passes 'deploy', which costs no UI
  // work at all: describeLoopStatus interpolates the source, so the sidebar
  // reads `Tick in flight · deploy` for the duration of a rebuild and the tone
  // stays `tick`. (Asserted in loop-label.test.js rather than assumed.)
  source = 'watcher',
}) {
  function parseLock() {
    try {
      return JSON.parse(readFile(lockPath, 'utf8'));
    } catch {
      return null;
    }
  }

  /** Parsed lockfile + pidAlive boolean, or null when free/unreadable. */
  function readLock() {
    const lock = parseLock();
    if (!lock) return null;
    return { ...lock, pidAlive: isPidAlive(lock.pid) };
  }

  /**
   * O_EXCL acquire with one stale-steal retry, then verify-after-create:
   * re-read the file and claim success only if it still holds our pid. Verify
   * SHRINKS the stale-steal double-fire window (two actors interleaving
   * unlink+create on the same stale lock), it does not eliminate it — A can
   * create+verify before B's unlink+create and both still fire. Sanctioned
   * residual per the etiquette stance: a lost race costs one duplicate tick's
   * tokens, never correctness.
   *
   * AS-16: `nonce` (required) is this fire's fireNonce() value, written into
   * the lock body so advance.md step 0 can demand a full source+pid+nonce
   * match before adopting. Staleness, release, and verify stay nonce-blind:
   * they guard concurrent races between live processes (pids differ by
   * construction); the nonce targets pid reuse across time.
   */
  // AS-95: `extra` is spread into the body verbatim (the loop marker
  // `{loop: {ticks}}`). Additive by construction — acquire/release/stale logic
  // and `source` are untouched, so advance.md step 0 and AS-84 see the same
  // fields they see today.
  function acquireLock(nonce, extra = {}) {
    const body = JSON.stringify({ pid, startedAt: new Date().toISOString(), source, nonce, ...extra });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(lockPath, body, { flag: 'wx' });
      } catch (err) {
        if (err.code !== 'EEXIST') {
          log(`ERROR lock write failed: ${err.message}`);
          return false;
        }
        const held = readLock();
        const staleness = held
          ? isLockStale(held, Date.now(), staleMs)
          : { stale: true, reason: 'unparsable' };
        if (!staleness.stale) return false; // fresh — raced someone; skip
        log(`STEAL stale lock (${staleness.reason}, pid ${held?.pid ?? '?'}) removed`);
        try {
          unlinkSync(lockPath);
        } catch {
          /* raced the owner's own cleanup */
        }
        continue;
      }
      // Verify: a racing stale-stealer may have unlinked the lock we just
      // created (believing it stale) and re-created it as its own. If the
      // file no longer shows our pid it is THEIRS — yield without unlinking.
      const verify = parseLock();
      if (verify && verify.pid === pid) return true;
      log(`STEAL-LOST lock holds pid ${verify?.pid ?? '?'} after our create; yielding`);
      return false;
    }
    return false;
  }

  function releaseLock() {
    const held = parseLock();
    if (held && held.pid === pid) {
      try {
        unlinkSync(lockPath);
      } catch {
        /* already gone */
      }
    }
  }

  return { acquireLock, releaseLock, readLock };
}

// --- AS-75: the deploy shell -------------------------------------------------

/** Prune tick-*.log and deploy-*.log older than `cutoffMs`. Best-effort by
 *  design: a log we cannot delete must never stop a tick or a deploy. */
export function pruneLogs(logsDir, cutoffMs, { readdir = readdirSync, stat = statSync, unlink = unlinkSync } = {}) {
  try {
    for (const name of readdir(logsDir)) {
      if (!isPrunableLog(name)) continue;
      const full = join(logsDir, name);
      if (stat(full).mtimeMs < cutoffMs) unlink(full);
    }
  } catch {
    /* pruning is best-effort */
  }
}

/** The watcher's own `.mjs` sources as [{ name, content }], for watchSourceDigest. */
export function readWatchSources(dir, { readdir = readdirSync, readFile = readFileSync } = {}) {
  return readdir(dir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => ({ name, content: readFile(join(dir, name), 'utf8') }));
}

/** Synchronous command runner for the two git calls -> { code, stdout, stderr }.
 *  A spawn error (binary missing) is a non-zero code, never a throw. */
export function runSync(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', ...opts });
  if (r.error) return { code: -1, stdout: '', stderr: r.error.message };
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** GET a JSON body, or null for unreachable / non-200 / unparsable. The
 *  conflation is deliberate: every one of those means "the container is not
 *  serving the build we asked about", and `up -d --build` is the right recovery
 *  for all of them. The cooldown bounds the cost of being wrong. */
export async function fetchJsonOrNull(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `docker compose up -d --build`, with the tick's timeout shape copied exactly
 * (SIGTERM, 15s grace, SIGKILL) -> { code, signal, timedOut }.
 *
 * DOCKER_BUILDKIT / COMPOSE_DOCKER_CLI_BUILD are mandatory, not decoration:
 * compose.yaml's own header records that under the legacy builder the
 * `platform: linux/amd64` pin is ignored at build time, producing a native
 * image that then refuses to start. The `./apps/chat/chat` wrapper forces the
 * same two toggles for the same reason.
 */
export function runDockerCompose({ dockerBin, cwd, env, logPath, timeoutMs, log, spawnFn = spawn, createLog = createWriteStream }) {
  return new Promise((resolve_) => {
    const out = createLog(logPath, { flags: 'a' });
    const proc = spawnFn(dockerBin, ['compose', '--progress', 'quiet', 'up', '-d', '--build'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout.pipe(out, { end: false });
    proc.stderr.pipe(out, { end: false });

    let timedOut = false;
    let killTimer = null;
    const termTimer = setTimeout(() => {
      timedOut = true;
      log(`TIMEOUT deploy exceeded ${Math.round(timeoutMs / 60000)}min; SIGTERM`);
      proc.kill('SIGTERM');
      killTimer = setTimeout(() => proc.kill('SIGKILL'), 15 * 1000);
      killTimer.unref();
    }, timeoutMs);
    termTimer.unref();

    const done = (result) => {
      clearTimeout(termTimer);
      if (killTimer !== null) clearTimeout(killTimer);
      if (!out.writableEnded) out.end();
      resolve_(result);
    };
    proc.on('error', (err) => done({ code: -1, signal: null, timedOut, error: err.message }));
    proc.on('exit', (code, signal) => done({ code, signal, timedOut }));
  });
}

/**
 * The deploy's effects, lifted out of main() exactly as AS-13 lifted the lock
 * ops — and for exactly the same reason. AS-82 records that main() is never
 * executed by the test suite, so anything left inside it is unguarded; this
 * factory is the twin of makeLockOps, and every collaborator it needs is
 * injectable so each branch below is a unit test with no git, no docker and no
 * network.
 *
 * Returns { evaluate, isDeploying, dockerBin, dockerReason, baselineDigest,
 *           computeDesired, probeRunning, lastAttempt }.
 */
export function makeDeployOps({
  repoRoot,
  appDir,
  watchDir,
  logsDir,
  statePath,
  lockPath,
  lockStaleMs,
  cooldownMs,
  deployTimeoutMs,
  retentionMs,
  chatUrl = DEFAULTS.chatUrl,
  log,
  env = process.env,
  now = () => Date.now(),
  exists = existsSync,
  run = runSync,
  fetchJson = fetchJsonOrNull,
  deploy = runDockerCompose,
  readSources = readWatchSources,
  writeState = defaultWriteState,
  prune = pruneLogs,
  exit = (code) => process.exit(code),
  sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)),
  reprobeAttempts = 10,
  reprobeDelayMs = 2_000,
  probeTimeoutMs = 3_000,
  pid = process.pid,
  isPidAlive = pidAlive,
  lockOps,
}) {
  const docker = resolveDockerBin(env, exists);
  const gitBin = resolveGitBin(env, exists);
  const paths = IMAGE_INPUTS.map((p) => `apps/chat/${p}`);
  // A SECOND lock ops instance, over the same file, differing only in the
  // `source` it writes. Mutual exclusion against loop/manual/watcher ticks uses
  // the mechanism already in place rather than a second, drifting one.
  const lock =
    lockOps ?? makeLockOps({ lockPath, staleMs: lockStaleMs, log, pid, isPidAlive, source: 'deploy' });

  let baselineDigest = null;
  try {
    baselineDigest = watchSourceDigest(readSources(watchDir));
  } catch (err) {
    log(`WARN cannot digest watcher source at startup (${err.message}); self-restart disabled`);
  }

  let deploying = false;
  let lastAttempt = null;
  let lastDecision = null; // AS-95: the last evaluate() decision, for pendingDeploy()
  let lastWarn = null;

  /** One WARN per distinct condition, not one per poll (AS-13 #4's lesson). */
  function warnOnce(key, line) {
    if (lastWarn === key) return;
    lastWarn = key;
    log(`WARN ${line}`);
  }

  /** master's image-input digest -> { desired: {id,dirty}|null, reason }. */
  function computeDesired() {
    const tree = run(gitBin, ['ls-tree', 'HEAD', '--', ...paths], { cwd: repoRoot });
    if (tree.code !== 0) {
      warnOnce('no-git', `git ls-tree failed (${gitBin}, code ${tree.code}): ${tree.stderr.trim()}`);
      return { desired: null, reason: 'no-git' };
    }
    const parsed = parseLsTree(tree.stdout, IMAGE_INPUTS);
    if (parsed.id === null) {
      warnOnce('inputs-missing', `git ls-tree returned ${parsed.count} of ${parsed.expected} image inputs; refusing to digest a short set`);
      return { desired: null, reason: 'inputs-missing' };
    }
    const status = run(gitBin, ['status', '--porcelain', '--', ...paths], { cwd: repoRoot });
    if (status.code !== 0) {
      warnOnce('no-git', `git status failed (${gitBin}, code ${status.code}): ${status.stderr.trim()}`);
      return { desired: null, reason: 'no-git' };
    }
    const dirty = status.stdout.trim() !== '';
    if (dirty) warnOnce(`dirty:${parsed.id}`, `apps/chat image inputs are dirty at ${parsed.id}; deploying committed code only`);
    else if (lastWarn !== null) lastWarn = null;
    return { desired: { id: parsed.id, dirty }, reason: dirty ? 'inputs-dirty' : 'ok' };
  }

  /** What the container says it is serving -> { id } | null. */
  async function probeRunning() {
    const body = await fetchJson(`${chatUrl}/api/build`, probeTimeoutMs);
    if (!body || typeof body !== 'object' || !body.build || typeof body.build.id !== 'string') return null;
    return { id: body.build.id };
  }

  /** Any FRESH advance.lock, ours or foreign: a live session mid-tick may be
   *  writing to the chat API, and rebuilding under it restarts the server
   *  mid-write. Reuses readLock + isLockStale rather than writing a second
   *  staleness rule that would drift from the first. */
  function lockIsBusy(nowMs) {
    const held = lock.readLock();
    if (!held) return false;
    return !isLockStale(held, nowMs, lockStaleMs).stale;
  }

  function currentDigest() {
    try {
      return watchSourceDigest(readSources(watchDir));
    } catch {
      return null; // unreadable source is not a reason to restart
    }
  }

  function persist(fields) {
    try {
      writeState(statePath, {
        desiredId: null,
        dirty: false,
        reason: 'no-git',
        desiredReason: 'no-git',
        dockerBin: docker.bin,
        dockerReason: docker.reason,
        computedAt: new Date(now()).toISOString(),
        lastAttempt: lastAttempt && { ...lastAttempt, at: new Date(lastAttempt.at).toISOString() },
        ...fields,
      });
    } catch (err) {
      log(`WARN cannot write ${statePath} (${err.message}); the indicator degrades, the deploy does not`);
    }
  }

  /** A deploy is successful because the thing that is RUNNING changed — not
   *  because a command exited 0. Poll /api/build until it agrees or we give up. */
  async function reprobe(wantedId) {
    for (let attempt = 0; attempt < reprobeAttempts; attempt++) {
      await sleep(reprobeDelayMs);
      const probed = await probeRunning();
      if (probed && probed.id === wantedId) return probed;
    }
    return probeRunning();
  }

  async function performDeploy(desiredId) {
    if (!lock.acquireLock(fireNonce())) {
      log(`SKIP deploy aborted: lock acquisition failed (build ${desiredId})`);
      return;
    }
    deploying = true;
    prune(logsDir, now() - retentionMs);
    const logPath = join(logsDir, `deploy-${new Date(now()).toISOString().replaceAll(':', '-')}.log`);
    const startedAt = now();
    log(`DEPLOY building ${desiredId} -> ${logPath}`);

    let outcome = 'fail';
    let detail = '';
    try {
      const result = await deploy({
        dockerBin: docker.bin,
        cwd: appDir,
        logPath,
        timeoutMs: deployTimeoutMs,
        log,
        env: {
          PATH: env.PATH,
          HOME: env.HOME,
          USER: env.USER,
          LOGNAME: env.LOGNAME,
          DOCKER_BUILDKIT: '1',
          COMPOSE_DOCKER_CLI_BUILD: '1',
          CHAT_BUILD_ID: desiredId,
        },
      });
      if (result.code !== 0) {
        detail = `exit ${result.code}${result.timedOut ? ' (timeout)' : ''}${result.error ? ` ${result.error}` : ''}`;
      } else {
        const probed = await reprobe(desiredId);
        if (probed && probed.id === desiredId) {
          outcome = 'ok';
          detail = `serving ${desiredId}`;
        } else {
          detail = `id-mismatch (serving ${probed ? probed.id : 'nothing'})`;
        }
      }
    } catch (err) {
      detail = `error ${err.message}`;
    } finally {
      lock.releaseLock();
      deploying = false;
    }
    lastAttempt = { id: desiredId, at: now(), outcome, detail };
    log(`DEPLOY ${outcome} ${desiredId} (${detail}) after ${Math.round((now() - startedAt) / 1000)}s`);
  }

  function restartWatcher(oldDigest, newDigest) {
    log(`RESTART watcher source changed (${oldDigest} -> ${newDigest}); exiting for launchd relaunch`);
    lock.releaseLock();
    // advance-watcher.pid is deliberately LEFT IN PLACE — unlinking it the way
    // shutdown() does would blink the sidebar to `Off · no watcher` on every
    // self-update. A briefly stale heartbeat is the honest, quieter signal.
    // Non-zero exit on purpose: it relaunches under KeepAlive:true AND under
    // KeepAlive:{SuccessfulExit:false}, so the restart does not depend on which
    // semantics the plist has. `launchctl print` will show LastExitStatus 70
    // after a self-update; that is expected, not a crash.
    exit(70);
  }

  /**
   * One deploy-poll. `busy` is what the caller knows (our own tick child); the
   * foreign-lock half is checked here. At most one action per call.
   */
  async function evaluate({ busy = false } = {}) {
    if (deploying) return { action: 'noop', reason: 'busy' };
    const nowMs = now();
    const { desired, reason: desiredReason } = computeDesired();
    const running = await probeRunning();
    const digest = currentDigest();
    const decision = decideDeploy({
      desired,
      running,
      watcherSourceChanged: baselineDigest !== null && digest !== null && digest !== baselineDigest,
      busy: busy || lockIsBusy(nowMs),
      dockerBin: docker.bin,
      lastAttempt,
      now: nowMs,
      cooldownMs,
    });
    persist({
      desiredId: desired ? desired.id : null,
      dirty: Boolean(desired && desired.dirty),
      runningId: running ? running.id : null,
      reason: decision.reason,
      desiredReason,
    });
    if (decision.action === 'deploy') {
      await performDeploy(desired.id);
      persist({
        desiredId: desired.id,
        dirty: false,
        runningId: running ? running.id : null,
        reason: decision.reason,
        desiredReason,
      });
    } else if (decision.action === 'restart-watcher') {
      restartWatcher(baselineDigest, digest);
    }
    lastDecision = decision; // AS-95: pendingDeploy() reads this between loop ticks
    return decision;
  }

  return {
    evaluate,
    computeDesired,
    probeRunning,
    isDeploying: () => deploying,
    // AS-95: a rebuild is owed but has not run yet — either the last evaluate
    // deferred it because a tick held the lock, or it saw a stale build it has
    // not deployed. The loop waits between ticks while this is true so tick
    // N+1 runs against tick N's merged code. Unresolvable docker => false: the
    // loop must not wait forever for a deploy that can never happen.
    pendingDeploy: () =>
      Boolean(docker.bin) && lastDecision !== null && (lastDecision.reason === 'busy' || lastDecision.reason === 'stale-build'),
    dockerBin: docker.bin,
    dockerReason: docker.reason,
    gitBin,
    baselineDigest,
    lastAttempt: () => lastAttempt,
  };
}

// --- AS-95: the loop -------------------------------------------------------
// A board message starts a LOOP of ticks, not a single tick. Everything below
// is pure: the predicate that decides continue/stop, a read-only reader for
// the Lattice board, and a git-free HEAD reader. main() wiring lives further
// down; these are exported so the suite can drive them with fixtures.

export const LOOP_DEFAULTS = Object.freeze({
  maxTicks: 24,
  maxMs: 8 * 60 * 60 * 1000,
  maxNoProgress: 2,
  maxFailures: 2,
  // How long a loop will wait for somebody else's lock before giving up and
  // saying so. Longer than both the tick timeout (30 min, the longest a
  // legitimate tick can hold the lock) and the staleness rule that lets the
  // next fire steal it (45 min), so an honest foreign tick is always waited
  // out; past that we are losing the race repeatedly, and a stop the board can
  // read beats a wait nobody can see.
  maxLockWaitMs: 60 * 60 * 1000,
});

/** Statuses that mean a task is somewhere inside its lifecycle — work in
 *  flight that the next tick can advance one stage (plan §2.2 rule a). */
export const MID_LIFECYCLE = Object.freeze(['in_planning', 'planned', 'in_progress', 'review']);
/** A dependency is satisfied only by a terminal status. Anything else — including
 *  a target we cannot find — is unmet (honest default, plan §2.2). */
const TERMINAL = Object.freeze(['done', 'cancelled']);

/** Chat-set membership per the CLAUDE.md scheduling rule. Affects the log
 *  detail only, never the boolean: the predicate answers "is there anything
 *  ready", the tick's own `lattice next` answers "which one". */
function isChatSet(task) {
  return String(task.title ?? '').startsWith('Chat:') || task.priority === 'critical';
}

/** Backlog tasks whose every dependency is done/cancelled. */
export function readyBacklog(board) {
  const tasks = board?.tasks ?? [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter((t) => {
    if (t.status !== 'backlog') return false;
    return (t.dependsOn ?? []).every((id) => {
      const dep = byId.get(id);
      return Boolean(dep) && TERMINAL.includes(dep.status);
    });
  });
}

/**
 * Should the loop fire another tick? Pure. Stop rules are evaluated BEFORE
 * work rules so a cap is logged even when work remains (plan §2.2).
 *
 * @param board    {{tasks: Array<{id,status,priority,title,dependsOn}>}} from readBoard()
 * @param sentinel {{messageId:number}|null}  latest human message
 * @param highwater{{messageId:number}|null}  last message we fired for
 * @param loop     {{startedAt:number,ticks:number,noProgress:number,failures:number}}
 *                 counters BEFORE folding `tick` in
 * @param tick     {{code,signal,timedOut,headBefore,headAfter}} the tick that just settled
 * @returns {{continue:boolean, reason:string, detail:object, loop:object}}
 */
export function shouldContinue({ board, sentinel, highwater, loop, tick, now, limits = LOOP_DEFAULTS }) {
  const t = tick ?? {};
  const prior = {
    startedAt: loop?.startedAt ?? now,
    ticks: loop?.ticks ?? 0,
    noProgress: loop?.noProgress ?? 0,
    failures: loop?.failures ?? 0,
  };

  // (g) the tick itself failed — non-zero exit, a signal, or the 30-min box.
  const failed = t.code !== 0 || Boolean(t.signal) || Boolean(t.timedOut);
  const failures = failed ? prior.failures + 1 : 0;

  // (e) did master move? An unreadable HEAD (null) counts as no progress:
  // stopping early is cheap (a new message re-arms), a silent runaway is not.
  const headKnown = Boolean(t.headBefore) && Boolean(t.headAfter);
  const headMoved = headKnown && t.headBefore !== t.headAfter;
  const noProgress = headMoved ? 0 : prior.noProgress + 1;

  const ticks = prior.ticks + 1;
  const elapsedMs = now - prior.startedAt;
  const next = { startedAt: prior.startedAt, ticks, noProgress, failures };

  const highwaterId = highwater ? highwater.messageId : 0;
  const newMessage = Boolean(sentinel) && Number.isFinite(sentinel.messageId) && sentinel.messageId > highwaterId;
  const midLifecycle = (board?.tasks ?? []).filter((x) => MID_LIFECYCLE.includes(x.status));
  const ready = readyBacklog(board);
  const work = {
    newMessage,
    midLifecycle: midLifecycle.map((x) => x.short_id ?? x.id),
    ready: ready.length,
  };
  const stop = (reason, detail) => ({ continue: false, reason, detail, loop: next });
  const go = (reason, detail) => ({ continue: true, reason, detail, loop: next });

  if (failures >= limits.maxFailures) {
    return stop('tick-failed-twice', { failures, code: t.code ?? null, signal: t.signal ?? null, timedOut: Boolean(t.timedOut) });
  }
  if (noProgress >= limits.maxNoProgress) {
    return stop('no-progress', { noProgress, headKnown, ...work });
  }
  if (ticks >= limits.maxTicks || elapsedMs >= limits.maxMs) {
    return stop('cap-hit', { ticks, elapsedMs });
  }
  if (newMessage) {
    // The loop does NOT fire this itself — it returns continue and the normal
    // poll() -> decide() -> fire() path consumes it, so the highwater moves once.
    return go('new-message', { messageId: sentinel.messageId, highwaterId });
  }
  if (midLifecycle.length > 0) {
    return go('mid-lifecycle', { tasks: work.midLifecycle });
  }
  if (ready.length > 0) {
    const chatSet = ready.filter(isChatSet).length;
    return go('backlog-ready', { chatSet, other: ready.length - chatSet });
  }
  return stop('dry', { ticks });
}

/**
 * Read `.lattice/tasks/*.json` into the shape shouldContinue() wants. Pure over
 * injected fs (AS-8/AS-27 pattern), read-only, and it never throws: an
 * unreadable board yields `{tasks: []}` — which reads as `dry`, the safe stop.
 * `dependsOn` for T = T's own `depends_on` edges, plus every other task's
 * `blocks` edge that points at T (task files carry relationships_out only).
 */
export function readBoard(tasksDir, { readdir = readdirSync, readFile = readFileSync } = {}) {
  let names = [];
  try {
    names = readdir(tasksDir).filter((n) => n.endsWith('.json'));
  } catch {
    return { tasks: [], unreadable: 0, missingDir: true };
  }
  const raw = [];
  let unreadable = 0;
  for (const name of names) {
    try {
      const body = JSON.parse(readFile(join(tasksDir, name), 'utf8'));
      if (body && typeof body === 'object' && body.id) raw.push(body);
      else unreadable += 1;
    } catch {
      unreadable += 1; // half-written tmp file, or hand-edited JSON — skip, count.
    }
  }
  const deps = new Map(raw.map((t) => [t.id, new Set()]));
  for (const t of raw) {
    for (const rel of t.relationships_out ?? []) {
      if (!rel || !rel.target_task_id) continue;
      if (rel.type === 'depends_on') deps.get(t.id).add(rel.target_task_id);
      // "A blocks B" is "B depends on A" seen from the other end.
      if (rel.type === 'blocks' && deps.has(rel.target_task_id)) deps.get(rel.target_task_id).add(t.id);
    }
  }
  const tasks = raw.map((t) => ({
    id: t.id,
    short_id: t.short_id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dependsOn: [...deps.get(t.id)],
  }));
  return { tasks, unreadable, missingDir: false };
}

/**
 * AS-95 / AC-5 — what a single poll may fire. Pure, exported, and the ONLY
 * place the message path and the loop path are ordered against each other.
 *
 * The property this exists to hold: a human message that arrives while a loop
 * is between ticks is fired ONCE, by the normal decide()/fire() path, which is
 * the path that moves the highwater. The loop never fires it a second time —
 * it does not need to, because settle() folds that same tick into the loop
 * counters afterwards. Written as two `if`s inside poll(), that guarantee was
 * an argument about statement order; written here, it is a test.
 *
 * Deploy comes last on purpose: a pending rebuild delays the LOOP's own tick
 * (so tick N+1 sees tick N's merged code) but must never delay the board's
 * message, which is the one thing a person is waiting on.
 *
 * The lock gate comes before the deploy one and after the message: a resumed
 * loop must not fire over a lock that may belong to a tick the dead watcher
 * left running (cycle-1 F2), while a message is what a person is waiting on and
 * decide() has owned the lock question on that path since AS-7.
 *
 * @param {'fire'|'debounce'|'skip-locked'|'idle'|string} decideAction  decide()'s verdict
 * @param {boolean} loopPending   the loop owes a tick (set by settle())
 * @param {boolean} deployPending a rebuild is due and can actually run
 * @param {boolean} lockHeld      a lock is held that this loop must wait out
 * @returns {'fire-message'|'fire-loop'|'wait-lock'|'wait-deploy'|'idle'}
 */
export function nextPollAction({ decideAction, loopPending, deployPending, lockHeld = false }) {
  if (decideAction === 'fire') return 'fire-message';
  if (!loopPending) return 'idle';
  if (deployPending) return 'wait-deploy';
  return 'fire-loop';
}

/**
 * The commit HEAD points at, without shelling out to git. Follows a symbolic
 * ref into `.git/refs/...`, falls back to `packed-refs`, and handles the
 * `gitdir:` indirection a linked worktree uses. Returns null when unreadable —
 * shouldContinue() treats an unknown HEAD as "no progress".
 */
export function headOf(repoRoot, { readFile = readFileSync } = {}) {
  try {
    let gitDir = join(repoRoot, '.git');
    let dotGit;
    try {
      dotGit = readFile(gitDir, 'utf8'); // a file => linked worktree
      const m = /^gitdir:\s*(.+)$/m.exec(dotGit);
      if (m) gitDir = m[1].trim();
    } catch {
      /* .git is a directory — the normal case */
    }
    const head = readFile(join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = /^ref:\s*(.+)$/.exec(head);
    if (!ref) return /^[0-9a-f]{7,40}$/.test(head) ? head : null; // detached HEAD
    const refName = ref[1].trim();
    try {
      return readFile(join(gitDir, refName), 'utf8').trim() || null;
    } catch {
      const packed = readFile(join(gitDir, 'packed-refs'), 'utf8');
      for (const line of packed.split('\n')) {
        const [sha, name] = line.trim().split(/\s+/);
        if (name === refName) return sha;
      }
      return null;
    }
  } catch {
    return null;
  }
}

/** tmp + rename, the same atomic pattern every other file this watcher writes
 *  uses: a reader in the container must never observe a half-written body. */
function defaultWriteState(path, body) {
  writeFileSync(path + '.tmp', JSON.stringify(body));
  renameSync(path + '.tmp', path);
}

/**
 * AS-95 — the loop's state machine, as a factory beside makeLockOps and
 * makeDeployOps rather than as inner functions of main().
 *
 * WHY THIS IS A FACTORY (cycle-1 review, F7). The first cut of AS-95 put this
 * state machine inside main(): 142 unguarded lines carrying three policies —
 * when a loop is armed, what a resumed loop does, what an aborted fire means —
 * none of which any test could reach, because reaching them meant running
 * main(). Both blocking defects of that cycle lived in exactly those lines. The
 * pure predicate (shouldContinue) was not what failed and is not what changed;
 * what failed was the part with no falsifier. So the effects are injected —
 * every read, every write, the clock — and the policies become assertions.
 *
 * It owns: the live loop counters, the `pending` flag (poll() owes a tick), the
 * mirror file, the resume policy, and the three stop paths (predicate, error,
 * lock-unavailable). It owns no fs paths, no spawn, and no lock: the caller
 * hands it readers and writers, and fire()/poll() stay in main().
 *
 * @param loadBoard     () => board            `readBoard(.lattice/tasks)`
 * @param loadSentinel  () => {messageId}|null the latest human message
 * @param loadHighwater () => {messageId}|null the last message we fired for
 * @param loadLock      () => lockBody|null    parsed advance.lock (no pidAlive:
 *                                             the resume gate judges AGE)
 * @param loadState     () => mirror|null      parsed advance-loop.json
 * @param saveState     (body) => void         writes advance-loop.json
 * @param log           (line) => void
 * @param now           () => ms
 * @param limits        LOOP_DEFAULTS, injectable for tests
 * @param resumeGraceMs how young a lock has to be for a resumed loop to wait it
 *                      out — the tick timeout, so a legitimately running tick
 *                      is always waited for and a dead one never is
 */
export function makeLoopOps({
  loadBoard,
  loadSentinel,
  loadHighwater,
  loadLock,
  loadState,
  saveState,
  log,
  now = () => Date.now(),
  limits = LOOP_DEFAULTS,
  resumeGraceMs = DEFAULTS.tickTimeoutMin * 60 * 1000,
}) {
  let loop = null; // the live loop, null when idle
  let pending = false; // the last tick said continue; poll() owes a fire
  let lastLoop = null; // why the previous loop stopped (survives, for the sidebar)
  let lastTick = null;
  let resumeHold = false; // we resumed and have not fired our own tick yet
  let waitingSince = null; // when the current lock-wait episode began
  let waitLogged = null; // one line per wait episode, not one per poll

  function mirror() {
    try {
      saveState({
        active: loop !== null,
        startedAt: loop ? new Date(loop.startedAt).toISOString() : null,
        ticks: loop ? loop.ticks : 0,
        armedBy: loop ? loop.armedBy : null,
        lastTick,
        lastLoop,
      });
    } catch (err) {
      log(`WARN loop state unwritable: ${err.message}`);
    }
  }

  /** Every way a loop ends goes through here, so every end has a logged reason
   *  and a `lastLoop` the sidebar can read. There is no other way to clear
   *  `loop` — that is the point (cycle-1 F1 was an exit that took neither). */
  function stop(reason, detail) {
    const ticks = loop ? loop.ticks : 0;
    lastLoop = { stoppedAt: new Date(now()).toISOString(), reason, ticks, detail };
    log(`LOOP-STOP reason=${reason} after ${ticks} ticks (${JSON.stringify(detail)})`);
    loop = null;
    pending = false;
    resumeHold = false;
    waitingSince = null;
    waitLogged = null;
  }

  /** A message armed a loop, or a loop tick is going ahead. Idempotent inside a
   *  running loop: ticks are counted at settle, by the predicate. */
  function start(sentinel) {
    waitingSince = null;
    waitLogged = null;
    resumeHold = false;
    if (loop !== null) return;
    loop = { startedAt: now(), ticks: 0, noProgress: 0, failures: 0, armedBy: sentinel.messageId };
    log(`LOOP-START armedBy messageId ${sentinel.messageId}`);
    // F3: mirror NOW, not at the first settle. The mirror is the only thing a
    // restarted watcher can resume from, and a death during tick 1 used to lose
    // the loop entirely — the company sat idle until the next board message,
    // which is the exact symptom this task exists to remove.
    mirror();
  }

  /** The tail of a settled tick: fold it into the counters, ask the predicate,
   *  log, mirror. Guarded end to end — the loop must never be able to kill the
   *  watcher, for the same reason the heartbeat is guarded. */
  function settle(tick) {
    lastTick = {
      endedAt: new Date(now()).toISOString(),
      code: tick.code,
      signal: tick.signal,
      timedOut: Boolean(tick.timedOut),
      headMoved: Boolean(tick.headBefore && tick.headAfter && tick.headBefore !== tick.headAfter),
    };
    if (loop === null) {
      mirror();
      return;
    }
    try {
      const board = loadBoard();
      if (board.missingDir) log('BOARD-UNREADABLE .lattice/tasks missing or unreadable; treating the board as dry');
      const verdict = shouldContinue({
        board,
        sentinel: loadSentinel(),
        highwater: loadHighwater(),
        loop,
        tick,
        now: now(),
        limits,
      });
      loop = { ...loop, ...verdict.loop };
      log(
        `LOOP-EVAL tick ${loop.ticks} reason=${verdict.reason} detail=${JSON.stringify(verdict.detail)} -> ` +
          (verdict.continue ? 'continue' : 'stop')
      );
      if (verdict.continue) pending = true;
      else stop(verdict.reason, verdict.detail);
    } catch (err) {
      // An unexpected failure stops the loop rather than spinning: a board
      // message re-arms it, and a runaway loop costs real tokens.
      stop('error', { message: err.message });
    }
    mirror();
  }

  /**
   * F1 — fire() could not get the lock. Before this existed the loop simply
   * ended there: poll() had already cleared the debt, nothing re-evaluated the
   * predicate, and the company stopped with no LOOP-STOP line and a mirror
   * still claiming a live loop. The message path has always self-healed from
   * this (it writes the highwater only after the lock, so decide() re-fires);
   * the loop path now does the same, and is bounded so the wait itself cannot
   * become a silent stop.
   */
  function aborted() {
    if (loop === null) return; // an aborted MESSAGE fire: pre-loop behaviour, untouched
    pending = true; // keep the debt: the next poll retries
    const at = now();
    if (waitingSince === null) {
      waitingSince = at;
      log(`LOOP-WAIT lock held; loop tick ${loop.ticks + 1} will retry (suppressing repeats)`);
      mirror();
    }
    if (at - waitingSince >= limits.maxLockWaitMs) {
      stop('lock-unavailable', { waitedMs: at - waitingSince, ticks: loop.ticks });
      mirror();
    }
  }

  /**
   * F2 — may a RESUMED loop fire right now? A watcher that died uncleanly left
   * its tick running and its lock behind; the pid in that lock is the dead
   * watcher's, so the stale-steal rule reads it as free and the resumed loop
   * starts a second tick beside the orphan (observed: two ticks, three seconds
   * after relaunch, unconditionally).
   *
   * The gate is the lock's AGE, deliberately not its pid: the pid belongs to
   * the watcher, and a dead watcher says nothing about whether its child is
   * still working. Whose lock it is and what `source` should mean is AS-84's
   * question and is left alone here. An undatable lock does not block — it can
   * never age out, so waiting on it would hang the loop forever, and the steal
   * rule in acquireLock already handles it.
   *
   * Only a resume is gated. Between a loop's own ticks there is no lock of ours
   * to trip over, and a foreign one lands in aborted() above.
   */
  function blockedByLock() {
    if (!resumeHold) return false;
    const held = loadLock();
    const startedMs = held ? Date.parse(held.startedAt ?? '') : NaN;
    if (!held || !Number.isFinite(startedMs) || now() - startedMs >= resumeGraceMs) {
      resumeHold = false;
      waitLogged = null;
      return false;
    }
    if (waitLogged !== 'resume') {
      waitLogged = 'resume';
      log(
        `LOOP-WAIT lock held by pid ${held.pid ?? '?'} (${Math.round((now() - startedMs) / 1000)}s old); ` +
          'not firing the resumed loop over a tick that may still be running (suppressing repeats)'
      );
    }
    return true;
  }

  /** Startup: a watcher restart (AS-75 self-restart or launchd relaunch) loses
   *  the in-memory loop by design, so re-enter it from the file. ticks and
   *  startedAt carry forward — the cap still counts from the board's message —
   *  while noProgress/failures reset, because the evidence for them died with
   *  the old process. */
  function resume() {
    const prior = loadState();
    if (!prior || typeof prior !== 'object') return;
    lastLoop = prior.lastLoop ?? null;
    lastTick = prior.lastTick ?? null;
    if (prior.active !== true) return;
    const startedAt = Date.parse(prior.startedAt ?? '');
    loop = {
      startedAt: Number.isFinite(startedAt) ? startedAt : now(),
      ticks: Number.isFinite(prior.ticks) ? prior.ticks : 0,
      noProgress: 0,
      failures: 0,
      armedBy: prior.armedBy ?? null,
    };
    pending = true;
    resumeHold = true; // F2: wait out anything the dead process left running
    log(`LOOP-RESUME reason=watcher-restart tick ${loop.ticks} armedBy ${loop.armedBy}`);
  }

  return {
    active: () => loop !== null,
    pending: () => pending,
    /** The number of the tick about to run — the lock's loop marker. */
    nextTick: () => (loop ? loop.ticks : 0) + 1,
    /** poll() is firing the loop's owed tick now. Announces the tick on the
     *  first attempt only: a retry inside a wait episode has already been
     *  announced by the LOOP-WAIT line, and the tick that eventually gets the
     *  lock logs its own FIRE line. */
    takeFire: () => {
      pending = false;
      if (waitingSince === null) log(`LOOP-FIRE tick ${loop ? loop.ticks + 1 : 1}`);
    },
    start,
    aborted,
    blockedByLock,
    settle,
    resume,
    /** Test/report view of the private counters. Never the mirror body. */
    snapshot: () => ({
      active: loop !== null,
      ticks: loop ? loop.ticks : 0,
      pending,
      resumeHold,
      lastLoop,
      lastTick,
    }),
  };
}

function main() {
  const config = loadConfig();
  const dataDir = join(config.repoRoot, 'apps', 'chat', 'data');
  const logsDir = join(dataDir, 'logs');
  const paths = {
    sentinel: join(dataDir, 'last-human-message.json'),
    highwater: join(dataDir, 'advance-watcher.highwater.json'),
    lock: join(dataDir, 'advance.lock'),
    pid: join(dataDir, 'advance-watcher.pid'),
    log: join(logsDir, 'advance-watcher.log'),
    settings: join(config.repoRoot, '.claude', 'settings.json'),
    deployState: join(dataDir, 'deploy-state.json'), // AS-75
    loopState: join(dataDir, 'advance-loop.json'), // AS-95
  };
  mkdirSync(logsDir, { recursive: true });

  // Startup size cap: rotate a >5 MiB watcher log aside rather than grow forever.
  try {
    if (existsSync(paths.log) && statSync(paths.log).size > 5 * 1024 * 1024) {
      renameSync(paths.log, paths.log + '.old');
    }
  } catch {
    /* log rotation is best-effort */
  }

  function log(line) {
    const entry = `${new Date().toISOString()} ${line}\n`;
    try {
      appendFileSync(paths.log, entry);
    } catch {
      /* keep running even if the log is unwritable */
    }
    process.stdout.write(entry);
  }

  // Single instance: refuse to start beside a live watcher (launchd holds the
  // supervised one; this guards the "ran it manually too" case).
  // Known + accepted (AS-13 #5): the read-then-write below races two manual
  // watchers started in the same instant — launchd owns the supervised
  // instance and the fire-time wx lock bounds the damage to log noise.
  const existingPid = readJson(paths.pid);
  if (existingPid && pidAlive(existingPid.pid) && existingPid.pid !== process.pid) {
    log(`FATAL another watcher is alive (pid ${existingPid.pid}); exiting`);
    process.exit(1);
  }
  // AS-27: startedAt is captured once and echoed by every later heartbeat, so
  // the file always answers both "since when" and "as of when". Deliberately
  // NOT guarded: if we cannot write this at startup the single-instance marker
  // does not exist, and failing loudly beats running unmarked.
  const watcherStartedAt = new Date().toISOString();
  writeWatcherPid({ path: paths.pid, pid: process.pid, startedAt: watcherStartedAt, now: watcherStartedAt });

  let debounceUntil = null;
  let child = null; // currently running tick, if any
  let lastBadSentinel = null; // log unparsable sentinel once per content change
  let lastSkipKey = null; // dedupe SKIP logs per episode (AS-13 #4)
  let loopWaitLogged = false; // one LOOP-WAIT line per deploy wait, not one per poll

  function readSentinel() {
    if (!existsSync(paths.sentinel)) return null;
    let raw;
    try {
      raw = readFileSync(paths.sentinel, 'utf8');
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      lastBadSentinel = null;
      return parsed;
    } catch {
      if (raw !== lastBadSentinel) {
        lastBadSentinel = raw;
        log(`WARN unparsable sentinel (${raw.length} bytes); ignoring until it changes`);
      }
      return null;
    }
  }

  const { acquireLock, releaseLock, readLock } = makeLockOps({
    lockPath: paths.lock,
    staleMs: config.lockStaleMin * 60 * 1000,
    log,
    pid: process.pid,
  });

  // AS-75: the loop moved to the exported pruneLogs (which also covers
  // deploy-*.log, on the same retention) so it is under test rather than
  // stranded inside main(); this stays as the fire-time call site.
  function pruneTickLogs() {
    pruneLogs(logsDir, Date.now() - config.tickLogRetentionDays * 24 * 60 * 60 * 1000);
  }

  // AS-95: the loop state machine (counters, mirror file, resume policy, stop
  // paths). Everything it touches is passed in here and nowhere else, so main()
  // keeps exactly the wiring below and the policies are unit-testable.
  const loopOps = makeLoopOps({
    loadBoard: () => readBoard(join(config.repoRoot, '.lattice', 'tasks')),
    loadSentinel: readSentinel,
    loadHighwater: () => readJson(paths.highwater),
    loadLock: () => readJson(paths.lock),
    loadState: () => readJson(paths.loopState),
    saveState: (body) => defaultWriteState(paths.loopState, body),
    log,
    resumeGraceMs: config.tickTimeoutMin * 60 * 1000,
  });

  function fire(sentinel) {
    // AS-16: one nonce per fire, minted before lock acquisition — the lock
    // body and both markers (argv + env) below carry this same value.
    const nonce = fireNonce();
    const headBefore = headOf(config.repoRoot);
    if (!acquireLock(nonce, { loop: { ticks: loopOps.nextTick() } })) {
      // F1: an aborted loop tick retries on the next poll instead of ending the
      // loop in silence — and says so ONCE per wait episode, because a 5s poll
      // that retries is exactly the log-flood AS-13 #4 was about. Outside a
      // loop this is the pre-AS-95 SKIP line, fired once and not repeated
      // because nothing retries it.
      if (loopOps.active()) loopOps.aborted();
      else log(`SKIP fire aborted: lock acquisition failed (messageId ${sentinel.messageId})`);
      return;
    }
    // AS-95: a message arms a loop; every later tick of that loop reuses it.
    // After the lock, not before: a fire that never happened must not arm a
    // loop, and the marker written above already reads nextTick() === 1.
    loopOps.start(sentinel);
    // Highwater advances NOW (at-most-once per message; see header comment).
    writeFileSync(
      paths.highwater + '.tmp',
      JSON.stringify({ messageId: sentinel.messageId, firedAt: new Date().toISOString() })
    );
    renameSync(paths.highwater + '.tmp', paths.highwater);
    pruneTickLogs();

    const stamp = new Date().toISOString().replaceAll(':', '-');
    const tickLogPath = join(logsDir, `tick-${stamp}.log`);
    const tickLog = createWriteStream(tickLogPath, { flags: 'a' });
    log(`FIRE messageId ${sentinel.messageId} from ${sentinel.authorId} -> ${tickLogPath}`);

    // AS-21: permission grants re-read from .claude/settings.json at every
    // fire — settings edits take effect on the next tick, no watcher restart.
    const rules = loadPermissionRules(paths.settings);
    if (rules === null) {
      log(`WARN permission rules unavailable (${paths.settings} missing/unreadable/unparsable); firing without grants`);
    }

    // Child env: exactly {PATH, HOME, USER, LOGNAME, ADVANCE_TICK_PARENT} via
    // tickChildEnv() (unit-tested pin). launchd's default env is thin, and the
    // minimal-env principle stands: every variable here has a stated reason,
    // and any addition needs one too (AS-14).
    //   PATH    — locate node + claude (the launchd plist sets it).
    //   HOME    — claude config/state directory resolution.
    //   USER    — claude's macOS Keychain auth resolves the login keychain
    //             through it; without it a headless tick dies in ~2s with
    //             "Not logged in · Please run /login" (AS-14).
    //   LOGNAME — POSIX twin of USER, same identity-resolution reason; some
    //             tooling reads one, some the other.
    //   ADVANCE_TICK_PARENT — "watcher:<this watcher's pid>:<this fire's
    //             nonce>". BELT only (AS-20): headless ticks cannot read env
    //             vars, so the marker's real transport is the /advance prompt
    //             argument built by tickArgv() below — advance.md step 0
    //             matches advance.lock (source "watcher" + same pid + same
    //             nonce, AS-16) against the ARGUMENT. The env var stays for
    //             any context where env IS readable (AS-15). Either way the
    //             watcher, not the tick, releases the lock in settle().
    // Child argv (tickArgv, unit-tested pin): -p '/advance
    // watcher:<pid>:<nonce>', --permission-mode, --output-format, then the
    // AS-21 permission grants —
    // --allowedTools/--disallowedTools carrying .claude/settings.json's
    // allow/deny lists (loaded above; project-scope settings never load for
    // headless children, so the argv is the grants' only transport).
    // AS-13 #3: timers and handlers close over this fire's own `proc`, never
    // the mutable module-level `child` — a timed-out tick's stray SIGKILL
    // timer must not be able to kill a successor tick. `child` remains only
    // the poll()/shutdown() gate, nulled iff it still points at this proc.
    const proc = spawn(
      config.claudeBin,
      tickArgv(process.pid, nonce, config.permissionMode, rules ?? undefined),
      {
        cwd: config.repoRoot,
        env: tickChildEnv(process.env, process.pid, nonce),
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    child = proc;
    proc.stdout.pipe(tickLog, { end: false });
    proc.stderr.pipe(tickLog, { end: false });

    let timedOut = false;
    let killTimer = null;
    const termTimer = setTimeout(() => {
      timedOut = true;
      log(`TIMEOUT tick exceeded ${config.tickTimeoutMin}min; SIGTERM`);
      proc.kill('SIGTERM');
      killTimer = setTimeout(() => proc.kill('SIGKILL'), 15 * 1000);
      killTimer.unref();
    }, config.tickTimeoutMin * 60 * 1000);
    termTimer.unref();

    function settle(code = null, signal = null) {
      clearTimeout(termTimer);
      if (killTimer !== null) clearTimeout(killTimer);
      if (child === proc) child = null;
      releaseLock();
      loopOps.settle({ code, signal, timedOut, headBefore, headAfter: headOf(config.repoRoot) });
    }
    proc.on('error', (err) => {
      if (!tickLog.writableEnded) tickLog.end(`\n[watcher] spawn error: ${err.message}\n`);
      log(`ERROR tick spawn failed: ${err.message} (is '${config.claudeBin}' on PATH?)`);
      settle();
    });
    proc.on('exit', (code, signal) => {
      if (!tickLog.writableEnded) tickLog.end();
      log(`EXIT tick ${timedOut ? 'TIMEOUT ' : ''}code=${code} signal=${signal ?? 'none'}`);
      settle(code, signal);
    });
  }

  function poll() {
    // AS-27 heartbeat, FIRST and best-effort. First, because the early return
    // below is the in-flight-tick path and the watcher is very much alive
    // there — skipping it would make a long tick read as a dead watcher.
    // Best-effort, because this runs inside a setInterval callback: an
    // unguarded throw here (full disk, revoked permissions) becomes an
    // uncaught exception that kills the watcher, and the watcher is the thing
    // that fires ticks. A missed heartbeat costs a wrong indicator for 60s; a
    // dead watcher costs every future message-fired tick.
    try {
      writeWatcherPid({
        path: paths.pid,
        pid: process.pid,
        startedAt: watcherStartedAt,
        now: new Date().toISOString(),
      });
    } catch {
      /* heartbeat is best-effort; the indicator degrades, the watcher does not */
    }
    if (child) return; // our own tick is running; its lock covers this window
    if (deployOps.isDeploying()) return; // AS-75: a rebuild is restarting the server
    const sentinel = readSentinel();
    const result = decide({
      sentinel,
      highwater: readJson(paths.highwater),
      lock: readLock(),
      now: Date.now(),
      config,
      debounceUntil,
    });
    debounceUntil = result.debounceUntil;
    // AS-13 #4: one SKIP line per episode, not one per 5s poll — a held
    // foreign lock used to print ~360 identical lines per 30-min loop tick.
    // Any non-skip action ends the episode, so the next skip logs again.
    if (result.action !== 'skip-locked') lastSkipKey = null;
    if (result.action === 'debounce') {
      log(`DEBOUNCE armed for messageId ${sentinel.messageId} (${config.debounceS}s)`);
    } else if (result.action === 'skip-locked') {
      const skipKey = `${result.reason}:${sentinel.messageId}`;
      if (skipKey !== lastSkipKey) {
        lastSkipKey = skipKey;
        log(`SKIP ${result.reason} (messageId ${sentinel.messageId}) (suppressing repeats)`);
      }
    } else if (result.action === 'fire') {
      if (result.reason.startsWith('lock-stale')) log(`NOTE firing over stale lock: ${result.reason}`);
    }
    // AS-95: exactly ONE decision about what this poll fires. The message path
    // and the loop path are mutually exclusive by construction here rather than
    // by the order of two `if`s further down a 1500-line file — which is what
    // makes "a new message is delivered exactly once" (AC-5) a property of an
    // exported pure function that a test can hold, instead of an argument.
    const next = nextPollAction({
      decideAction: result.action,
      loopPending: loopOps.pending(),
      deployPending: deployOps.pendingDeploy(),
      lockHeld: loopOps.blockedByLock(), // F2; logs its own one-per-episode line
    });
    if (next === 'idle') return;
    if (next === 'fire-message') {
      fire(sentinel);
      return; // the message path just fired; the loop folds it in at settle()
    }
    if (next === 'wait-lock') return; // blockedByLock() has already said so
    if (next === 'wait-deploy') {
      // Yield so tick N+1 runs against tick N's merged code. One line per wait
      // episode, not one per 5s poll (AS-13 #4's rule, applied to this log too).
      if (!loopWaitLogged) {
        loopWaitLogged = true;
        log('LOOP-WAIT deploy pending');
      }
      return;
    }
    loopWaitLogged = false;
    loopOps.takeFire(); // logs LOOP-FIRE, once per tick rather than per retry
    // The REAL sentinel, when there is one — load-bearing, not incidental. A
    // loop tick re-fires the message the run is still answering, so fire()
    // rewrites the highwater to the value it already holds (no move, AC-5), and
    // the tick log names the message a reader is looking for. The synthetic
    // fallback is for the case where the sentinel file is gone or unparsable:
    // the current highwater id, so the rewrite is still a no-op.
    const highwater = readJson(paths.highwater);
    fire(sentinel ?? { messageId: highwater ? highwater.messageId : 0, authorId: 'loop' });
  }

  // AS-75 deploy poll. Everything it does lives in makeDeployOps (exported,
  // unit-tested); these six lines are the entire unguarded wiring, and they are
  // enumerated in the implementation report so a reviewer can check the claim
  // against the diff rather than re-derive it. `void` because evaluate() is
  // async and a rejected promise here must not become an unhandled rejection —
  // every branch inside it already handles its own failure.
  const deployOps = makeDeployOps({
    repoRoot: config.repoRoot,
    appDir: join(config.repoRoot, 'apps', 'chat'),
    watchDir: dirname(fileURLToPath(import.meta.url)),
    logsDir,
    statePath: paths.deployState,
    lockPath: paths.lock,
    lockStaleMs: config.lockStaleMin * 60 * 1000,
    cooldownMs: config.deployCooldownMin * 60 * 1000,
    deployTimeoutMs: config.deployTimeoutMin * 60 * 1000,
    retentionMs: config.tickLogRetentionDays * 24 * 60 * 60 * 1000,
    chatUrl: config.chatUrl,
    log,
  });
  log(`DEPLOY-POLL every ${config.deployPollS}s (docker ${deployOps.dockerBin ?? `unresolved: ${deployOps.dockerReason}`}, git ${deployOps.gitBin}, watcher source ${deployOps.baselineDigest})`);
  const deployInterval = setInterval(() => void deployOps.evaluate({ busy: Boolean(child) }), config.deployPollS * 1000);
  deployInterval.unref();

  log(
    `START watcher pid ${process.pid} repo ${config.repoRoot} ` +
      `(poll ${config.pollS}s, debounce ${config.debounceS}s, timeout ${config.tickTimeoutMin}min, ` +
      `stale ${config.lockStaleMin}min, mode ${config.permissionMode})`
  );
  loopOps.resume(); // AS-95: re-enter a loop the previous process was running
  const interval = setInterval(poll, config.pollS * 1000);
  poll(); // immediate startup pass: missed-while-down recovery (plan §4)

  function shutdown(signal) {
    log(`STOP ${signal}`);
    clearInterval(interval);
    clearInterval(deployInterval);
    if (child) {
      log('STOP terminating in-flight tick');
      child.kill('SIGTERM');
    }
    releaseLock();
    try {
      unlinkSync(paths.pid);
    } catch {
      /* already gone */
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Execute only when run directly (never on `import { decide } ...` in tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
