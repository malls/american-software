// loop-status.js — AS-27: derive the advance-loop's state from the two files
// the watcher and the tick lock already write. Pure: no fs, no clocks, no
// process — the caller reads the files and supplies `nowMs`, so every case in
// test/loop-status.test.js is a fixture, not a race.
//
// THE ONE RULE. Lock freshness is decided by `isLockStale` imported from the
// watcher itself, never by a second comparison written here. The watcher is
// the authority on what "a tick is running" means (it is the thing that fires
// ticks); a copy of that rule in the server would drift the first time
// DEFAULTS.lockStaleMin moved, and the UI would then confidently disagree
// with the process it is reporting on.
//
// WHY pidAlive IS HARD-CODED TRUE (do not "fix" this). The server runs inside
// asc-chat-server-1; the pids in advance.lock and advance-watcher.pid are HOST
// pids in a different pid namespace. `process.kill(pid, 0)` from the container
// therefore answers a question about some unrelated container process, or
// nothing at all — it is not a weaker signal, it is a meaningless one. So the
// in-container staleness test is age-only, expressed as "tell isLockStale the
// pid is alive and let it judge on age". The host-side watcher still checks
// liveness for real; the two agree except in the window where a tick has been
// SIGKILLed and its lock has not yet aged out, in which case the UI shows a
// tick for up to lockStaleMin. That is a known, bounded over-report, and it is
// the honest reading of the evidence the container can actually see.
import { isLockStale } from '../watch/advance-watcher.mjs';

/**
 * How long a watcher heartbeat stays believable. 12 polls at the watcher's
 * DEFAULTS.pollS (5 s) cadence — wide enough that a slow host or a busy fs
 * never flickers the indicator, narrow enough that a crashed watcher is
 * reported within a minute. One place only; the watcher has no matching
 * constant because it never reads its own pid file for liveness.
 */
export const WATCHER_STALE_MS = 60_000;

/** Seconds, non-negative. A startedAt in the future (host clock skew) reads
 *  as 0 rather than as a negative age — the fresh/stale verdict is unaffected
 *  because it comes from isLockStale, not from this number. */
function ageSeconds(nowMs, whenMs) {
  return Math.max(0, Math.round((nowMs - whenMs) / 1000));
}

/** A parsed JSON value is usable as a record only if it is a plain object.
 *  `null`, arrays, numbers and strings all mean the file is not what we
 *  expect, which is the same operational fact as unparsable. */
function asRecord(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return { error: 'unparsable' };
  return value;
}

/**
 * The lock half. Returns { tick, staleLock } — exactly one of which is
 * non-null when a lock file is present, and both null when it is absent.
 *
 * The tick object is built field by field on purpose: `nonce` is the AS-16
 * anti-spoof token and must never reach a client. Spreading the lock would
 * ship it the first time the lock body grew a field.
 */
function deriveTick(lock, nowMs, lockStaleMs) {
  const rec = asRecord(lock);
  if (rec === null) return { tick: null, staleLock: null };

  const source = typeof rec.source === 'string' ? rec.source : null;
  const startedAt = typeof rec.startedAt === 'string' ? rec.startedAt : null;
  const pid = Number.isInteger(rec.pid) ? rec.pid : null;

  if (rec.error) {
    return { tick: null, staleLock: { source: null, startedAt: null, ageS: null, reason: 'unparsable' } };
  }
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) {
    // isLockStale would also call this stale (reason 'age'); the check is
    // ordered first only so the reason names the real defect. It can never
    // turn a stale lock fresh — nothing downstream of here re-decides.
    return { tick: null, staleLock: { source, startedAt, ageS: null, reason: 'bad-startedAt' } };
  }
  const ageS = ageSeconds(nowMs, startedMs);
  const staleness = isLockStale({ ...rec, pidAlive: true }, nowMs, lockStaleMs);
  if (staleness.stale) {
    return { tick: null, staleLock: { source, startedAt, ageS, reason: staleness.reason } };
  }
  return { tick: { source, pid, startedAt, ageS }, staleLock: null };
}

/** The watcher half: is the host watcher alive and polling? */
function deriveWatcher(watcher, nowMs, watcherStaleMs) {
  const absent = (reason) => ({ listening: false, heartbeatAt: null, ageS: null, reason });
  const rec = asRecord(watcher);
  if (rec === null) return absent('no-pidfile');
  if (rec.error) return absent('unparsable');
  const heartbeatAt = typeof rec.heartbeatAt === 'string' ? rec.heartbeatAt : null;
  // A pid file with no heartbeat is a watcher running PRE-AS-27 code. It may
  // well be listening — but nothing in the file says so, and inventing
  // "assume alive" here would make the indicator claim more than its evidence.
  // Restarting the watcher on the new code corrects it; the client detail text
  // names that restart.
  if (heartbeatAt === null) return absent('no-heartbeat');
  const beatMs = Date.parse(heartbeatAt);
  if (!Number.isFinite(beatMs)) return absent('bad-heartbeat');
  const ageS = ageSeconds(nowMs, beatMs);
  if (nowMs - beatMs > watcherStaleMs) {
    return { listening: false, heartbeatAt, ageS, reason: 'stale-heartbeat' };
  }
  return { listening: true, heartbeatAt, ageS };
}

/**
 * The four states the board asked about, derived from the two files.
 *
 *   loop  — a fresh lock whose source is "loop": a /loop /advance session is
 *           executing a tick right now.
 *   tick  — a fresh lock from any other source (watcher, manual).
 *   idle  — no fresh lock, watcher listening: the next board message fires.
 *   off   — no fresh lock, watcher not listening: nothing will fire.
 *
 * @param {object}  args
 * @param {object|null} args.lock          parsed advance.lock, null if absent,
 *                                         { error } if unreadable/unparsable
 * @param {object|null} args.watcher       parsed advance-watcher.pid, same convention
 * @param {number}  args.nowMs
 * @param {number}  args.lockStaleMs       DEFAULTS.lockStaleMin * 60_000, from the watcher
 * @param {number} [args.watcherStaleMs]   defaults to WATCHER_STALE_MS
 * @returns {{ state: 'loop'|'tick'|'idle'|'off',
 *             tick: null|{source,pid,startedAt,ageS},
 *             staleLock: null|{source,startedAt,ageS,reason},
 *             watcher: {listening,heartbeatAt,ageS,reason?},
 *             checkedAt: string }}
 */
export function deriveLoopStatus({ lock, watcher, nowMs, lockStaleMs, watcherStaleMs = WATCHER_STALE_MS }) {
  const { tick, staleLock } = deriveTick(lock, nowMs, lockStaleMs);
  const w = deriveWatcher(watcher, nowMs, watcherStaleMs);
  const state = tick ? (tick.source === 'loop' ? 'loop' : 'tick') : w.listening ? 'idle' : 'off';
  return { state, tick, staleLock, watcher: w, checkedAt: new Date(nowMs).toISOString() };
}
