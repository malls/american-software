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
  // AS-95: the loop marker the watcher spreads into the lock body at fire time.
  // `source` is deliberately still 'watcher' (the lock's acquire/release/stale
  // logic is byte-identical — AS-84 owns that question), so this extra field is
  // the ONLY way the lock itself says "this tick belongs to a loop". Read
  // defensively: a pre-AS-95 watcher writes no `loop` key at all.
  const loopTicks = rec.loop && Number.isInteger(rec.loop.ticks) ? rec.loop.ticks : null;

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
  return { tick: { source, pid, startedAt, ageS, loopTicks }, staleLock: null };
}

/**
 * AS-95: the loop half — what apps/chat/data/advance-loop.json says the host
 * watcher's loop is doing. Built field by field for the same reason the tick is
 * (never spread a file the watcher may grow), and every field is optional: a
 * watcher on pre-AS-95 code writes no such file at all, which is `null` here
 * and leaves the four AS-27 states exactly as they were.
 *
 * `lastLoop` deliberately survives `active:false` — WHY the last loop stopped
 * is the thing the board asked to be able to see, and it is only legible after
 * the loop has stopped.
 */
function deriveLoop(loopState) {
  const rec = asRecord(loopState);
  if (rec === null || rec.error) return null;
  const last = asRecord(rec.lastLoop);
  const lastLoop =
    last && !last.error
      ? {
          reason: typeof last.reason === 'string' ? last.reason : null,
          stoppedAt: typeof last.stoppedAt === 'string' ? last.stoppedAt : null,
          ticks: Number.isInteger(last.ticks) ? last.ticks : null,
        }
      : null;
  return {
    active: rec.active === true,
    ticks: Number.isInteger(rec.ticks) ? rec.ticks : 0,
    startedAt: typeof rec.startedAt === 'string' ? rec.startedAt : null,
    armedBy: rec.armedBy ?? null,
    lastLoop,
  };
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
 *   loop         — a fresh lock whose source is "loop": a /loop /advance session
 *                  is executing a tick right now.
 *   watcher-loop — AS-95: a fresh WATCHER lock that belongs to a watcher loop
 *                  (the board's message started a run of ticks). Distinguished
 *                  from `tick` because "one tick, then silence" and "tick 3 of a
 *                  run that continues until the company is dry" are different
 *                  facts about the company, and the board asked to see which.
 *   tick         — a fresh lock from any other source (watcher, manual).
 *   idle         — no fresh lock, watcher listening: the next board message fires.
 *   off          — no fresh lock, watcher not listening: nothing will fire.
 *
 * @param {object}  args
 * @param {object|null} args.lock          parsed advance.lock, null if absent,
 *                                         { error } if unreadable/unparsable
 * @param {object|null} args.watcher       parsed advance-watcher.pid, same convention
 * @param {object|null} [args.loopState]   parsed advance-loop.json, same convention
 * @param {number}  args.nowMs
 * @param {number}  args.lockStaleMs       DEFAULTS.lockStaleMin * 60_000, from the watcher
 * @param {number} [args.watcherStaleMs]   defaults to WATCHER_STALE_MS
 * @returns {{ state: 'loop'|'watcher-loop'|'tick'|'idle'|'off',
 *             tick: null|{source,pid,startedAt,ageS,loopTicks},
 *             loop: null|{active,ticks,startedAt,armedBy,lastLoop},
 *             staleLock: null|{source,startedAt,ageS,reason},
 *             watcher: {listening,heartbeatAt,ageS,reason?},
 *             checkedAt: string }}
 */
export function deriveLoopStatus({ lock, watcher, loopState = null, nowMs, lockStaleMs, watcherStaleMs = WATCHER_STALE_MS }) {
  const { tick, staleLock } = deriveTick(lock, nowMs, lockStaleMs);
  const w = deriveWatcher(watcher, nowMs, watcherStaleMs);
  const loop = deriveLoop(loopState);
  // Two independent witnesses, either of which is enough: the mirror file says a
  // loop is live, or the lock the running tick wrote carries the marker. Neither
  // alone is reliable — the file can be a heartbeat behind a just-fired tick,
  // and a pre-AS-95 lock has no marker — and requiring both would report a loop
  // as a bare tick whenever one of them lagged.
  const inWatcherLoop = tick !== null && tick.source === 'watcher' && ((loop !== null && loop.active) || tick.loopTicks !== null);
  const state = tick
    ? tick.source === 'loop'
      ? 'loop'
      : inWatcherLoop
        ? 'watcher-loop'
        : 'tick'
    : w.listening
      ? 'idle'
      : 'off';
  return { state, tick, loop, staleLock, watcher: w, checkedAt: new Date(nowMs).toISOString() };
}
