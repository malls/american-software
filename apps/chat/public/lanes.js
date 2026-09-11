// lanes.js — AS-99: every word the Lanes pane shows, decided here.
//
// Pure and DOM-free, the loop-status.js pattern: it returns strings (and small
// records of strings), never markup; app.js assigns them through textContent.
// Importable from the browser and from node:test alike, which is what lets the
// board-facing wording be asserted instead of eyeballed.
//
// House rule carried over from loop-status.js: NO BARE ENUM REACHES THE UI.
// Every reason code in lib/lanes.js has a sentence here, and the test asserts
// the two key sets are equal — a reason added without a sentence is a red test,
// not a mystery word in front of the board.

// It does NOT import lib/lanes.js for the enum: that module imports the
// watcher, which is node-only, and this file runs in a browser. The key set is
// restated below and test/lanes-label.test.js asserts the two are equal, which
// is the same trade the roster sidebar makes — the assertion is the link.

/** Coarse, human age — seconds, then minutes, then hours. Same precision (and
 *  the same reasoning) as loop-status.js: what the board would act on. */
function fmtAge(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 360) / 10} h`;
}

/** Age of an ISO timestamp against the client's clock, in seconds. Recomputed
 *  locally from `generatedAt` on the render timer (never from a file mtime,
 *  which the payload deliberately does not carry — plan Q1/AC-11). */
function ageSince(iso, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return NaN;
  return (nowMs - t) / 1000;
}

/** Why the lane list is degraded, in the board's terms, naming the remedy where
 *  there is one. Keys are lib/lanes.js's LANES_REASON_CODES, exactly. */
export const SNAPSHOT_REASONS = Object.freeze({
  ok: '',
  'stale-snapshot':
    'the host watcher has stopped refreshing this snapshot — the host may be asleep or the watcher crashed, ' +
    'so these lanes are the last thing it saw, not what is running now',
  'no-snapshot':
    'the host watcher has not written a worktree snapshot — it may be running pre-AS-99 code, in which case ' +
    'restarting it (launchctl kickstart; see apps/chat/watch/README.md) corrects this',
  'unreadable-snapshot': "the host watcher's worktree snapshot is unreadable",
  'git-error': 'the host watcher reached git and git refused, so it could enumerate no worktrees',
});

/** The pane's own sanity check, asserted in test/lanes-label.test.js: every
 *  reason the server may emit has a sentence, and no sentence is orphaned. */
export const SNAPSHOT_REASON_CODES = Object.freeze(Object.keys(SNAPSHOT_REASONS));

/** The reasons under which the lane list was NEVER MEASURED, as opposed to
 *  measured and short. `git-error` belongs here: the watcher reached git, git
 *  refused, and zero worktrees were enumerated — a refusal, not a count. A
 *  stale snapshot is NOT here: it is a real measurement, just an old one, which
 *  is why the badge keeps its count and only the caption ages (plan T6 M6
 *  probe). Flow 1a / AC-14: "nothing is running" and "we cannot see what is
 *  running" must never render the same. */
const UNMEASURED_REASONS = new Set(['no-snapshot', 'unreadable-snapshot', 'git-error']);

/** The sentence the pane shows when it has no cards to draw. Keyed off the
 *  REASON — never off the badge string, which is a rendering and cannot carry
 *  the distinction above. Only `ok` licenses a claim about what is in flight. */
export const EMPTY_STATES = Object.freeze({
  ok: 'No lanes in flight.',
  'stale-snapshot':
    'No lanes in the last snapshot — and that snapshot has stopped refreshing, so this is not necessarily what is running now.',
  'no-snapshot': 'No lane data to show.',
  'unreadable-snapshot': 'No lane data to show.',
  'git-error': 'No lane data to show.',
});

/** Same sanity check as SNAPSHOT_REASON_CODES, one table over. */
export const EMPTY_STATE_CODES = Object.freeze(Object.keys(EMPTY_STATES));

/** What the pane says when it has no reason code at all (the fetch failed). */
const NO_LANE_DATA = 'No lane data to show.';

/** AS-100. Why the LIVE STAGE SIGNAL is degraded, in the board's terms. Keys
 *  are lib/events.js's EVENTS_REASON_CODES, exactly — restated here for the
 *  same reason SNAPSHOT_REASONS is, and asserted equal in
 *  test/lanes-label.test.js. The git half of a lane renders regardless: a
 *  missing event stream degrades two fields, not the pane. */
export const EVENTS_REASONS = Object.freeze({
  ok: '',
  'no-stream':
    'the host watcher has written no company event stream — it may be running pre-AS-100 code, in which case ' +
    'restarting it (launchctl kickstart; see apps/chat/watch/README.md) corrects this',
  'unreadable-stream':
    "the company event stream is on disk but could not be read, so nothing here knows which stages are live",
  truncated:
    'the company event stream shrank underneath the server — it was rotated or rewritten — so anything before ' +
    'the cut is missing from this view until the server is restarted',
});

/** Same sanity check as SNAPSHOT_REASON_CODES, one table over (AC-18). */
export const EVENTS_REASON_CODE_LIST = Object.freeze(Object.keys(EVENTS_REASONS));

/** How a stage ENDED, in words — lib/events.js's STAGE_OUTCOMES, exactly. The
 *  two reconciler-only outcomes say who closed it and why, because "cut" and
 *  "unclosed" are the board's evidence that the tick procedure was or was not
 *  followed (plan T5). */
export const STAGE_OUTCOME_WORDS = Object.freeze({
  completed: 'completed',
  error: 'ended in error',
  cut_by_timeout: 'cut off when the tick hit its timeout',
  unclosed: 'left unclosed when the tick ended',
});

export const STAGE_OUTCOME_CODES = Object.freeze(Object.keys(STAGE_OUTCOME_WORDS));

/** How a sub-agent EXITED, in words — lib/events.js's SUBAGENT_EXITS, exactly.
 *  Separate table from the stage one on purpose: `ok` and `completed` are
 *  different enums that would silently merge if one table served both. */
export const SUBAGENT_EXIT_WORDS = Object.freeze({
  ok: 'finished',
  error: 'exited with an error',
  cut_by_timeout: 'cut off when the tick hit its timeout',
  unclosed: 'left unclosed when the tick ended',
});

export const SUBAGENT_EXIT_CODES = Object.freeze(Object.keys(SUBAGENT_EXIT_WORDS));

/** The outcomes that mean nobody closed this cleanly — the card tones them so
 *  the board can find them without reading every line. Not an error state. */
const ALERT_OUTCOMES = new Set(['error', 'cut_by_timeout', 'unclosed']);

/** What the two live slots say when the stream itself is missing (AC-18): the
 *  slot is not empty and not zero — it states which input is absent. */
const NO_STREAM_SLOT = 'no event stream';

/** ...and when the stream is fine but this lane has never emitted a stage. */
const NO_STAGE_EVENTS = 'no stage events yet';

/** A wall-clock stamp for "no signal since". UTC, and it says so: the board
 *  reads this next to a tick timeout that is itself measured in UTC, and a
 *  browser-local rendering of a server-side clock is how two people end up
 *  comparing different hours. */
function stampUTC(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'an unknown time';
  return `${new Date(t).toISOString().slice(11, 16)}Z`;
}

/** The stale-lane badge reasons, same rule: a sentence each, never the enum. */
export const STALE_REASONS = Object.freeze({
  'task-done': 'its task is done',
  'task-cancelled': 'its task was cancelled',
  merged: 'its branch is already merged into master',
});

/**
 * The sidebar badge and the pane's snapshot caption.
 *
 * @param {object|null} projection  the /api/lanes payload's `lanes`, or null
 *                                  when the fetch failed
 * @param {number} nowMs            client clock, so the age refreshes locally
 * @returns {{ badge: string, title: string, caption: string, stale: boolean,
 *             lanes: Array, reason: string|null, emptyText: string }}
 */
export function describeLanes(projection, nowMs = Date.now()) {
  // A dash, never a zero (AC-14): "0 lanes" is a measurement, and we have not
  // measured anything. Flow 1a — the board must be able to tell "nothing is
  // running" from "we cannot see what is running".
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return {
      badge: 'Lanes · –',
      title: 'The server did not answer /api/lanes. This says nothing about whether anything is running.',
      caption: 'Lane data unavailable — the server did not answer.',
      stale: true,
      lanes: [],
      reason: null,
      emptyText: NO_LANE_DATA,
      eventsReason: 'unreadable-stream',
      eventsCaption: '',
    };
  }

  const snap = projection.snapshot && typeof projection.snapshot === 'object' ? projection.snapshot : {};
  const reason = typeof snap.reason === 'string' ? snap.reason : 'unreadable-snapshot';
  const why = SNAPSHOT_REASONS[reason] ?? `reason: ${reason}`;
  const lanes = Array.isArray(projection.lanes) ? projection.lanes : null;

  // AS-100: the event stream is an INDEPENDENT input from the git snapshot —
  // either half can be degraded while the other is fine, so it gets its own
  // reason and its own caption line rather than folding into the snapshot's.
  const evs = projection.events && typeof projection.events === 'object' ? projection.events : {};
  const eventsReason = typeof evs.reason === 'string' && evs.reason in EVENTS_REASONS ? evs.reason : 'unreadable-stream';
  const eventsWhy = EVENTS_REASONS[eventsReason];
  const eventsCaption = eventsReason === 'ok' ? '' : `Live stage signal unavailable — ${eventsWhy}.`;

  // lanes === null is the server saying "a partial list must not masquerade as
  // the list" — so the badge says the same thing the caption does. An empty
  // list under an UNMEASURED reason is the same situation wearing a `[]`:
  // git-error carries a real generatedAt and an empty array, and rendering that
  // as `Lanes · 0` / "No lanes in flight." asserts a measurement nobody took.
  if (lanes === null || UNMEASURED_REASONS.has(reason)) {
    const ageS = ageSince(snap.generatedAt, nowMs);
    // A failed poll is still a fact with a timestamp: when the watcher wrote
    // one, say how old it is, because that tells the board the watcher is alive
    // and git is what failed.
    const when = Number.isFinite(ageS) ? ` Snapshot ${fmtAge(ageS)} old.` : '';
    return {
      badge: 'Lanes · –',
      title: why || 'Lane data unavailable.',
      caption: `Lane data unavailable — ${why || `reason: ${reason}`}.${when}`,
      stale: true,
      lanes: [],
      reason,
      emptyText: EMPTY_STATES[reason] ?? NO_LANE_DATA,
      eventsReason,
      eventsCaption,
    };
  }

  const count = Number.isInteger(projection.count) ? projection.count : lanes.length;
  const age = fmtAge(ageSince(snap.generatedAt, nowMs));
  const caption =
    reason === 'ok'
      ? `Snapshot ${age} old.`
      : `Snapshot ${age} old — ${why || `reason: ${reason}`}.`;

  return {
    badge: `Lanes · ${count}`,
    title: caption,
    caption,
    stale: snap.stale === true || reason !== 'ok',
    lanes,
    reason,
    emptyText: EMPTY_STATES[reason] ?? NO_LANE_DATA,
    eventsReason,
    eventsCaption,
  };
}

/** The tick-level liveness line at the top of the pane (Jonah §3). It is
 *  whole-company, not per-lane, and says so — the one honesty requirement the
 *  north-star comment states outright. Sourced from /api/loop-status, which the
 *  sidebar already holds, so no second request. */
export function describeTickLine(status, nowMs = Date.now()) {
  const caption = '(whole company, not per-lane)';
  if (!status || typeof status !== 'object' || typeof status.state !== 'string') {
    return { text: 'Tick state unknown.', caption };
  }
  if (status.tick) {
    const started = fmtAge(ageSince(status.tick.startedAt, nowMs));
    return {
      text: `Tick running for ${started} · ${status.tick.source || 'unknown source'} (pid ${status.tick.pid ?? '?'})`,
      caption,
    };
  }
  return { text: 'No tick running.', caption };
}

/**
 * One lane card's words. Returns a flat record of strings — the eight durable
 * fields, the two AS-100 placeholder slots, and the AS-103 transient line's
 * state — so app.js does DOM only.
 */
export function describeLane(lane, nowMs = Date.now(), eventsReason = 'ok') {
  const task = lane && lane.task ? lane.task : null;
  const wt = lane && lane.worktree ? lane.worktree : null;
  const emp = lane && lane.employee ? lane.employee : {};

  // 1. Task. An unjoined worktree still gets a card, with the branch in the
  //    task slot — LANES-UNKNOWN-TASK. Never filtered out (AC-7).
  const shortId = task && task.shortId ? task.shortId : null;
  const title = task && task.title ? task.title : '';
  const taskText = shortId || (wt && wt.branch) || (wt && wt.relPath) || 'unknown lane';
  const unknownTask = !shortId;

  // 2. Stage.
  const stage = task && task.status ? task.status : 'no task joined';

  // 3. Employee — two fields, never merged (AC-10). The git author is shown
  //    labelled only when it disagrees with the assignee; disagreement is
  //    information (a rework reassignment), not noise to resolve.
  const assignee = emp.assignee || null;
  const author = emp.lastCommitAuthor || null;
  let employee;
  if (!assignee && !author) employee = 'unassigned';
  else if (!assignee) employee = `last commit by ${author}`;
  else if (emp.agree === false) employee = `${assignee} · last commit by ${author}`;
  else employee = assignee;

  // 4-7. The git fields. A lane with no branch cut yet says so in every one of
  //      them — never `0`, never `clean` (AC-8/AC-14): a zero there is a
  //      measurement of a thing that does not exist.
  const NOT_CUT = 'not cut yet';
  let worktree = NOT_CUT;
  let branch = NOT_CUT;
  let ahead = NOT_CUT;
  let dirty = NOT_CUT;
  let lastCommit = NOT_CUT;
  if (wt) {
    worktree = wt.relPath || 'unknown path';
    branch = wt.detached ? `detached at ${String(wt.head || '').slice(0, 8)}` : wt.branch || 'no branch';
    ahead =
      wt.ahead === null || wt.ahead === undefined
        ? 'unknown'
        : `${wt.ahead} ahead of master${wt.behind ? ` · ${wt.behind} behind` : ''}`;
    if (wt.dirtyCount === null || wt.dirtyCount === undefined) dirty = 'unknown';
    else if (wt.dirtyCount === 0) dirty = 'clean';
    else dirty = `dirty · ${wt.dirtyCount} file${wt.dirtyCount === 1 ? '' : 's'}${wt.dirtyLattice ? ' · incl. .lattice' : ''}`;
    if (wt.lastCommit && wt.lastCommit.sha) {
      const who = wt.lastCommit.authorName || 'unknown author';
      const when = fmtAge(ageSince(wt.lastCommit.committedAt, nowMs));
      lastCommit =
        wt.ahead === 0
          ? `no commits on branch yet (tip by ${who}, ${when} ago)`
          : `${who}, ${when} ago — ${wt.lastCommit.subject || 'no subject'}`;
    } else {
      lastCommit = 'unknown';
    }
  }

  // 8. STALE — shown only when true, and it says WHY in words.
  const staleReasons = lane && lane.stale && Array.isArray(lane.stale.reasons) ? lane.stale.reasons : [];
  const staleFlag = Boolean(lane && lane.stale && lane.stale.flag);
  const staleWhy = staleReasons.map((r) => STALE_REASONS[r] || `reason: ${r}`).join(' and ');

  // Per-row git failures are surfaced, not swallowed: one broken worktree never
  // blanks its neighbours (AC-4), and the card says which call failed.
  const errors = wt && Array.isArray(wt.errors) ? wt.errors : [];

  return {
    key: (lane && lane.key) || taskText,
    taskText,
    taskId: task && task.taskId ? task.taskId : null,
    shortId,
    title,
    unknownTask,
    stage,
    employee,
    worktree,
    branch,
    ahead,
    dirty,
    lastCommit,
    staleFlag,
    staleText: staleFlag ? `STALE — ${staleWhy}` : '',
    errorsText: errors.length ? `git could not answer: ${errors.join('; ')}` : '',
    // The two AS-100 slots. Always rendered, never omitted, never styled as an
    // error: an absent signal is a fact about the stream, not a failure.
    ...describeLive(lane, eventsReason, nowMs),
  };
}

/**
 * AS-100 — the two live slots' words (AC-18).
 *
 * Three inputs decide them, in this order: is there a stream at all; has this
 * lane ever emitted a stage; is that stage alive. The middle case is the one
 * that has to stay distinct — "the watcher is not reporting" and "this lane has
 * not started a stage" are different facts, and rendering them the same way is
 * the AS-99 dash-versus-zero failure wearing a different field.
 *
 * @param {object|null} lane          one lane card from the projection
 * @param {string} eventsReason       the projection's `events.reason`
 * @param {number} nowMs             client clock — elapsed is recomputed here
 *                                    on the render timer, never trusted from
 *                                    the payload's `elapsedS` (AS-27 pattern)
 */
function describeLive(lane, eventsReason, nowMs) {
  const sub = lane && lane.subAgent && typeof lane.subAgent === 'object' ? lane.subAgent : null;

  // 1. No stream: both slots name the missing input, and neither claims a
  //    measurement. `no-stream` is the pre-AS-100 watcher, which is a fact.
  if (eventsReason !== 'ok' && !sub) {
    return { stageTimer: NO_STREAM_SLOT, subAgent: NO_STREAM_SLOT, liveTone: 'none' };
  }

  // 2. Stream is readable, this lane has emitted nothing. NOT "no signal":
  //    a lane in `in_planning` with no stage started yet is working as designed.
  if (!sub) {
    return { stageTimer: NO_STAGE_EVENTS, subAgent: NO_STAGE_EVENTS, liveTone: 'none' };
  }

  const stage = sub.stage || 'stage';
  const actor = sub.actor || 'unknown employee';
  const last = sub.lastEvent && typeof sub.lastEvent === 'object' ? sub.lastEvent : {};
  const outcome = typeof last.outcome === 'string' ? last.outcome : null;

  // 3a. Alive: elapsed from `startedAt` against the client clock, so the card
  //     counts up on the 15 s render timer without a new request.
  if (sub.alive === true) {
    const secs = ageSince(sub.startedAt, nowMs);
    const elapsed = Number.isFinite(secs) ? fmtAge(secs) : fmtAge(sub.elapsedS);
    return {
      stageTimer: `${stage} running for ${elapsed}`,
      subAgent: `${actor} · working`,
      liveTone: 'live',
    };
  }

  // 3b. Not alive, and nothing ever closed it: the tick box expired with the
  //     stage still open. This is the one the board must never read as
  //     "running" — the employee is gone and the sweep has not caught up yet.
  const openTypes = last.type === 'stage_started' || last.type === 'subagent_spawned';
  if (openTypes) {
    const since = stampUTC(last.ts ?? sub.startedAt);
    return {
      stageTimer: `${stage} — no signal since ${since} (tick box expired)`,
      subAgent: `${actor} · no signal since ${since}`,
      liveTone: 'alert',
    };
  }

  // 3c. Closed. The two tables decide the word; a bare enum never gets here,
  //     which is what the key-set assertions in test/lanes-label.test.js buy.
  const ended = fmtAge(sub.elapsedS);
  if (last.type === 'subagent_exited') {
    const word = SUBAGENT_EXIT_WORDS[outcome] ?? `exit: ${outcome}`;
    return {
      stageTimer: `${stage} ran ${ended}`,
      subAgent: `${actor} · ${word}`,
      liveTone: ALERT_OUTCOMES.has(outcome) ? 'alert' : 'done',
    };
  }
  const word = STAGE_OUTCOME_WORDS[outcome] ?? `outcome: ${outcome}`;
  return {
    stageTimer: `${stage} ${word} · ran ${ended}`,
    subAgent: `${actor} · ${word}`,
    liveTone: ALERT_OUTCOMES.has(outcome) ? 'alert' : 'done',
  };
}

/** The transient `now:` line's state. AS-99 ships the element and the three
 *  states with NO PRODUCER — AS-103 pushes the frames. Blank after reload is
 *  correct and deliberate: the stream is strictly ephemeral, with no replay
 *  buffer to draw a backlog from (plan T3 Q5). */
export const ACTIVITY_DECAY_MS = 15_000;

export function describeActivity(activity, nowMs = Date.now()) {
  if (!activity || !activity.text) return { state: 'blank', text: '' };
  const age = ageSince(activity.at, nowMs) * 1000;
  if (!Number.isFinite(age) || age > ACTIVITY_DECAY_MS) return { state: 'decayed', text: `now: ${activity.text}` };
  return { state: 'live', text: `now: ${activity.text}` };
}
