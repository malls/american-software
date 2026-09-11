// lib/lanes.js — AS-99: the lane projection.
//
// One projection, many sources (CLAUDE.md § "Observability north star"): the
// git half comes from the host watcher's snapshot (apps/chat/data/worktrees.json,
// written by makeLanesOps in watch/advance-watcher.mjs), the Lattice half comes
// from .lattice/tasks read live, and AS-100's event stream joins here later as a
// third input to this same function rather than as a rewrite of the watcher.
//
// PURE: no fs, no clock, no process. Everything it needs is an argument, which
// is what lets every rule below be a unit test instead of an argument.
//
// The snapshot is a SOURCE; this projection is the CONTRACT. The keys emitted
// here are an exact whitelist (test/lanes.test.js asserts the key sets), so a
// field the watcher grows tomorrow cannot reach a browser without a decision.

import { MID_LIFECYCLE } from '../watch/advance-watcher.mjs';

/** How old a snapshot's own generatedAt may be before the server stops calling
 *  it current. Four lanes polls (the watcher writes every 15 s whether or not
 *  anything changed — AC-2), and the same figure the watcher heartbeat uses.
 *  Exported so tests assert the boundary against the constant, never a literal. */
export const LANES_STALE_MS = 60_000;

/** The reason codes /api/lanes may report for the snapshot. Exported so the
 *  label table in public/lanes.js can be key-set asserted against it (AC-14):
 *  a new reason with no sentence is a test failure, not a bare enum in the UI. */
export const LANES_REASON_CODES = Object.freeze([
  'ok',
  'stale-snapshot',
  'no-snapshot',
  'unreadable-snapshot',
  'git-error',
]);

/** The exact keys of lane.worktree — AS-27's rule, applied to a second file:
 *  a snapshot that grows a field does not get to leak it into a browser. */
export const LANE_WORKTREE_KEYS = Object.freeze([
  'relPath',
  'branch',
  'detached',
  'head',
  'ahead',
  'behind',
  'dirtyCount',
  'dirtyLattice',
  'merged',
  'lastCommit',
  'errors',
]);

const SHORT_ID_RE = /AS-\d+/;

/** What `events` says when this projection was composed with no stream input —
 *  AS-100's `no-stream` is a fact (a pre-AS-100 watcher writes no file), not an
 *  error, and the UI reads it as "no event stream" in both liveness slots. */
export const EVENTS_SHELL = Object.freeze({
  reason: 'no-stream',
  path: null,
  lastId: null,
  lastTs: null,
  malformed: 0,
  open: Object.freeze({ stages: 0, subagents: 0 }),
});

function isoAgeS(iso, nowMs) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.round((nowMs - t) / 1000);
}

/** `agent:developer-marcus` and the git `%an` `developer-marcus` are the same
 *  person by the git-identity convention (CLAUDE.md § Git Methodology). The
 *  comparison strips the prefix; it never merges the two fields (AC-10). */
function authorsAgree(assignee, lastCommitAuthor) {
  if (!assignee || !lastCommitAuthor) return null;
  return String(assignee).replace(/^agent:/, '') === String(lastCommitAuthor);
}

function taskView(task) {
  if (!task) return null;
  return {
    shortId: task.short_id ?? null,
    taskId: task.id ?? null,
    title: task.title ?? '',
    status: task.status ?? null,
    assignee: task.assigned_to ?? null,
  };
}

function worktreeView(row) {
  const out = {};
  for (const key of LANE_WORKTREE_KEYS) out[key] = row[key] ?? null;
  out.errors = Array.isArray(row.errors) ? row.errors : [];
  return out;
}

function staleOf(task, row) {
  const reasons = [];
  if (task?.status === 'done') reasons.push('task-done');
  if (task?.status === 'cancelled') reasons.push('task-cancelled');
  if (row?.merged === true) reasons.push('merged');
  return { flag: reasons.length > 0, reasons };
}

function snapshotShell(reason, { generatedAt = null, ageS = null, stale = true, error = null } = {}) {
  return { generatedAt, ageS, stale, reason, error };
}

/**
 * Compose the lane projection.
 *
 * @param snapshot the parsed apps/chat/data/worktrees.json, or null when the
 *                 file is absent, or `{error:'unparsable'}` from readLoopFile.
 * @param tasks    lib/lattice.js listTasks(root)
 * @param ids      lib/lattice.js idsByShortId(root) — shortId -> task file id
 * @param nowMs    the server clock
 * @param staleMs  LANES_STALE_MS, injectable so the boundary test is a test
 */
