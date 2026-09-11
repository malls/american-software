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
// apps/chat/test/watcher.test.js. The fs/spawn effects live in the exported
// makeWatcher factory (AS-82), beside the five older ops factories: every
// collaborator it touches — the clock, the spawn, the pid, the log stream, the
// exit — is injectable, and apps/chat/test/watcher-main.test.js drives the
// poll/fire/settle/shutdown paths against a temp data dir with a fake child.
// AS-13 did the same for the lock ops (makeLockOps), AS-95 for the loop state
// machine (makeLoopOps); AS-82 finished the job, because the residue left in
// main() was where every unguarded line had accumulated (the AS-27 heartbeat
// call site among them: deleting it left the whole suite green).
//
// main() is now config, paths, log rotation, the log closure and the two signal
// handlers — nothing else — and apps/chat/test/watcher-process.test.js runs the
// real entry point once, against a temp data dir with no sentinel, to cover the
// one property no fake can hold: that the heartbeat advances on its own
// interval in a real process, and that SIGTERM removes the pid file.

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
// AS-100: one implementation of the envelope, the fold and the outcome rules,
// shared by the CLI, the watcher and the server so they cannot drift.
import {
  makeEvent,
  appendEvent,
  readStream,
  openItems,
  tickOutcome,
  stageCloseOutcome,
} from '../lib/events.js';

// --- configuration (env-overridable; defaults per plan §4) ------------------

export const DEFAULTS = Object.freeze({
  pollS: 5, // sentinel poll interval
  debounceS: 15, // trailing debounce window (board band: 10–30s)
  tickTimeoutMin: 30, // hard tick timeout: SIGTERM, 15s grace, SIGKILL
  lockStaleMin: 45, // lock age staleness (> tick timeout, deliberately)
  // AS-84: how long shutdown() waits for the children it just SIGTERMed (the
  // tick child's settle(), the deploy's abort record + lock release) before it
  // SIGKILLs and exits anyway. The plist template sets KeepAlive:true and no
  // ExitTimeOut, so launchd SIGKILLs the watcher 20s after SIGTERM — 10s leaves
  // margin for settle()'s file writes and still exits well inside that box.
  shutdownGraceS: 10,
  tickLogRetentionDays: 14, // prune tick-*.log and deploy-*.log older than this
  permissionMode: 'acceptEdits',
  claudeBin: 'claude',
  // AS-75 deploy poll. 60s is far below the human threshold for "did my merge
  // ship" and far above the cost of two git calls plus one loopback fetch.
  deployPollS: 60,
  deployTimeoutMin: 15, // an emulated linux/amd64 rebuild, generously
  deployCooldownMin: 30, // suppress only a REPEAT of a failed attempt at the same id
  chatUrl: 'http://127.0.0.1:8347',
  // AS-99 lanes poll. A tick is when lanes change, so 15s is well inside the
  // window a board member would notice, and four polls fit inside the 60s
  // staleness threshold the server applies to the snapshot (lib/lanes.js).
  // Read-only git calls only, and deliberately NOT gated on `busy`.
  lanesPollS: 15,
  // AS-100 events sweep. Level-triggered reconciliation of stages a tick this
  // watcher did not fire left open. 60s is one order below the tick box it
  // compares against, so a cut stage is labelled within a minute of the box
  // expiring, and it costs one read of a small append-only file.
  eventsSweepS: 60,
});

// AS-75: the image's git-committed inputs, as repo-relative-to-apps/chat paths.
// AS-86 fixed the definition: an image input is a tracked path under apps/chat
// whose COMMITTED CONTENT can change the bytes of the built image — not "a path
// the Dockerfile COPYs". The two coincide by construction, and the COPY set is
// the mechanism that keeps them coinciding: this is a hand-maintained copy of a
// fact that lives in the Dockerfile's COPY lines, so it gets a guard
// (test/deploy-shape.test.js parses those COPY lines and asserts set equality
// against this list). Change one, change both.
//
// `.dockerignore` is here because it is the one CONTEXT-SHAPING input: it never
// runs, but it decides what `COPY lib ./lib` actually copies, so a committed
// edit to it can shrink the image without touching any other path. It was
// outside this list until AS-86, and no guard could see the gap — the COPY-set
// guard derives its expectation from the COPY lines, so a file in no COPY line
// is invisible to it by construction. The fix was to make it a COPY source, so
// the existing equality guard now REQUIRES it here. The second guard against
// the general case is classifyImagePaths below.
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
  '.dockerignore',
]);

// AS-86: tracked paths under apps/chat that are in the build context but are
// NOT image inputs. Every tracked path must be an IMAGE_INPUTS path (or under
// one), or one of these. Anything else is unclassified, and the guard in
// test/deploy-shape.test.js fails on it — which is the thing the COPY-set guard
// structurally cannot do: prove that the COPY set is ALL of the inputs. Adding
// a tracked file under apps/chat is therefore a decision someone has to record
// here or in the Dockerfile, not something that can happen silently.
export const NOT_IMAGE_INPUTS = Object.freeze(['README.md', 'chat', 'data']);

/**
 * Split tracked apps/chat-relative paths into { inputs, declared, unclassified },
 * each in input order. A path belongs to a root when it IS that root or lies
 * under it (`x/`), so directory roots such as `lib` cover `lib/store.js` while
 * `Dockerfile` does not cover `Dockerfile.dockerignore`.
 *
 * Pure — the caller supplies the list (`git ls-files`), so the test that runs
 * real git and the test that feeds a literal fixture exercise the same code.
 * `inputs` is checked before `declared`; the two sets are asserted disjoint in
 * the tests so the precedence never actually decides anything.
 */
