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
// apps/chat/test/watcher.test.js; all fs/spawn effects live in the thin shell
// at the bottom, which only runs when this file is executed directly.

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
  const existingPid = readJson(paths.pid);
  if (existingPid && pidAlive(existingPid.pid) && existingPid.pid !== process.pid) {
    log(`FATAL another watcher is alive (pid ${existingPid.pid}); exiting`);
    process.exit(1);
  }
  writeFileSync(paths.pid, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  let debounceUntil = null;
  let child = null; // currently running tick, if any
  let lastBadSentinel = null; // log unparsable sentinel once per content change

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

  function readLock() {
    const lock = readJson(paths.lock);
    if (!lock) return null;
    return { ...lock, pidAlive: pidAlive(lock.pid) };
  }

  /** O_EXCL acquire with one stale-steal retry. Returns true iff acquired. */
  function acquireLock() {
    const body = JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      source: 'watcher',
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        writeFileSync(paths.lock, body, { flag: 'wx' });
        return true;
      } catch (err) {
        if (err.code !== 'EEXIST') {
          log(`ERROR lock write failed: ${err.message}`);
          return false;
        }
        const held = readLock();
        const staleness = held
          ? isLockStale(held, Date.now(), config.lockStaleMin * 60 * 1000)
          : { stale: true, reason: 'unparsable' };
        if (!staleness.stale) return false; // fresh — raced someone; skip
        log(`STEAL stale lock (${staleness.reason}, pid ${held?.pid ?? '?'}) removed`);
        try {
          unlinkSync(paths.lock);
        } catch {
          /* raced the owner's own cleanup */
        }
      }
    }
    return false;
  }

  function releaseLock() {
    const held = readJson(paths.lock);
    if (held && held.pid === process.pid) {
      try {
        unlinkSync(paths.lock);
      } catch {
        /* already gone */
      }
    }
  }

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

    // Minimal, explicit child env: launchd's default env is thin; the plist
    // sets PATH to include node + claude. Nothing else exotic on purpose.
    child = spawn(
      config.claudeBin,
      ['-p', '/advance', '--permission-mode', config.permissionMode, '--output-format', 'text'],
      {
        cwd: config.repoRoot,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    child.stdout.pipe(tickLog, { end: false });
    child.stderr.pipe(tickLog, { end: false });

    let timedOut = false;
    const termTimer = setTimeout(() => {
      timedOut = true;
      log(`TIMEOUT tick exceeded ${config.tickTimeoutMin}min; SIGTERM`);
      child.kill('SIGTERM');
      setTimeout(() => child && child.kill('SIGKILL'), 15 * 1000).unref();
    }, config.tickTimeoutMin * 60 * 1000);
    termTimer.unref();

    child.on('error', (err) => {
      clearTimeout(termTimer);
      if (!tickLog.writableEnded) tickLog.end(`\n[watcher] spawn error: ${err.message}\n`);
      log(`ERROR tick spawn failed: ${err.message} (is '${config.claudeBin}' on PATH?)`);
      child = null;
      releaseLock();
    });
    child.on('exit', (code, signal) => {
      clearTimeout(termTimer);
      if (!tickLog.writableEnded) tickLog.end();
      log(`EXIT tick ${timedOut ? 'TIMEOUT ' : ''}code=${code} signal=${signal ?? 'none'}`);
      child = null;
      releaseLock();
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
    if (result.action === 'debounce') {
      log(`DEBOUNCE armed for messageId ${sentinel.messageId} (${config.debounceS}s)`);
    } else if (result.action === 'skip-locked') {
      log(`SKIP ${result.reason} (messageId ${sentinel.messageId})`);
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