export function composeLanes({
  snapshot,
  tasks = [],
  ids = {},
  nowMs,
  staleMs = LANES_STALE_MS,
  liveness = null,
  events = null,
}) {
  const checkedAt = new Date(nowMs).toISOString();
  // AS-100's third input, reported as a sibling of `snapshot` and never mixed
  // into it: the git half and the event half fail independently, so the lanes
  // still render when the stream is missing and the two liveness slots carry
  // the reason instead of a bare null.
  const eventsShell = events ?? EVENTS_SHELL;
  const live = (key) => (liveness && key && liveness[key]) || null;
  const blank = (reason, extra) => ({
    checkedAt,
    snapshot: snapshotShell(reason, extra),
    count: null,
    lanes: null,
    events: eventsShell,
  });

  // A partial list must not masquerade as the list (Jonah's ledger): with no
  // readable snapshot the Lattice half alone IS partial, so `lanes` is null and
  // the pane says "lane data unavailable" rather than drawing a short list.
  if (snapshot === null || snapshot === undefined) return blank('no-snapshot');
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) return blank('unreadable-snapshot');
  if (typeof snapshot.generatedAt !== 'string' || !Number.isFinite(Date.parse(snapshot.generatedAt))) {
    return blank('unreadable-snapshot');
  }
  if (!Array.isArray(snapshot.worktrees)) return blank('unreadable-snapshot');

  const ageS = isoAgeS(snapshot.generatedAt, nowMs);
  // Age comes from generatedAt and NOTHING else — never a file mtime (Q1/AC-11).
  // There is no mtime in this payload to read, so a copied or rsynced snapshot
  // cannot look fresh.
  const stale = !(Number.isFinite(ageS) && ageS * 1000 <= staleMs);
  const error = typeof snapshot.error === 'string' && snapshot.error ? snapshot.error : null;
  const shell = (reason) => snapshotShell(reason, { generatedAt: snapshot.generatedAt, ageS, stale, error });

  // The watcher reached git and git refused. The snapshot is a fact with a
  // timestamp, but it enumerates no worktrees, so the lane list is empty rather
  // than "whatever .lattice alone knows" — same partial-list rule as above,
  // with the reason sentence carrying the explanation.
  if (error) return { checkedAt, snapshot: shell('git-error'), count: 0, lanes: [], events: eventsShell };

  const byBranch = new Map();
  const byId = new Map();
  for (const task of tasks) {
    if (!task || !task.id) continue;
    byId.set(task.id, task);
    for (const link of task.branch_links ?? []) {
      if (link && typeof link.branch === 'string' && !byBranch.has(link.branch)) byBranch.set(link.branch, task);
    }
  }

  const joined = new Set();
  const laneRows = [];
  for (const row of snapshot.worktrees) {
    if (!row || typeof row !== 'object' || row.main === true) continue;
    // Join order is load-bearing (AC-7): an explicit `lattice branch-link` beats
    // a short code parsed out of a branch name, because the link is a statement
    // and the name is a guess.
    let task = null;
    let joinedBy = null;
    if (typeof row.branch === 'string' && byBranch.has(row.branch)) {
      task = byBranch.get(row.branch);
      joinedBy = 'branch-link';
    } else if (typeof row.branch === 'string') {
      const match = SHORT_ID_RE.exec(row.branch);
      const taskId = match ? ids[match[0]] : null;
      if (taskId && byId.has(taskId)) {
        task = byId.get(taskId);
        joinedBy = 'branch-name';
      }
    }
    if (task) joined.add(task.id);
    const view = worktreeView(row);
    const key = task?.short_id ?? view.relPath ?? row.relPath ?? null;
    laneRows.push({
      key,
      task: taskView(task),
      joinedBy,
      worktree: view,
      employee: {
        assignee: task?.assigned_to ?? null,
        lastCommitAuthor: row.lastCommit?.authorName ?? null,
        agree: authorsAgree(task?.assigned_to ?? null, row.lastCommit?.authorName ?? null),
      },
      stale: staleOf(task, row),
      // AS-100 fills the two slots AS-99 reserved. Filling them adds no key to
      // the card — which is the contract's own test for "extensible, not a
      // one-off" — so `api-lanes-key-whitelist` passes unmodified.
      stageStartedAt: live(key)?.stageStartedAt ?? null,
      subAgent: live(key)?.subAgent ?? null,
      sortKey: String(view.relPath ?? ''),
    });
  }

  // A lane is a task in flight, with or without a worktree. Membership uses the
  // watcher's own MID_LIFECYCLE constant so this definition cannot drift from
  // the loop's (AC-8). blocked/needs_human hold no WIP slot and get a lane only
  // when a worktree exists — and then they arrived above, not here.
  const taskOnly = [];
  for (const task of tasks) {
    if (!task || !task.id || joined.has(task.id)) continue;
    if (!MID_LIFECYCLE.includes(task.status)) continue;
    taskOnly.push({
      key: task.short_id ?? task.id,
      task: taskView(task),
      joinedBy: 'task-only',
      worktree: null,
      employee: { assignee: task.assigned_to ?? null, lastCommitAuthor: null, agree: null },
      stale: staleOf(task, null),
      stageStartedAt: live(task.short_id ?? task.id)?.stageStartedAt ?? null,
      subAgent: live(task.short_id ?? task.id)?.subAgent ?? null,
      sortKey: String(task.short_id ?? task.id),
    });
  }

  // Slot order, not a ranking (Jonah §5.1): worktree lanes by path, then
  // task-only lanes by short id, numeric-aware so AS-99 precedes AS-100.
  const cmp = (a, b) => a.sortKey.localeCompare(b.sortKey, 'en', { numeric: true });
  laneRows.sort(cmp);
  taskOnly.sort(cmp);
  const lanes = [...laneRows, ...taskOnly].map(({ sortKey, ...lane }) => lane);

  return {
    checkedAt,
    snapshot: shell(stale ? 'stale-snapshot' : 'ok'),
    count: lanes.length,
    lanes,
    events: eventsShell,
  };
}
