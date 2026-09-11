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

/** AS-75: why the live build is behind master, or why we cannot tell — in the
 *  board's terms, naming the remedy wherever there is one. Same shape and same
 *  house style as WATCHER_REASONS above: no bare enum ever reaches the UI.
 *
 *  The first block is what the watcher itself decided (deploy-state.json's
 *  `reason`); the second is what the SERVER concluded about that file. */
const BUILD_REASONS = {
  'stale-build': 'the watcher is about to rebuild it',
  cooldown: 'the last rebuild of this version failed and the watcher is waiting before retrying — see apps/chat/data/logs/deploy-*.log',
  busy: 'a tick is running, so the watcher is holding the rebuild until it finishes',
  'inputs-dirty': 'master has uncommitted changes under apps/chat, and the watcher only ever deploys committed code',
  'no-git': 'the watcher cannot read the git tree to work out what master contains',
  'no-docker': 'the watcher cannot find the docker binary — set ADVANCE_DOCKER_BIN in the launchd plist (apps/chat/watch/README.md)',
  // AS-84: the deploy poll threw and was caught rather than taking the watcher
  // down with it. The watcher is alive and will poll again; the log says why.
  error: 'the watcher\'s deploy poll failed with an error — see apps/chat/data/logs/advance-watcher.log',
  current: 'the running build matches master',
  'no-state': 'the watcher has not written a deploy report yet — it may be running pre-AS-75 code, in which case restarting it corrects this',
  'unreadable-state': "the watcher's deploy report is unreadable",
  'stale-state': "the watcher's deploy report has stopped being updated — the host may be asleep or the watcher crashed",
  'no-watcher': 'nothing is watching, so nothing will deploy — a board message will not fire a tick either',
  'unknown-build': 'this container was built by hand without a build id, so it cannot say which version it is running',
};

/** The one build sentence, or '' when the running build matches master —
 *  silence is the good case and the sidebar does not need to say so. */
function buildSentence(build) {
  if (!build || typeof build !== 'object' || Array.isArray(build)) return '';
  // `current` is the tri-state the server promises. Anything else — an absent
  // key from a pre-AS-75 server, a garbled payload — is not a third opinion to
  // render, it is no opinion at all, and the sidebar stays quiet.
  if (build.current !== true && build.current !== false && build.current !== null) return '';
  const why = BUILD_REASONS[build.reason] || `reason: ${build.reason ?? 'unknown'}`;
  if (build.current === true) return '';
  if (build.current === false) {
    return `Live build is behind master (running ${build.id ?? 'an unknown build'}, master ${build.desiredId ?? 'unknown'}) — ${why}.`;
  }
  return `Deploy freshness unknown: ${why}.`;
}

/** AS-95: why the last watcher loop stopped, in the board's terms. The enum is
 *  shouldContinue()'s `reason`; as with WATCHER_REASONS above, no bare enum
 *  reaches the UI. An unknown reason falls back to the raw string rather than
 *  to silence — a stop the sidebar cannot name is still a stop worth showing. */
const LOOP_STOP_REASONS = {
  dry: 'nothing was left to do',
  'no-progress': 'two ticks in a row ended without a commit on master',
  'cap-hit': 'the safety cap was reached',
  'tick-failed-twice': 'two ticks in a row failed or hit the tick timeout',
  'lock-unavailable': 'another tick held the advance lock for an hour, so the loop stopped rather than go on waiting',
  error: 'the watcher hit an unexpected error while evaluating the loop',
};

/** The tone the sidebar dot renders. AS-95's `watcher-loop` is a fifth STATE
 *  but not a fifth colour: it is a loop, and the green loop dot is the honest
 *  paint for it. Mapping here (rather than adding a .loop-dot--watcher-loop
 *  rule) keeps the new state from silently rendering an unstyled, invisible dot
 *  if the CSS and the derivation ever ship in different releases. */
function toneFor(state) {
  return state === 'watcher-loop' ? 'loop' : state;
}

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
    case 'watcher-loop': {
      // The tick number comes from the lock the running tick wrote when it can
      // (it is the tick being reported), and from the mirror file otherwise.
      const ticks = (status.tick && Number.isInteger(status.tick.loopTicks) ? status.tick.loopTicks : null) ??
        (status.loop && Number.isInteger(status.loop.ticks) ? status.loop.ticks : null);
      label = ticks === null ? 'Loop active · watcher' : `Loop active · watcher, tick ${ticks}`;
      break;
    }
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
      `${status.state === 'loop' || status.state === 'watcher-loop' ? 'Loop tick' : 'Tick'} from ${status.tick.source || 'unknown source'}` +
        ` (pid ${status.tick.pid ?? '?'}) started ${fmtAge(ageSince(status.tick.startedAt, nowMs))} ago.`
    );
  } else if (status.state === 'watcher-loop') {
    // AS-95 F5: the gap between two loop ticks. The company has not stopped —
    // saying so is the whole point of showing the loop rather than the lock.
    parts.push('Between loop ticks: no tick holds the lock this instant, and the next one fires within a poll.');
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
        `${fmtAge(ageSince(status.lastTick.endedAt, nowMs))} ago.` +
        // A session's /loop still reads as idle in the gap (nothing mirrors its
        // state), so C5's explanation stays — but not on a watcher loop, which
        // since AS-95 says what it is doing in the line above.
        (status.state === 'watcher-loop'
          ? ''
          : ' A loop releases the lock between ticks, so a running loop reads as idle in that gap.')
    );
  }

  // AS-95: why the company stopped. Shown only when no watcher loop is running
  // — while one is, the interesting fact is the loop, not its predecessor — and
  // it is the sentence the board reads to tell "dry" (nothing left to do) from
  // "no-progress"/"cap-hit" (stopped in spite of work remaining).
  if (status.state !== 'watcher-loop' && status.loop && !status.loop.active && status.loop.lastLoop && status.loop.lastLoop.reason) {
    const { reason, ticks, stoppedAt } = status.loop.lastLoop;
    const why = LOOP_STOP_REASONS[reason] || `reason: ${reason}`;
    const after = Number.isInteger(ticks) ? ` after ${ticks} tick${ticks === 1 ? '' : 's'}` : '';
    const ago = stoppedAt ? `, ${fmtAge(ageSince(stoppedAt, nowMs))} ago` : '';
    parts.push(`Last loop stopped${after}${ago}: ${why}.`);
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

  // AS-75: exactly one sentence about the deploy, and none at all when the
  // running build is master's. It goes last: it is about the code, not about
  // whether anything is running right now.
  const build = buildSentence(status.build);
  if (build) parts.push(build);

  return { tone: toneFor(status.state), label, detail: parts.join(' ') };
}