export function classifyImagePaths(trackedPaths) {
  const under = (p, roots) => roots.some((root) => p === root || p.startsWith(root + '/'));
  const inputs = [];
  const declared = [];
  const unclassified = [];
  for (const p of trackedPaths) {
    if (under(p, IMAGE_INPUTS)) inputs.push(p);
    else if (under(p, NOT_IMAGE_INPUTS)) declared.push(p);
    else unclassified.push(p);
  }
  return { inputs, declared, unclassified };
}

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
    shutdownGraceS: envNum(env, 'ADVANCE_SHUTDOWN_GRACE_S', DEFAULTS.shutdownGraceS),
    tickLogRetentionDays: DEFAULTS.tickLogRetentionDays,
    permissionMode: env.ADVANCE_PERMISSION_MODE || DEFAULTS.permissionMode,
    claudeBin: env.ADVANCE_CLAUDE_BIN || DEFAULTS.claudeBin,
    repoRoot: env.ADVANCE_REPO_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'),
    deployPollS: envNum(env, 'ADVANCE_DEPLOY_POLL_S', DEFAULTS.deployPollS),
    deployTimeoutMin: envNum(env, 'ADVANCE_DEPLOY_TIMEOUT_MIN', DEFAULTS.deployTimeoutMin),
    deployCooldownMin: envNum(env, 'ADVANCE_DEPLOY_COOLDOWN_MIN', DEFAULTS.deployCooldownMin),
    chatUrl: env.ADVANCE_CHAT_URL || DEFAULTS.chatUrl,
    lanesPollS: envNum(env, 'ADVANCE_LANES_POLL_S', DEFAULTS.lanesPollS),
    eventsSweepS: envNum(env, 'ADVANCE_EVENTS_SWEEP_S', DEFAULTS.eventsSweepS),
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
      // AS-84: pid ALONE cannot tell our write from a same-pid sibling's — the
      // watcher's lock ops and the deploy's lock ops are two instances in one
      // process. The nonce is this write's own, so it closes that ambiguity
      // here exactly as `source` closes it in releaseLock() below.
      const verify = parseLock();
      if (verify && verify.pid === pid && verify.nonce === nonce) return true;
      log(`STEAL-LOST lock holds pid ${verify?.pid ?? '?'} after our create; yielding`);
      return false;
    }
    return false;
  }

  /**
   * Unlink the lock only when it is OURS — same pid AND same `source`.
   *
   * AS-84 (Ruben's AS-75 F5): pid alone is not ownership here. The watcher's
   * lock ops and the deploy's lock ops are two instances over one file in ONE
   * process, differing only in `source`, so a pid-only test let shutdown()
   * unlink a `source:'deploy'` lock while the build it guards was still
   * running — and would equally let the deploy's `finally` unlink the tick's
   * `source:'watcher'` lock. Pid stays in the test: a foreign live session's
   * lock must never be released either.
   */
  function releaseLock() {
    const held = parseLock();
    if (held && held.pid === pid && held.source === source) {
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
 *
 * AS-84: `onSpawn(proc)` hands the child OUT, once, immediately after spawn.
 * Before this the compose process lived and died inside this closure and
 * nothing outside could reach it, so shutdown() SIGTERMed the tick child and
 * left the build running unguarded (AS-75 F5). Default no-op: every existing
 * call site is unchanged by construction.
 */
export function runDockerCompose({ dockerBin, cwd, env, logPath, timeoutMs, log, spawnFn = spawn, createLog = createWriteStream, onSpawn = () => {} }) {
  return new Promise((resolve_) => {
    const out = createLog(logPath, { flags: 'a' });
    const proc = spawnFn(dockerBin, ['compose', '--progress', 'quiet', 'up', '-d', '--build'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onSpawn(proc);
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
 * AS-84: `deploy-state.json`'s `lastAttempt` -> the in-memory record, or null.
 * Pure; the ctor below calls it once so a RELAUNCHED watcher starts with the
 * cooldown the process before it earned, instead of a blank slate that retries
 * a failing build immediately (AS-75 F5, third claim).
 *
 * `at` comes back as an ISO string and goes out as ms, because decideDeploy
 * does arithmetic on it. Anything unparsable is null: a cooldown we cannot date
 * is not a cooldown we may enforce.
 *
 * `outcome:'started'` is the record performDeploy writes BEFORE spawning
 * compose. Finding one on disk means the process died under its own build —
 * exactly the crash-loop the cooldown exists to bound — so it hydrates as a
 * failure, with a detail that says which kind.
 */
export function hydrateAttempt(record) {
  if (!record || typeof record !== 'object') return null;
  if (typeof record.id !== 'string') return null;
  const at = Date.parse(record.at);
  if (!Number.isFinite(at)) return null;
  if (record.outcome === 'started') {
    return { id: record.id, at, outcome: 'fail', detail: 'interrupted: watcher exited mid-build' };
  }
  if (record.outcome !== 'ok' && record.outcome !== 'fail' && record.outcome !== 'aborted') return null;
  return { id: record.id, at, outcome: record.outcome, detail: record.detail ?? '' };
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
  readState = readJson, // AS-84: the other half of writeState — see hydrateAttempt
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
  // AS-84: hydrated, not blank. `lastAttempt` used to be memory-only — persist()
  // wrote it and nothing ever read it back — so a watcher that launchd relaunched
  // mid-crash-loop retried the same failing build at once.
  let lastAttempt = hydrateAttempt(readState(statePath)?.lastAttempt);
  let lastDecision = null; // AS-95: the last evaluate() decision, for pendingDeploy()
  let lastWarn = null;
  // AS-84: the in-flight compose child and the promise that resolves when the
  // performDeploy guarding it has fully settled (lock released, attempt
  // recorded). Both are null while idle; abort() is what reads them.
  let deployChild = null;
  let deployDone = null;
  let abortSignal = null;

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

  // `stateFields` is what evaluate() last persisted about this decision; the
  // pre-build write below repeats it so the only thing that changes on disk is
  // the attempt record (a bare persist() would reset `reason` to its default
  // and blank the sidebar's build line for the length of the build).
  async function performDeploy(desiredId, stateFields = { desiredId }) {
    if (!lock.acquireLock(fireNonce())) {
      log(`SKIP deploy aborted: lock acquisition failed (build ${desiredId})`);
      return;
    }
    deploying = true;
    abortSignal = null;
    let settleDeploy;
    deployDone = new Promise((ok) => {
      settleDeploy = ok;
    });
    prune(logsDir, now() - retentionMs);
    const logPath = join(logsDir, `deploy-${new Date(now()).toISOString().replaceAll(':', '-')}.log`);
    const startedAt = now();
    log(`DEPLOY building ${desiredId} -> ${logPath}`);

    let outcome = 'fail';
    let detail = '';
    try {
      // AS-84: the attempt is on disk BEFORE compose is spawned. A watcher that
      // is SIGKILLed under its own build leaves no `finally` behind, so without
      // this write the crash is invisible to the relaunched process; with it,
      // hydrateAttempt reads 'started' and counts it as the failure it was.
      lastAttempt = { id: desiredId, at: startedAt, outcome: 'started', detail: 'building' };
      persist(stateFields);
      const result = await deploy({
        dockerBin: docker.bin,
        cwd: appDir,
        logPath,
        timeoutMs: deployTimeoutMs,
        log,
        onSpawn: (proc) => {
          deployChild = proc;
        },
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
        // A build WE killed on the way out is not a failed build. Recording it
        // as 'fail' would put the merge in a 30-min cooldown (decideDeploy rule
        // 7 matches 'fail' only), so an operator `kickstart -k` mid-build would
        // delay the very deploy it was meant to hurry. A timeout stays a
        // failure: nobody asked for that one.
        if (abortSignal !== null && result.signal !== null && !result.timedOut) {
          outcome = 'aborted';
          detail = `aborted by shutdown (${abortSignal})`;
        } else {
          detail = `exit ${result.code}${result.timedOut ? ' (timeout)' : ''}${result.error ? ` ${result.error}` : ''}`;
        }
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
      deployChild = null;
      abortSignal = null;
    }
    lastAttempt = { id: desiredId, at: now(), outcome, detail };
    log(`DEPLOY ${outcome} ${desiredId} (${detail}) after ${Math.round((now() - startedAt) / 1000)}s`);
    deployDone = null;
    settleDeploy();
  }

  /**
   * AS-84: signal the in-flight build and resolve when it has settled — the
   * lock released by its own owner, the attempt recorded. Resolves immediately
   * and touches nothing when idle, so shutdown() can call it unconditionally.
   */
  async function abort(signal = 'SIGTERM') {
    if (!deploying) return;
    abortSignal = signal;
    const pending = deployDone;
    if (deployChild) {
      try {
        deployChild.kill(signal);
      } catch {
        /* already gone; the settle below still runs */
      }
    }
    await pending;
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
  async function evaluateInner({ busy = false } = {}) {
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
      await performDeploy(desired.id, {
        desiredId: desired.id,
        dirty: false,
        runningId: running ? running.id : null,
        reason: decision.reason,
        desiredReason,
      });
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

  /**
   * AS-84 (Ruben's AS-75 F6), the belt: evaluate() never rejects. The call site
   * is a setInterval callback, and Node terminates the process on an unhandled
   * rejection — so a throw anywhere in the poll would take the watcher down and
   * with it every future tick. Today's callees swallow their own errors, which
   * makes the rejection path latent rather than absent: prune() runs outside
   * the try, createLog can emit 'error' (EACCES on logsDir), and any future
   * edit inside evaluateInner re-arms it.
   *
   * The error decision is recorded like any other, so pendingDeploy() reads
   * false (reason is neither 'busy' nor 'stale-build') and a broken poll cannot
   * make the AS-95 loop wait forever.
   */
  async function evaluate(opts = {}) {
    try {
      return await evaluateInner(opts);
    } catch (err) {
      warnOnce(`error:${err.message}`, `deploy poll failed: ${err.message}`);
      const decision = { action: 'noop', reason: 'error', detail: err.message };
      lastDecision = decision;
      persist({ reason: 'error', desiredReason: 'error' });
      return decision;
    }
  }

  return {
    evaluate,
    abort,
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
    // AS-100 borrows this rather than restating the staleness rule: one rule
    // for "a tick is running", two callers.
    lockIsBusy,
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
  if (lockHeld) return 'wait-lock';
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

// --- AS-99: the lanes snapshot ----------------------------------------------
//
// The chat container has no git binary and cannot reach a linked worktree's
// .git anyway (each .worktrees/AS-n/.git is a FILE holding an absolute host
// path), so the git half of the lane view is a host fact the watcher writes to
// apps/chat/data/worktrees.json — the fourth file in the table beside
// deploy-state.json, advance-loop.json and advance-watcher.pid. The server
// joins it to .lattice read-only; see apps/chat/lib/lanes.js.
//
// Pure parser + classifier first, effects in the factory below, same split as
// every other section of this file.

/**
 * `git worktree list --porcelain` -> rows. Tolerant by construction: a snapshot
 * may be taken mid-`worktree add`, so a record missing HEAD yields a row with an
 * `errors` entry, never a throw (AC-1).
 *
 * Row shape: { path, head, branch, detached, locked, prunable, bare, main,
 * errors[] }. `path` is the ABSOLUTE host path — the factory needs it as a cwd
 * for the per-row git calls and strips it to a repo-relative path before the
 * snapshot is written (host-private facts stay out of the payload).
 */
export function parseWorktreeList(stdout) {
  const rows = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    if (cur.head === null) cur.errors.push('head: missing from porcelain record');
    if (cur.branch === null && !cur.detached) cur.errors.push('branch: no branch and no detached marker');
    rows.push(cur);
    cur = null;
  };
  for (const raw of String(stdout ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line === '') {
      flush();
      continue;
    }
    const sp = line.indexOf(' ');
    const key = sp === -1 ? line : line.slice(0, sp);
    const value = sp === -1 ? '' : line.slice(sp + 1);
    if (key === 'worktree') {
      flush();
      cur = {
        path: value,
        head: null,
        branch: null,
        detached: false,
        locked: false,
        prunable: false,
        bare: false,
        // git always lists the main worktree first; every later record is a
        // linked worktree. The projection drops the main row, but the snapshot
        // keeps it so the file is a complete answer to "what does git say".
        main: rows.length === 0,
        errors: [],
      };
      continue;
    }
    if (!cur) continue; // a stray attribute before any `worktree` line
    if (key === 'HEAD') cur.head = value;
    else if (key === 'branch') cur.branch = value.replace(/^refs\/heads\//, '');
    else if (key === 'detached') cur.detached = true;
    else if (key === 'locked') cur.locked = true;
    else if (key === 'prunable') cur.prunable = true;
    else if (key === 'bare') cur.bare = true;
  }
  flush();
  return rows;
}

/**
 * Is this branch already merged into master? Three facts, all three needed
 * (AC-6): a branch cut from master's tip this minute is an ancestor with ahead
 * 0 too, and only the first-parent test separates "merged with --no-ff" from
 * "never committed on". Any unknown input yields null — never a confident false.
 *
 * Known limit, recorded in apps/chat/README.md: a SQUASH merge leaves a tip
 * that is not an ancestor of master at all, so git alone cannot see it. The
 * task-status half of the STALE flag covers that case once the task is done.
 */
export function classifyMerged({ ahead, isAncestor, onFirstParent }) {
  if (ahead === null || ahead === undefined) return null;
  if (isAncestor === null || isAncestor === undefined) return null;
  if (onFirstParent === null || onFirstParent === undefined) return null;
  return ahead === 0 && isAncestor === true && onFirstParent === false;
}

/** The marker a worktree outside the repo root gets instead of its host path.
 *  It cannot collide with a real repo-relative path (those never start with a
 *  '<'), which is what lets the composer keep using relPath as a lane key. */
export const OUTSIDE_REPO = '<outside repo>';

/** Repo-relative path for the snapshot. '.' for the main checkout itself.
 *
 *  A linked worktree can legitimately live anywhere on the host (`git worktree
 *  add /tmp/throwaway`), and the absolute host path must NEVER reach the
 *  snapshot — the plan's T4 says so outright, and the payload flows straight to
 *  a browser through lane.worktree.relPath and lane.key. Such a row is marked
 *  instead, keeping only the basename so two outside worktrees stay distinct
 *  lanes (the key falls back to relPath when no task joins). */
export function relPathOf(repoRoot, path) {
  const root = String(repoRoot ?? '').replace(/\/+$/, '');
  const p = String(path ?? '');
  if (p === root) return '.';
  if (root && p.startsWith(root + '/')) return p.slice(root.length + 1);
  // Already relative (or empty): nothing to leak, leave it alone.
  if (!p.startsWith('/')) return p;
  const base = p.replace(/\/+$/, '').split('/').pop();
  return base ? `${OUTSIDE_REPO}/${base}` : OUTSIDE_REPO;
}

/** Porcelain v1 status lines -> { dirtyCount, dirtyLattice }. `dirtyLattice`
 *  surfaces the two-plane-rule violation CLAUDE.md § "Working-directory hazard"
 *  describes: board state written onto a task branch, visible for free. */
export function summarizeStatus(stdout) {
  let dirtyCount = 0;
  let dirtyLattice = false;
  for (const line of String(stdout ?? '').split('\n')) {
    if (line.trim() === '') continue;
    dirtyCount += 1;
    const rest = line.length > 3 ? line.slice(3) : line;
    for (const part of rest.split(' -> ')) {
      const p = part.trim().replace(/^"|"$/g, '');
      if (p === '.lattice' || p.startsWith('.lattice/')) dirtyLattice = true;
    }
  }
  return { dirtyCount, dirtyLattice };
}

const LOG_FORMAT = '%H%x00%an%x00%ae%x00%cI%x00%s';

function parseLastCommit(stdout) {
  const parts = String(stdout ?? '').replace(/\n$/, '').split('\0');
  if (parts.length < 5 || !parts[0]) return null;
  return {
    sha: parts[0],
    authorName: parts[1],
    authorEmail: parts[2],
    committedAt: parts[3],
    subject: parts.slice(4).join('\0'),
  };
}

/**
 * The lanes snapshot's effects, injected exactly as makeDeployOps injects its
 * own — every git call, the clock, the writer and the log, so each branch below
 * is a unit test with no git and no filesystem.
 *
 * evaluate() NEVER rejects and writes the file on EVERY call, including the
 * failure paths: a failed poll is a fact with a timestamp, not a missing file,
 * and the freshness rule (lib/lanes.js LANES_STALE_MS) is only honest if
 * generatedAt advances whether or not the content changed (AC-2, AC-3).
 *
 * Returns { evaluate, statePath, gitBin }.
 */
export function makeLanesOps({
  repoRoot,
  statePath,
  gitBin = 'git',
  run = runSync,
  now = () => Date.now(),
  writeState = defaultWriteState,
  log = () => {},
}) {
  let lastWriteWarn = null;

  function persist(body) {
    try {
      writeState(statePath, body);
    } catch (err) {
      if (lastWriteWarn !== err.message) {
        lastWriteWarn = err.message;
        log(`WARN cannot write ${statePath} (${err.message}); the lane view degrades, the watcher does not`);
      }
      return;
    }
    lastWriteWarn = null;
  }

  function git(args, cwd) {
    return run(gitBin, args, { cwd });
  }

  function firstLine(text) {
    return String(text ?? '').split('\n')[0].trim();
  }

  async function evaluate() {
    const generatedAt = new Date(now()).toISOString();
    const base = { schema: 1, source: 'watcher:git', generatedAt };
    try {
      const list = git(['worktree', 'list', '--porcelain'], repoRoot);
      if (list.code !== 0) {
        const error = list.code === -1 ? 'no-git' : `worktree-list-failed: ${firstLine(list.stderr) || `exit ${list.code}`}`;
        persist({ ...base, master: { head: null }, error, worktrees: [] });
        return;
      }

      const masterRev = git(['rev-parse', 'master'], repoRoot);
      const masterHead = masterRev.code === 0 ? masterRev.stdout.trim() || null : null;

      // ONE first-parent walk per poll, shared by every row: the membership
      // question is the same question for all of them, and master's first-parent
      // chain is the same list.
      const fp = git(['rev-list', '--first-parent', 'master'], repoRoot);
      const firstParent = fp.code === 0 ? new Set(fp.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) : null;

      const worktrees = [];
      for (const row of parseWorktreeList(list.stdout)) {
        const out = {
          relPath: relPathOf(repoRoot, row.path),
          main: row.main,
          head: row.head,
          branch: row.branch,
          detached: row.detached,
          ahead: null,
          behind: null,
          dirtyCount: null,
          dirtyLattice: null,
          merged: null,
          lastCommit: null,
          errors: [...row.errors],
        };
        // The main checkout is master by definition: counting it against
        // itself is noise, and the projection drops the row anyway.
        if (row.main || !row.head) {
          worktrees.push(out);
          continue;
        }
        const ref = row.branch ?? row.head;
        const cwd = row.path;

        // Each call is isolated: one broken worktree records its own error and
        // never blanks its neighbours or aborts the snapshot (AC-4).
        const counts = git(['rev-list', '--left-right', '--count', `master...${ref}`], cwd);
        if (counts.code === 0) {
          const [behind, ahead] = counts.stdout.trim().split(/\s+/).map((n) => Number(n));
          if (Number.isFinite(behind) && Number.isFinite(ahead)) {
            out.behind = behind;
            out.ahead = ahead;
          } else {
            out.errors.push(`rev-list: unparsable count "${counts.stdout.trim()}"`);
          }
        } else {
          out.errors.push(`rev-list: exit ${counts.code} ${firstLine(counts.stderr)}`.trim());
        }

        // --no-optional-locks is the whole reason a background poll is safe to
        // run against a worktree an employee is committing in: without it git
        // may take the index lock and write the worktree's git dir (AC-5).
        const status = git(['--no-optional-locks', 'status', '--porcelain'], cwd);
        if (status.code === 0) {
          const s = summarizeStatus(status.stdout);
          out.dirtyCount = s.dirtyCount;
          out.dirtyLattice = s.dirtyLattice;
        } else {
          out.errors.push(`status: exit ${status.code} ${firstLine(status.stderr)}`.trim());
        }

        const logOut = git(['log', '-1', `--format=${LOG_FORMAT}`], cwd);
        if (logOut.code === 0) out.lastCommit = parseLastCommit(logOut.stdout);
        else out.errors.push(`log: exit ${logOut.code} ${firstLine(logOut.stderr)}`.trim());

        const ancestor = git(['merge-base', '--is-ancestor', row.head, 'master'], cwd);
        const isAncestor = ancestor.code === 0 ? true : ancestor.code === 1 ? false : null;
        if (isAncestor === null) out.errors.push(`merge-base: exit ${ancestor.code} ${firstLine(ancestor.stderr)}`.trim());
        const onFirstParent = firstParent === null ? null : firstParent.has(row.head);
        out.merged = classifyMerged({ ahead: out.ahead, isAncestor, onFirstParent });

        worktrees.push(out);
      }

      persist({ ...base, master: { head: masterHead }, error: null, worktrees });
    } catch (err) {
      // Nothing above is allowed to take the watcher down, and a poll that
      // died still owes the reader a timestamped answer.
      persist({ ...base, master: { head: null }, error: `worktree-list-failed: ${err.message}`, worktrees: [] });
    }
  }

  return { evaluate, statePath, gitBin };
}

/**
 * AS-100 — the company-events reconciler, the fourth factory beside
 * makeLockOps / makeDeployOps / makeLoopOps. main() keeps only wiring.
 *
 * The property this exists to hold (T2, AC-7): a stage cut by the tick timeout
 * is recorded as `cut_by_timeout`, never as `completed`. The orchestrator that
 * would have emitted stage_ended is dead exactly when it matters, so the
 * watcher closes what it left open — at settle() (exact, immediate) and in
 * sweep() (level-triggered, for ticks this process did not fire).
 *
 * What is "open" is DERIVED from the stream on every call (openItems in
 * lib/events.js). There is no open-set file and no in-memory set that outlives
 * one call: if the orchestrator's own stage_ended landed, the next read simply
 * sees the stage closed. One stream, and the reconciler is another projection
 * of it that happens to write back.
 *
 * Nothing here throws. A failed append degrades the feed, not the tick — the
 * makeDeployOps persist() pattern, with the same warn-once rule.
 */
export function makeEventsOps({
  streamPath,
  tickTimeoutMs = DEFAULTS.tickTimeoutMin * 60 * 1000,
  lockBusy = () => false,
  isBusy = () => false,
  now = () => Date.now(),
  readFile = readFileSync,
  append = appendFileSync,
  mkdir = mkdirSync,
  log = () => {},
}) {
  let lastWriteWarn = null;

  function read() {
    return readStream(streamPath, { readFile });
  }

  /** One event appended, or null if the append failed. Never throws. */
  function emit(type, data, nowMs) {
    try {
      const ev = makeEvent({ type, actor: 'system:watcher', data, now: new Date(nowMs) });
      appendEvent(streamPath, ev, { append, mkdir });
      lastWriteWarn = null;
      return ev;
    } catch (err) {
      if (lastWriteWarn !== err.message) {
        lastWriteWarn = err.message;
        log(`WARN cannot append ${streamPath} (${err.message}); the events feed degrades, the tick does not`);
      }
      return null;
    }
  }

  function secondsSince(ts, nowMs) {
    const started = Date.parse(ts);
    return Number.isFinite(started) ? Math.round((nowMs - started) / 1000) : null;
  }

  function ageMs(ts, nowMs) {
    const started = Date.parse(ts);
    // An unparsable ts is not evidence of age: treat it as young so the sweep
    // never closes a stage on the strength of a malformed timestamp.
    return Number.isFinite(started) ? nowMs - started : 0;
  }

  /**
   * The open tick and what happened inside it, straight off the shared fold —
   * `openItems().tick` is non-null exactly while a tick_started has no
   * tick_ended after it, and it carries the stage_started events that followed.
   * Single-flight is what makes that correct: exactly one tick runs at a time,
   * so a stage event after an open tick_started belongs to that tick (derived,
   * never declared — T1 §1). Not recomputed here, so it cannot drift from the
   * projection the server serves.
   */
  function tickScope(open) {
    const tick = open.tick;
    return {
      tickId: tick ? tick.id : null,
      stagesStarted: tick ? tick.stagesStarted : 0,
      lanesTouched: tick ? [...tick.lanesTouched] : [],
    };
  }

  /** Close every open sub-agent then every open stage, with one outcome.
   *  Returns the number of STAGES closed (tick_ended.stagesClosed). */
  function closeOpen(open, { outcome, exit, closedBy, reason, nowMs }) {
    for (const sub of open.subagents) {
      emit(
        'subagent_exited',
        {
          task: sub.task,
          stage: sub.stage,
          actor: sub.actor,
          exit,
          closedBy,
          spawnedId: sub.id,
          durationS: secondsSince(sub.ts, nowMs),
          tokens: null,
          costUsd: null,
        },
        nowMs
      );
    }
    let stagesClosed = 0;
    for (const stage of open.stages) {
      emit(
        'stage_ended',
        {
          task: stage.task,
          stage: stage.stage,
          actor: stage.actor,
          outcome,
          reason,
          closedBy,
          startedId: stage.id,
          durationS: secondsSince(stage.ts, nowMs),
        },
        nowMs
      );
      stagesClosed += 1;
    }
    return stagesClosed;
  }

  function tickStarted({ source = 'watcher', pid = null, messageId = null, loopTick = null, nowMs = now() } = {}) {
    const startedAt = new Date(nowMs).toISOString();
    // No nonce, deliberately (T1 §1): the fire nonce is the lock's anti-spoof
    // token and /api/events is a read-back endpoint. The tick's identity in the
    // stream is this event's own id, which tick_ended.tickId references.
    return emit('tick_started', { source, pid, startedAt, messageId, loopTick }, nowMs);
  }

  function tickEnded({ code = null, signal = null, timedOut = false, headBefore = null, headAfter = null, nowMs = now() } = {}) {
    const { events } = read();
    const open = openItems(events);
    const { tickId, stagesStarted, lanesTouched } = tickScope(open);
    const outcome = stageCloseOutcome({ code, signal, timedOut });
    // (b) BEFORE (c) — a stated property (T2): a consumer must never observe a
    // closed tick with a stage still open.
    const stagesClosed = closeOpen(open, {
      outcome,
      exit: outcome,
      closedBy: 'watcher-settle',
      reason: null,
      nowMs,
    });
    const headMoved = Boolean(headBefore && headAfter && headBefore !== headAfter);
    return emit(
      'tick_ended',
      {
        tickId,
        outcome: tickOutcome({ code, signal, timedOut, stagesStarted, headMoved }),
        code,
        signal,
        timedOut,
        headMoved,
        lanesTouched,
        stagesClosed,
        reason: null,
      },
      nowMs
    );
  }

  /**
   * Level-triggered reconciliation for ticks this watcher did not fire (a live
   * `/loop /advance` session, or a watcher restarted mid-tick). Gated off while
   * our own child runs or ANY fresh lock is held — lockBusy is the deploy's own
   * staleness rule, injected rather than restated, so there is one rule.
   */
  function sweep({ nowMs = now() } = {}) {
    if (isBusy()) return { action: 'noop', reason: 'child-running', closed: 0 };
    if (lockBusy(nowMs)) return { action: 'noop', reason: 'lock-fresh', closed: 0 };
    const { events } = read();
    const open = openItems(events);
    // Younger than the tick box: a live-session tick that released its lock
    // between stages, or an orchestrator about to emit. Left alone.
    const stale = {
      stages: open.stages.filter((s) => ageMs(s.ts, nowMs) >= tickTimeoutMs),
      subagents: open.subagents.filter((s) => ageMs(s.ts, nowMs) >= tickTimeoutMs),
    };
    const closed = closeOpen(stale, {
      outcome: 'cut_by_timeout',
      exit: 'cut_by_timeout',
      closedBy: 'watcher-sweep',
      reason: 'sweep',
      nowMs,
    });
    let tickClosed = false;
    if (open.tick) {
      // No fresh lock (checked above) and a tick still open: the watcher died
      // mid-tick and was relaunched. A resumed loop must not leave the previous
      // process's tick open forever.
      const { tickId, lanesTouched } = tickScope(open);
      emit(
        'tick_ended',
        {
          tickId,
          outcome: 'error',
          code: null,
          signal: null,
          timedOut: false,
          headMoved: false,
          lanesTouched,
          stagesClosed: closed,
          reason: 'watcher-restarted',
        },
        nowMs
      );
      tickClosed = true;
    }
    if (closed || stale.subagents.length || tickClosed) {
      log(`EVENTS-SWEEP closed ${closed} stage(s), ${stale.subagents.length} sub-agent(s)${tickClosed ? ', 1 open tick' : ''}`);
      return { action: 'closed', reason: 'stale', closed };
    }
    return { action: 'noop', reason: 'nothing-open', closed: 0 };
  }

  return {
    tickStarted,
    tickEnded,
    sweep,
    openItems: () => openItems(read().events),
    streamPath,
  };
}

/**
 * AS-82 — everything main() used to do, as a factory beside the five above.
 *
 * WHY THIS IS A FACTORY. The same argument makeLoopOps was lifted out on
 * (AS-95 cycle-1 F7), one layer up: the poll/fire/settle/shutdown body was
 * ~400 lines that no test could reach, because reaching them meant running
 * main(). What lived there was not incidental wiring — it was the AS-27
 * heartbeat call site, the lock take and release, the AS-21 spawn argv/env
 * call site, the highwater write, the AS-100 tick events, the tick box, and
 * the shutdown sequence. Priya's AS-27 review proved the cost exactly:
 * deleting the heartbeat call left 255 tests green, so the suite was not
 * evidence that the loop-status indicator would ever leave "Off".
 *
 * Every collaborator is injected with the value main() passes today as its
 * default, so the production path is unchanged by construction: the clock, the
 * pid, the liveness probe, the spawn, the tick-log stream and the exit. The
 * five ops are built by start() (not at factory-call time) so the sequence of
 * side effects stays what it is today — makeDeployOps reads the watch dir and
 * probes for docker at construction, and that must still happen AFTER the
 * single-instance check, not before.
 *
 * @param config     loadConfig() result
 * @param paths      { sentinel, highwater, lock, pid, settings, deployState,
 *                     loopState, worktrees, events }
 * @param logsDir    where tick-*.log and deploy-*.log land
 * @param watchDir   this file's directory (the deploy's self-digest input)
 * @param log        (line) => void
 * @param lockOps|loopOps|deployOps|lanesOps|eventsOps  optional overrides; when
 *                   absent start() builds each exactly as main() does today
 */
export function makeWatcher({
  config,
  paths,
  logsDir,
  watchDir,
  log,
  pid = process.pid,
  isPidAlive = pidAlive,
  now = () => Date.now(),
  spawnFn = spawn,
  createLog = createWriteStream,
  exit = (code) => process.exit(code),
  lockOps: injectedLockOps,
  loopOps: injectedLoopOps,
  deployOps: injectedDeployOps,
  lanesOps: injectedLanesOps,
  eventsOps: injectedEventsOps,
}) {
  let watcherStartedAt = null;
  let debounceUntil = null;
  let child = null; // currently running tick, if any
  let lastBadSentinel = null; // log unparsable sentinel once per content change
  let lastSkipKey = null; // dedupe SKIP logs per episode (AS-13 #4)
  let loopWaitLogged = false; // one LOOP-WAIT line per deploy wait, not one per poll
  // AS-84: resolves when the CURRENT tick's settle() has finished — the handle
  // shutdown() waits on so a SIGTERMed tick still writes tick_ended, releases
  // its lock and folds into the loop (AS-82 F3). Null whenever no tick is in
  // flight; armed by fire(), resolved and cleared by settle().
  let settled = null;

  // Built by start(), in today's order. fire()/poll() reference them the same
  // way main() did; the forward reference is a `let` here instead of a TDZ
  // const, and is assigned before the first poll() exactly as before.
  let lockOps = null;
  let acquireLock = null;
  let releaseLock = null;
  let readLock = null;
  let loopOps = null;
  let deployOps = null;
  let lanesOps = null;
  let eventsOps = null;
  let interval = null;
  let deployInterval = null;
  let lanesInterval = null;
  let eventsInterval = null;

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

  // AS-75: the loop moved to the exported pruneLogs (which also covers
  // deploy-*.log, on the same retention) so it is under test rather than
  // stranded inside main(); this stays as the fire-time call site.
  function pruneTickLogs() {
    pruneLogs(logsDir, now() - config.tickLogRetentionDays * 24 * 60 * 60 * 1000);
  }

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
      JSON.stringify({ messageId: sentinel.messageId, firedAt: new Date(now()).toISOString() })
    );
    renameSync(paths.highwater + '.tmp', paths.highwater);
    // AS-100: the tick's own record, immediately after the highwater write —
    // the same instant the tick becomes a fact for every other reader.
    eventsOps.tickStarted({
      source: 'watcher',
      pid,
      messageId: sentinel.messageId,
      loopTick: loopOps.nextTick() - 1,
    });
    pruneTickLogs();

    const stamp = new Date(now()).toISOString().replaceAll(':', '-');
    const tickLogPath = join(logsDir, `tick-${stamp}.log`);
    const tickLog = createLog(tickLogPath, { flags: 'a' });
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
    // AS-84: armed before the spawn, so there is no instant where a child
    // exists that shutdown() cannot wait for. Per-fire, like the timers below.
    let resolveSettled;
    const thisSettled = new Promise((ok) => {
      resolveSettled = ok;
    });
    settled = thisSettled;

    const proc = spawnFn(
      config.claudeBin,
      tickArgv(pid, nonce, config.permissionMode, rules ?? undefined),
      {
        cwd: config.repoRoot,
        env: tickChildEnv(process.env, pid, nonce),
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
      const headAfter = headOf(config.repoRoot);
      // AS-100, after releaseLock() and before loopOps.settle(): this is the
      // only code that knows timedOut/code/signal, and it runs after the child
      // has exited, so anything still open belongs to a tick that is over.
      eventsOps.tickEnded({ code, signal, timedOut, headBefore, headAfter });
      loopOps.settle({ code, signal, timedOut, headBefore, headAfter });
      // AS-84, last: a shutdown waiting on this tick may exit the process the
      // moment this resolves, so everything above must already have happened.
      if (settled === thisSettled) settled = null;
      resolveSettled();
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
        pid,
        startedAt: watcherStartedAt,
        now: new Date(now()).toISOString(),
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
      now: now(),
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

  /**
   * The last thing shutdown() does, on both paths: reap anything the grace did
   * not, drop the lock IF it is ours, remove the pid marker, exit 0.
   *
   * `dying` is the child this shutdown SIGTERMed, or null. `child === dying`
   * means settle() never ran for it — it is still up, and the grace is over.
   */
  function finish(dying) {
    if (dying && child === dying) {
      log('STOP grace expired');
      dying.kill('SIGKILL');
    }
    // AS-84: source-checked since this task, so this is a no-op unless the file
    // is our own `source:'watcher'` lock. A deploy's lock is released by the
    // deploy, in its own `finally`, after abort() above waited for it.
    releaseLock();
    try {
      unlinkSync(paths.pid);
    } catch {
      /* already gone */
    }
    exit(0);
  }

  /**
   * AS-84: shutdown owns BOTH children. It SIGTERMs the tick child and the
   * deploy child, then waits — bounded by config.shutdownGraceS — for each to
   * settle itself: the tick through settle() (lock release, tick_ended, loop
   * fold; AS-82 F3), the deploy through performDeploy's own finally (abort
   * recorded, its own lock released; AS-75 F5). Before this, SIGTERM killed the
   * tick and exited synchronously — the tick never settled and AS-100's sweep
   * later closed it as `unclosed`, and the compose child was orphaned with its
   * lock unlinked by a process that did not own it.
   *
   * Returns a promise. With nothing in flight it finishes synchronously first,
   * exactly as it did before, and the promise is incidental.
   */
  /**
   * AS-84 (F6), the suspenders: the deploy interval's callback, named so the
   * suite can drive the wiring itself rather than a copy of it. evaluate()
   * already catches; this catches the case evaluate() cannot — a rejection from
   * an injected or future collaborator ABOVE that try/catch — because an
   * unhandled rejection in a setInterval callback ends the watcher process.
   */
  function deployPoll() {
    return deployOps
      .evaluate({ busy: Boolean(child) })
      .catch((err) => log(`ERROR deploy poll rejected: ${err.message}`));
  }

  function shutdown(signal) {
    log(`STOP ${signal}`);
    clearInterval(interval);
    clearInterval(deployInterval);
    clearInterval(lanesInterval);
    clearInterval(eventsInterval);

    const waits = [];
    const dying = child;
    if (dying) {
      log('STOP terminating in-flight tick');
      dying.kill('SIGTERM');
      if (settled) waits.push(settled);
    }
    if (deployOps && deployOps.isDeploying()) {
      log('STOP aborting in-flight deploy');
      waits.push(deployOps.abort('SIGTERM'));
    }
    if (waits.length === 0) return finish(dying);

    // launchd SIGKILLs us 20s after SIGTERM (KeepAlive:true, no ExitTimeOut),
    // so the wait is a bound, never an open-ended one: whatever has not settled
    // by then is killed and we exit 0 on our own terms.
    let graceTimer = null;
    const grace = new Promise((ok) => {
      graceTimer = setTimeout(ok, (config.shutdownGraceS ?? DEFAULTS.shutdownGraceS) * 1000);
    });
    return Promise.race([Promise.all(waits), grace]).then(() => {
      clearTimeout(graceTimer);
      return finish(dying);
    });
  }

  /** Everything main() did after the log closure, in exactly that order. */
  function start() {
    // Single instance: refuse to start beside a live watcher (launchd holds the
    // supervised one; this guards the "ran it manually too" case).
    // Known + accepted (AS-13 #5): the read-then-write below races two manual
    // watchers started in the same instant — launchd owns the supervised
    // instance and the fire-time wx lock bounds the damage to log noise.
    const existingPid = readJson(paths.pid);
    if (existingPid && isPidAlive(existingPid.pid) && existingPid.pid !== pid) {
      log(`FATAL another watcher is alive (pid ${existingPid.pid}); exiting`);
      exit(1);
      return;
    }
    // AS-27: startedAt is captured once and echoed by every later heartbeat, so
    // the file always answers both "since when" and "as of when". Deliberately
    // NOT guarded: if we cannot write this at startup the single-instance marker
    // does not exist, and failing loudly beats running unmarked.
    watcherStartedAt = new Date(now()).toISOString();
    writeWatcherPid({ path: paths.pid, pid, startedAt: watcherStartedAt, now: watcherStartedAt });

    lockOps =
      injectedLockOps ??
      makeLockOps({
        lockPath: paths.lock,
        staleMs: config.lockStaleMin * 60 * 1000,
        log,
        pid,
        isPidAlive,
      });
    ({ acquireLock, releaseLock, readLock } = lockOps);

    // AS-95: the loop state machine (counters, mirror file, resume policy, stop
    // paths). Everything it touches is passed in here and nowhere else, so the
    // wiring stays exactly the lines below and the policies are unit-testable.
    loopOps =
      injectedLoopOps ??
      makeLoopOps({
        loadBoard: () => readBoard(join(config.repoRoot, '.lattice', 'tasks')),
        loadSentinel: readSentinel,
        loadHighwater: () => readJson(paths.highwater),
        loadLock: () => readJson(paths.lock),
        loadState: () => readJson(paths.loopState),
        saveState: (body) => defaultWriteState(paths.loopState, body),
        log,
        now,
        resumeGraceMs: config.tickTimeoutMin * 60 * 1000,
      });

    // AS-75 deploy poll. Everything it does lives in makeDeployOps (exported,
    // unit-tested); these six lines are the entire unguarded wiring, and they are
    // enumerated in the implementation report so a reviewer can check the claim
    // against the diff rather than re-derive it. AS-84 replaced the `void` at
    // the call site — and the argument beside it that every branch inside
    // evaluate() handled its own failure — with two real guards: evaluate()
    // catches (the belt) and deployPoll() catches (the suspenders, below).
    deployOps =
      injectedDeployOps ??
      makeDeployOps({
        repoRoot: config.repoRoot,
        appDir: join(config.repoRoot, 'apps', 'chat'),
        watchDir,
        logsDir,
        statePath: paths.deployState,
        lockPath: paths.lock,
        lockStaleMs: config.lockStaleMin * 60 * 1000,
        cooldownMs: config.deployCooldownMin * 60 * 1000,
        deployTimeoutMs: config.deployTimeoutMin * 60 * 1000,
        retentionMs: config.tickLogRetentionDays * 24 * 60 * 60 * 1000,
        chatUrl: config.chatUrl,
        log,
        now,
        pid,
        isPidAlive,
      });
    log(`DEPLOY-POLL every ${config.deployPollS}s (docker ${deployOps.dockerBin ?? `unresolved: ${deployOps.dockerReason}`}, git ${deployOps.gitBin}, watcher source ${deployOps.baselineDigest})`);
    deployInterval = setInterval(deployPoll, config.deployPollS * 1000);
    deployInterval.unref();

    // AS-99 lanes poll. Everything it does lives in makeLanesOps (exported,
    // unit-tested); these six lines are the entire unguarded wiring. NOT gated on
    // `child`: a tick running is exactly when lanes move, and every call it makes
    // is read-only (the status call carries --no-optional-locks so it cannot even
    // take an index lock in a worktree an employee is committing in).
    lanesOps =
      injectedLanesOps ??
      makeLanesOps({
        repoRoot: config.repoRoot,
        statePath: paths.worktrees,
        gitBin: deployOps.gitBin,
        log,
        now,
      });
    log(`LANES-POLL every ${config.lanesPollS}s (git ${lanesOps.gitBin}) -> ${paths.worktrees}`);
    lanesInterval = setInterval(() => void lanesOps.evaluate(), config.lanesPollS * 1000);
    lanesInterval.unref();
    void lanesOps.evaluate(); // first snapshot now, not 15s from now

    // AS-100 company events. Everything it does lives in makeEventsOps
    // (exported, unit-tested); these lines are the entire unguarded wiring.
    // lockIsBusy comes from deployOps so "a tick is running" has one definition.
    eventsOps =
      injectedEventsOps ??
      makeEventsOps({
        streamPath: paths.events,
        tickTimeoutMs: config.tickTimeoutMin * 60 * 1000,
        lockBusy: deployOps.lockIsBusy,
        isBusy: () => Boolean(child),
        log,
        now,
      });
    log(`EVENTS-SWEEP every ${config.eventsSweepS}s (tick box ${config.tickTimeoutMin}min) -> ${paths.events}`);
    eventsInterval = setInterval(() => eventsOps.sweep(), config.eventsSweepS * 1000);
    eventsInterval.unref();

    log(
      `START watcher pid ${pid} repo ${config.repoRoot} ` +
        `(poll ${config.pollS}s, debounce ${config.debounceS}s, timeout ${config.tickTimeoutMin}min, ` +
        `stale ${config.lockStaleMin}min, mode ${config.permissionMode})`
    );
    loopOps.resume(); // AS-95: re-enter a loop the previous process was running
    interval = setInterval(poll, config.pollS * 1000);
    poll(); // immediate startup pass: missed-while-down recovery (plan §4)
  }

  return {
    start,
    poll,
    fire,
    deployPoll, // AS-84: the interval's own callback, for the F6 guard's test
    shutdown,
    readSentinel,
    hasChild: () => child !== null,
    /** The ops start() built, for assertions. Null before start(). */
    ops: () => ({ lock: lockOps, loop: loopOps, deploy: deployOps, lanes: lanesOps, events: eventsOps }),
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
    worktrees: join(dataDir, 'worktrees.json'), // AS-99
    events: join(dataDir, 'events', 'company.jsonl'), // AS-100
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

  const watcher = makeWatcher({
    config,
    paths,
    logsDir,
    watchDir: dirname(fileURLToPath(import.meta.url)),
    log,
  });
  watcher.start();
  // AS-84: shutdown() is async now (it waits for the tick child and the deploy
  // child it just SIGTERMed, bounded by ADVANCE_SHUTDOWN_GRACE_S) and ends in
  // process.exit(0) on every path, so main ignores the promise exactly as it
  // ignores the deploy poll's.
  process.on('SIGTERM', () => void watcher.shutdown('SIGTERM'));
  process.on('SIGINT', () => void watcher.shutdown('SIGINT'));
}

// Execute only when run directly (never on `import { decide } ...` in tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
