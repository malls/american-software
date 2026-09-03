// loop-status.js — AS-27: turn /api/loop-status into the three strings the
// sidebar indicator renders. Pure and DOM-free, so it imports from the browser
// (app.js) and from node:test alike — the same pattern as live.js and
// url-state.js. app.js does DOM only; every word the board reads is decided
// here, where it can be asserted.
//
// It returns strings, never markup: the caller assigns them through
// textContent and the title attribute.

/** Coarse, human age. Seconds under a minute, then minutes, then hours —
 *  precision the board would act on, nothing finer. */
function fmtAge(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 360) / 10} h`;
}

/** Age of an ISO timestamp against the client's clock, in seconds. Recomputed
 *  locally (rather than trusting the server's ageS) so a detail line that sits
 *  open for a minute stays honest between pushes. */
function ageSince(iso, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return NaN;
  return (nowMs - t) / 1000;
}

/** Why the watcher is not listening, in the board's terms — including what to
 *  do about it. R3: on the day AS-27 ships the running watcher predates the
 *  heartbeat, so 'no-heartbeat' is the case he will actually see first. */
const WATCHER_REASONS = {
  'no-pidfile': 'no watcher pid file — the host watcher is not running',
  'no-heartbeat':
    'the watcher pid file carries no heartbeat, so this watcher is running pre-AS-27 code — ' +
    'restart it (launchctl bootout, then bootstrap; see apps/chat/watch/README.md) and the indicator corrects itself',
  'bad-heartbeat': 'the watcher pid file has an unreadable heartbeat timestamp',
  unparsable: 'the watcher pid file is unreadable',
  'stale-heartbeat': 'the watcher heartbeat has stopped — the host may be asleep or the watcher crashed',
};

/**
 * @param {object|null} status  the /api/loop-status payload's `status`, or
 *                              null when the fetch failed
 * @param {number} nowMs        client clock, so age text can refresh locally
 * @returns {{ tone: 'loop'|'tick'|'idle'|'off', label: string, detail: string }}
 */
export function describeLoopStatus(status, nowMs = Date.now()) {
  if (!status || typeof status !== 'object' || typeof status.state !== 'string') {
    return {
      tone: 'off',
      label: 'Status unavailable',
      detail: 'The server did not answer /api/loop-status. This says nothing about whether a tick is running.',
    };
  }

  const parts = [];
  let label;
  switch (status.state) {
    case 'loop':
      label = 'Loop active';
      break;
    case 'tick':
      label = `Tick in flight · ${status.tick && status.tick.source ? status.tick.source : 'unknown source'}`;
      break;
    case 'idle':
      label = 'Idle · watcher listening';
      break;
    default:
      label = 'Off · no watcher';
      break;
  }

  if (status.tick) {
    parts.push(
      `${status.state === 'loop' ? 'Loop tick' : 'Tick'} from ${status.tick.source || 'unknown source'}` +
        ` (pid ${status.tick.pid ?? '?'}) started ${fmtAge(ageSince(status.tick.startedAt, nowMs))} ago.`
    );
  } else if (status.state === 'idle') {
    parts.push('No tick is running; a board message fires one.');
  } else if (status.state === 'off') {
    parts.push('No tick is running, and nothing is watching for one — a board message will not fire a tick.');
  }

  // C5, said out loud rather than papered over: a /loop session releases the
  // lock between its ticks, so between two loop ticks this indicator reads
  // idle. lastTick is what makes that window legible; it is a best-effort
  // server-side memory, not a claim that the loop has stopped.
  if (!status.tick && status.lastTick && status.lastTick.endedAt) {
    parts.push(
      `Last tick: ${status.lastTick.source || 'unknown source'}, ended ` +
        `${fmtAge(ageSince(status.lastTick.endedAt, nowMs))} ago. ` +
        'A loop releases the lock between ticks, so a running loop reads as idle in that gap.'
    );
  }

  if (status.staleLock) {
    const age = status.staleLock.startedAt ? `${fmtAge(ageSince(status.staleLock.startedAt, nowMs))} old` : 'undatable';
    parts.push(
      `A stale lock from ${status.staleLock.source || 'an unknown source'} (${age}, ` +
        `${status.staleLock.reason}) is present and will be stolen by the next tick.`
    );
  }

  if (status.watcher) {
    if (status.watcher.listening) {
      parts.push(`Watcher heartbeat ${fmtAge(ageSince(status.watcher.heartbeatAt, nowMs))} ago.`);
    } else {
      parts.push(`Watcher: ${WATCHER_REASONS[status.watcher.reason] || `not listening (${status.watcher.reason})`}.`);
    }
  }

  return { tone: status.state, label, detail: parts.join(' ') };
}
