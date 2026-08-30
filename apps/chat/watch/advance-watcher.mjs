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
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- configuration (env-overridable; defaults per plan §4) ------------------

export const DEFAULTS = Object.freeze({
  pollS: 5, // sentinel poll interval
  debounceS: 15, // trailing debounce window (board band: 10–30s)
  tickTimeoutMin: 30, // hard tick timeout: SIGTERM, 15s grace, SIGKILL
  lockStaleMin: 45, // lock age staleness (> tick timeout, deliberately)
  tickLogRetentionDays: 14, // prune tick-*.log older than this at each fire
  permissionMode: 'acceptEdits',
  claudeBin: 'claude',
});

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

// Exact child env for a spawned tick — per-variable reasons documented at the
// spawn site in fire(). Exported so the test suite pins the set: any future
// narrowing or widening must change this function AND its test, deliberately.
export function tickChildEnv(env = process.env, watcherPid = process.pid) {
  return {
    PATH: env.PATH,
    HOME: env.HOME,
    USER: env.USER, // AS-14: macOS Keychain auth needs the user identity
    LOGNAME: env.LOGNAME,
    // AS-15: parent marker — lets the spawned tick's advance.md step 0
    // recognize the watcher's own advance.lock (source:"watcher", this pid)
    // as its own and proceed instead of self-cancelling as "lock held".
    ADVANCE_TICK_PARENT: `watcher:${watcherPid}`,
  };
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
   */
  function acquireLock() {
    const body = JSON.stringify({ pid, startedAt: new Date().toISOString(), source: 'watcher' });
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
  writeFileSync(paths.pid, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  let debounceUntil = null;
  let child = null; // currently running tick, if any
  let lastBadSentinel = null; // log unparsable sentinel once per content change
  let lastSkipKey = null; // dedupe SKIP logs per episode (AS-13 #4)

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

  function pruneTickLogs() {
    const cutoff = Date.now() - config.tickLogRetentionDays * 24 * 60 * 60 * 1000;
    try {
      for (const name of readdirSync(logsDir)) {
        if (!name.startsWith('tick-') || !name.endsWith('.log')) continue;
        const full = join(logsDir, name);
        if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
      }
    } catch {
      /* pruning is best-effort */
    }
  }

  function fire(sentinel) {
    if (!acquireLock()) {
      log(`SKIP fire aborted: lock acquisition failed (messageId ${sentinel.messageId})`);
      return;
    }
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
    //   ADVANCE_TICK_PARENT — "watcher:<this watcher's pid>". Advance.md
    //             step 0 matches it against advance.lock (source "watcher" +
    //             same pid) so a watcher-fired tick recognizes its parent's
    //             lock as its own instead of no-oping on it; the watcher, not
    //             the tick, releases that lock in settle() (AS-15).
    // AS-13 #3: timers and handlers close over this fire's own `proc`, never
    // the mutable module-level `child` — a timed-out tick's stray SIGKILL
    // timer must not be able to kill a successor tick. `child` remains only
    // the poll()/shutdown() gate, nulled iff it still points at this proc.
    const proc = spawn(
      config.claudeBin,
      ['-p', '/advance', '--permission-mode', config.permissionMode, '--output-format', 'text'],
      {
        cwd: config.repoRoot,
        env: tickChildEnv(process.env, process.pid),
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

    function settle() {
      clearTimeout(termTimer);
      if (killTimer !== null) clearTimeout(killTimer);
      if (child === proc) child = null;
      releaseLock();
    }
    proc.on('error', (err) => {
      if (!tickLog.writableEnded) tickLog.end(`\n[watcher] spawn error: ${err.message}\n`);
      log(`ERROR tick spawn failed: ${err.message} (is '${config.claudeBin}' on PATH?)`);
      settle();
    });
    proc.on('exit', (code, signal) => {
      if (!tickLog.writableEnded) tickLog.end();
      log(`EXIT tick ${timedOut ? 'TIMEOUT ' : ''}code=${code} signal=${signal ?? 'none'}`);
      settle();
    });
  }

  function poll() {
    if (child) return; // our own tick is running; its lock covers this window
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
      fire(sentinel);
    }
  }

  log(
    `START watcher pid ${process.pid} repo ${config.repoRoot} ` +
      `(poll ${config.pollS}s, debounce ${config.debounceS}s, timeout ${config.tickTimeoutMin}min, ` +
      `stale ${config.lockStaleMin}min, mode ${config.permissionMode})`
  );
  const interval = setInterval(poll, config.pollS * 1000);
  poll(); // immediate startup pass: missed-while-down recovery (plan §4)

  function shutdown(signal) {
    log(`STOP ${signal}`);
    clearInterval(interval);
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
