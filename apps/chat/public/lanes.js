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
 * @returns {{ badge: string, title: string, caption: string, stale: boolean, lanes: Array }}
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
    };
  }

  const snap = projection.snapshot && typeof projection.snapshot === 'object' ? projection.snapshot : {};
  const reason = typeof snap.reason === 'string' ? snap.reason : 'unreadable-snapshot';
  const why = SNAPSHOT_REASONS[reason] ?? `reason: ${reason}`;
  const lanes = Array.isArray(projection.lanes) ? projection.lanes : null;

  // lanes === null is the server saying "a partial list must not masquerade as
  // the list" — so the badge says the same thing the caption does.
  if (lanes === null) {
    return {
      badge: 'Lanes · –',
      title: why || 'Lane data unavailable.',
      caption: `Lane data unavailable — ${why || `reason: ${reason}`}.`,
      stale: true,
      lanes: [],
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
export function describeLane(lane, nowMs = Date.now()) {
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
    // error: they are not broken, they are not sourced yet.
    stageTimer: lane && lane.stageStartedAt ? `stage started ${fmtAge(ageSince(lane.stageStartedAt, nowMs))} ago` : 'no live signal yet',
    subAgent: lane && lane.subAgent ? String(lane.subAgent) : 'no live signal yet',
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
