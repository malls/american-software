// server.js — localhost HTTP server for the chat app (AS-2).
// Static files from public/ + JSON API under /api/*. No logic beyond HTTP
// plumbing; all domain behavior lives in lib/store.js (and lib/lattice.js).

import { createServer } from 'node:http';
import { readFileSync, realpathSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore, StoreError } from './lib/store.js';
import {
  ingestNewEvents,
  resolveRefs,
  resolveShortId,
  latticeRoot,
  assignmentsByActor,
  listTasks,
  idsByShortId,
} from './lib/lattice.js';
// AS-99: the lane projection. The composer is pure and lives in lib/; the
// server supplies the three inputs (snapshot file, task list, clock).
import { composeLanes } from './lib/lanes.js';
// AS-100: the company event stream. The core is pure and stateless; the only
// state on this side is the byte-offset tail below, which is stateful by
// nature and therefore does not belong in lib/.
import {
  emptyFold,
  foldEvent,
  openItems,
  parseJsonl,
  projectEvent,
  readStream,
  reduceLiveness,
} from './lib/events.js';
import { readRoster, readPersonnel } from './lib/personnel.js';
// AS-33: the org rule set + tree builder. The server importing UP into
// public/ is deliberate: that module is also what the BROWSER imports, and a
// second copy of the rules for the client is the drift hazard the whole org
// check exists to prevent. See the header of public/org-chart.js.
import { validateOrg } from './public/org-chart.js';
// AS-27: the loop-status derivation, and the watcher's own staleness constant.
// DEFAULTS.lockStaleMin is imported rather than restated so the server and the
// watcher can never disagree about how old a lock has to be to stop counting.
import { deriveLoopStatus } from './lib/loop-status.js';
import { DEFAULTS } from './watch/advance-watcher.mjs';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/url-state.js': ['url-state.js', 'text/javascript; charset=utf-8'],
  '/scroll.js': ['scroll.js', 'text/javascript; charset=utf-8'],
  '/thread-modal.js': ['thread-modal.js', 'text/javascript; charset=utf-8'],
  '/live.js': ['live.js', 'text/javascript; charset=utf-8'],
  '/dm-sort.js': ['dm-sort.js', 'text/javascript; charset=utf-8'],
  '/org-chart.js': ['org-chart.js', 'text/javascript; charset=utf-8'],
  '/msg-refs.js': ['msg-refs.js', 'text/javascript; charset=utf-8'],
  '/markdown.js': ['markdown.js', 'text/javascript; charset=utf-8'],
  '/loop-status.js': ['loop-status.js', 'text/javascript; charset=utf-8'],
  '/lanes.js': ['lanes.js', 'text/javascript; charset=utf-8'],
  '/dashboard-link.js': ['dashboard-link.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};

const INGEST_THROTTLE_MS = 10_000;

// AS-25: SSE heartbeat cadence. One shared timer writes a comment line (:hb)
// to every open stream — keeps proxy/NAT idle timeouts from reaping the
// connection and surfaces dead sockets as write errors. Uniform to all
// connections (no information content).
const HEARTBEAT_MS = 25_000;

// AS-27: how often the server re-reads advance.lock and advance-watcher.pid.
// A poll, not fs.watch: the files are written on the host and reach the
// container over a bind mount, where FSEvents is unreliable (the watcher polls
// its own sentinel for exactly this reason). 2s is plenty — the indicator
// answers a human question, not a machine one.
export const LOOP_POLL_MS = 2_000;

// AS-75: how old apps/chat/data/deploy-state.json may be before the server
// stops believing it. The watcher rewrites that file on every deploy-poll
// (default 60s), so ten minutes is ten missed polls — comfortably past a slow
// emulated build, comfortably short of "the reporter died an hour ago and the
// board is still reading its last opinion".
export const DEPLOY_STATE_STALE_MS = 10 * 60 * 1000;

// AS-99: how often the server recomposes the lane projection and pushes a frame
// if it CHANGED. Slower than the loop poll (a lane moves on the scale of a git
// commit, not a lock file) and faster than the watcher's own 15s snapshot
// cadence, so a new snapshot reaches a browser within one poll of being written.
export const LANES_POLL_MS = 5_000;

/**
 * AS-75: the `build` half of /api/loop-status — is the code serving this
 * request the code on master?
 *
 * Pure, and exported so it can be driven straight from the test suite. It
 * composes two independent facts: the id baked into THIS image (what is
 * running, first-hand) and the id the host watcher computed from master (what
 * should be running, reported through deploy-state.json).
 *
 * `current` is TRI-STATE and the third state is the point. It is `null` — never
 * `false` — whenever we cannot know: no deploy-state file, an unreadable one,
 * one too old to trust, a watcher that is not listening, or an image with no
 * baked id. `false` is reserved for "we have both ids and they differ". An
 * indicator that reported `false` because its reporter is dead would be the
 * same confident wrong answer this task exists to delete.
 */
export function composeBuild({ buildId, deployState, watcherListening, nowMs, staleMs = DEPLOY_STATE_STALE_MS }) {
  const id = buildId ?? null;
  const blank = { id, desiredId: null, current: null, checkedAt: null };
  if (deployState === null) return { ...blank, reason: 'no-state' };
  if (typeof deployState !== 'object' || deployState.error) return { ...blank, reason: 'unreadable-state' };

  const checkedAt = typeof deployState.computedAt === 'string' ? deployState.computedAt : null;
  const desiredId = typeof deployState.desiredId === 'string' ? deployState.desiredId : null;
  const reason = typeof deployState.reason === 'string' ? deployState.reason : 'unreadable-state';
  const out = { id, desiredId, current: null, reason, checkedAt };

  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at) || nowMs - at > staleMs) return { ...out, reason: 'stale-state' };
  if (!watcherListening) return { ...out, reason: 'no-watcher' };
  if (id === null) return { ...out, reason: 'unknown-build' };
  if (desiredId === null) return out; // the watcher itself could not compute one
  return { ...out, current: id === desiredId };
}

// --- AS-26 §5: gated repo markdown reads for the in-app file viewer ---------
// No 'me' gate and no store involvement: everything servable under this gate
// is repo-public by construction. Load-bearing invariant (AS-6): nobody may
// ever write private-channel content to a *.md file in the repo.

const FILE_MAX_BYTES = 512 * 1024;
const FILE_PATH_RE = /^[A-Za-z0-9._/-]+$/; // rejects %-escapes surviving decode, whitespace, backslashes

/**
 * Read a repo-relative markdown file through the traversal-hardened path
 * gate. Checks, in order: (1) syntax — present, ≤512 chars, charset, '.md'
 * suffix (case-sensitive), no leading '/', no '//'; (2) segments — no
 * empty/'.'/'..' segments, no dot-leading segment except a first segment
 * exactly '.lattice'; (3) realpath prefix — the target's RESOLVED path must
 * sit under the repo root's resolved path, which defeats symlink escape;
 * (3b, AS-34) realpath equality — the resolved path must equal the resolved
 * root joined with the requested path, byte-for-byte, which refuses every
 * symlink below the root: an alias can neither launder a dot directory nor
 * serve a servable file under a second name (the dot rule thus holds for
 * real locations, not just requested spellings); (4) regular file;
 * (4b, AS-61) exactly one link — a hard link is the same inode under a
 * second name, which 3b cannot see because there is no link to resolve, so
 * the gate refuses any file whose link count is not 1. That check is
 * symmetric by nature: both names of a hard-linked file report nlink 2, so
 * planting a link also 404s the target under its own legitimate name until
 * the extra name is removed — fail-closed, and accepted (AS-61 plan §1).
 * Checks 1–4b throw ONE byte-identical not_found — a probe cannot
 * distinguish "outside the gate" from "doesn't exist". Check (5), size cap,
 * alone is a 400: the file already passed the gate, nothing leaks.
 */
function readRepoMarkdown(root, path) {
  const fail = () => new StoreError('No such file.', 'not_found');
  // 1. Syntax.
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) throw fail();
  if (!FILE_PATH_RE.test(path)) throw fail();
  if (!path.endsWith('.md')) throw fail();
  if (path.startsWith('/') || path.includes('//')) throw fail();
  // 2. Segments.
  const segs = path.split('/');
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === '' || s === '.' || s === '..') throw fail();
    if (s.startsWith('.') && !(i === 0 && s === '.lattice')) throw fail();
  }
  // 3. Realpath containment (symlink-escape proof) + 3b. resolved-path
  // equality (AS-34: refuses any symlink below the root) + 4. regular file.
  let real, rootReal, st;
  try {
    rootReal = realpathSync(root);
    real = realpathSync(join(root, path));
    st = statSync(real);
  } catch {
    throw fail();
  }
  if (!real.startsWith(rootReal + sep)) throw fail();
  if (real !== join(rootReal, path)) throw fail();
  if (!st.isFile()) throw fail();
  if (st.nlink !== 1) throw fail(); // 4b (AS-61): a served file has exactly one name
  // 5. Size cap — distinct error by design (the gate already passed).
  if (st.size > FILE_MAX_BYTES) throw new StoreError('File too large.');
  return { path, content: readFileSync(real, 'utf8') };
}

/** StoreError -> HTTP status (one mapping for the JSON API and /api/stream). */
function storeErrorStatus(e) {
  return e.code === 'not_found' ? 404
    : e.code === 'forbidden' ? 403
    : e.code === 'conflict' ? 409
    : e.code === 'unknown_identity' || e.code === 'unknown_conversation' ? 404
    : 400;
}

// AS-100: how often the server tails events/company.jsonl, by byte offset.
// Same cadence and the same reason as LOOP_POLL_MS: the file is written on the
// host and reaches the container over a bind mount, where FSEvents is
// unreliable. Exported so the suite can pin the production value while
// injecting a small one, exactly as LOOP_POLL_MS/LANES_POLL_MS are.
export const EVENTS_POLL_MS = 2_000;

export function createChatServer({
  dbPath,
  repoRoot,
  dataDir,
  loopPollMs = LOOP_POLL_MS,
  lanesPollMs = LANES_POLL_MS,
  eventsPollMs = EVENTS_POLL_MS,
  // AS-75: the id baked into this image by the Dockerfile's ARG BUILD_ID.
  // Taken RAW, `unknown` included — normalising happens once, below, so both
  // /api/build and /api/loop-status answer from the same judgement.
  buildId = process.env.CHAT_BUILD_ID ?? null,
} = {}) {
  const store = openStore(dbPath || process.env.CHAT_DB || join(APP_DIR, 'data', 'chat.db'));
  const root = repoRoot || latticeRoot();
  // AS-27: where the watcher and the tick lock write. Defaults to the real
  // data dir (compose mounts ./data:/app/data rw, pinned by
  // deploy-shape.test.js); tests pass a scratch dir so they can plant each of
  // the four file configurations without touching live company state.
  const loopDir = dataDir || join(APP_DIR, 'data');
  const LOCK_PATH = join(loopDir, 'advance.lock');
  const WATCHER_PID_PATH = join(loopDir, 'advance-watcher.pid');
  const LOCK_STALE_MS = DEFAULTS.lockStaleMin * 60 * 1000;
  // AS-75: what the host watcher last decided about the deploy. Same directory,
  // same degradation contract as the two files above.
  const DEPLOY_STATE_PATH = join(loopDir, 'deploy-state.json');
  // AS-95: the host watcher's loop mirror. Same directory, same degradation
  // contract as the three files above — absent means "no watcher loop has ever
  // run here" (a pre-AS-95 watcher never writes it), which is not an error.
  const LOOP_STATE_PATH = join(loopDir, 'advance-loop.json');
  // AS-99: the host watcher's git snapshot of every worktree. Fourth file in
  // the same directory, same degradation contract as the three above — absent
  // means "no watcher has written one here", which the pane says out loud
  // rather than rendering an empty lane list as "nothing is running".
  const WORKTREES_PATH = join(loopDir, 'worktrees.json');
  // AS-100: the company event stream the watcher appends to. Sixth file under
  // the same directory, same degradation contract as the four above — absent
  // means "no AS-100 watcher has ever written here" (`no-stream`), a fact and
  // not a fault. CHAT_EVENTS_PATH is the same override bin/events.js honours,
  // so producer and reader are one variable apart, never two.
  const EVENTS_PATH = process.env.CHAT_EVENTS_PATH || join(loopDir, 'events', 'company.jsonl');
  // The tick box, from the watcher's own default rather than restated here —
  // the same reason LOCK_STALE_MS is imported: server and watcher can never
  // disagree about how long an open stage may go unheard.
  const TICK_TIMEOUT_MS = DEFAULTS.tickTimeoutMin * 60 * 1000;
  // `unknown` is what an image built by hand (no CHAT_BUILD_ID in the env)
  // carries. It is not an id — treating it as one would let a hand-built image
  // claim currency it cannot have — so it normalises to null, exactly like an
  // absent variable. RAW_BUILD_ID keeps the distinction visible at /api/build.
  const RAW_BUILD_ID = buildId ?? null;
  const BUILD_ID = RAW_BUILD_ID && RAW_BUILD_ID !== 'unknown' ? RAW_BUILD_ID : null;
  // When this process started serving — the other half of "what code, since
  // when". Captured once, here, not per request.
  const SERVER_STARTED_AT = new Date().toISOString();

  // Ingest on startup; then throttled on API traffic (no daemons — a page
  // refresh is what makes the feed current).
  ingestNewEvents(store, root);
  let lastIngest = Date.now();
  function maybeIngest() {
    if (Date.now() - lastIngest >= INGEST_THROTTLE_MS) {
      lastIngest = Date.now();
      try {
        ingestNewEvents(store, root);
      } catch {
        // A malformed .lattice file must never take the chat server down.
      }
    }
  }

  const annotate = (m) => ({ ...m, refs: resolveRefs(m.body, root) });

  // --- AS-27: advance-loop status -------------------------------------------
  // Same degradation contract as /api/roster and /api/org: a malformed lock or
  // pid file must never take the chat server down. Absent file -> null;
  // unreadable or non-JSON -> { error }, which deriveLoopStatus reports as a
  // reason string. There is no third outcome and no throw.

  function readLoopFile(path) {
    let raw;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      return null; // missing (the normal idle case) or unreadable
    }
    try {
      return JSON.parse(raw);
    } catch {
      return { error: 'unparsable' };
    }
  }

  // C5, the documented limit: a /loop session RELEASES the lock between its
  // ticks (advance.md step 6), so between two loop ticks there is no fresh
  // lock and the UI truthfully reads 'idle'. This is a best-effort memory of
  // the last tick the server happened to observe, so the detail line can say
  // "last tick: loop, ended 40 s ago" — it is in-memory only, resets on
  // restart, and cannot see a tick that began and ended between two polls.
  // It is a mitigation, not a fix, and it never changes `state`.
  let lastTick = null;

  function readLoopStatus() {
    const nowMs = Date.now();
    const status = deriveLoopStatus({
      lock: readLoopFile(LOCK_PATH),
      watcher: readLoopFile(WATCHER_PID_PATH),
      loopState: readLoopFile(LOOP_STATE_PATH),
      nowMs,
      lockStaleMs: LOCK_STALE_MS,
    });
    if (status.tick) {
      if (!lastTick || lastTick.startedAt !== status.tick.startedAt) {
        lastTick = { source: status.tick.source, startedAt: status.tick.startedAt, endedAt: null };
      }
    } else if (lastTick && lastTick.endedAt === null) {
      lastTick = { ...lastTick, endedAt: new Date(nowMs).toISOString() };
    }
    // AS-75: composed here, not in lib/loop-status.js — deriveLoopStatus stays
    // pure and its four states stay exactly four. `build` rides alongside
    // `lastTick` for the same reason: both are server-side compositions over
    // the derived status, not new states of it.
    const build = composeBuild({
      buildId: BUILD_ID,
      deployState: readLoopFile(DEPLOY_STATE_PATH),
      watcherListening: status.watcher.listening,
      nowMs,
    });
    return { ...status, lastTick, build };
  }

  // AS-99: the lane projection. The git half is the watcher's snapshot (only as
  // fresh as the watcher, which is why composeLanes reports its age); the
  // Lattice half is read live here, so stage, assignee and title are never
  // snapshot-aged, and a task with no worktree yet still gets a lane.
  // AS-100: the event tail. A byte offset, a partial line and the fold — the
  // three things a stateful reader of an append-only file needs and nothing
  // else. `reason` is the same enum /api/events reports, so the pane says the
  // same word whichever door it came through.
  const eventsTail = {
    offset: 0,
    partial: Buffer.alloc(0),
    fold: emptyFold(),
    reason: 'no-stream',
    lastId: null,
    lastTs: null,
    malformed: 0,
  };
  function resetTail(reason) {
    eventsTail.offset = 0;
    eventsTail.partial = Buffer.alloc(0);
    eventsTail.fold = emptyFold();
    eventsTail.reason = reason;
    eventsTail.lastId = null;
    eventsTail.lastTs = null;
  }

  /** Read whatever has been appended since the last call and fold it in.
   *  Returns the PROJECTED envelopes of the new events, in file order — the
   *  poll below turns each into one `company` frame. A file shorter than the
   *  offset is a truncation: the reader starts over and SAYS so (AC-14); it
   *  never throws, because a rotated or hand-edited log is a fact about the
   *  host, not a reason to take the chat server down. */
  function tailEvents() {
    let size;
    try {
      size = statSync(EVENTS_PATH).size;
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        resetTail('no-stream');
        return [];
      }
      eventsTail.reason = 'unreadable-stream';
      return [];
    }
    let truncated = false;
    if (size < eventsTail.offset) {
      resetTail('truncated');
      truncated = true;
    }
    if (size === eventsTail.offset) {
      if (!truncated && eventsTail.reason !== 'truncated') eventsTail.reason = 'ok';
      return [];
    }
    let chunk;
    try {
      const fd = openSync(EVENTS_PATH, 'r');
      try {
        const buf = Buffer.alloc(size - eventsTail.offset);
        const read = readSync(fd, buf, 0, buf.length, eventsTail.offset);
        chunk = buf.subarray(0, read);
        eventsTail.offset += read;
      } finally {
        closeSync(fd);
      }
    } catch {
      eventsTail.reason = 'unreadable-stream';
      return [];
    }
    // The partial tail is kept as BYTES, not text: a multi-byte character split
    // across two reads would otherwise decode to two replacement characters and
    // corrupt a line that was never malformed.
    const buf = Buffer.concat([eventsTail.partial, chunk]);
    const nl = buf.lastIndexOf(0x0a);
    if (nl === -1) {
      eventsTail.partial = buf;
      return [];
    }
    eventsTail.partial = buf.subarray(nl + 1);
    const { events, malformed } = parseJsonl(buf.subarray(0, nl + 1).toString('utf8'));
    eventsTail.malformed += malformed;
    const out = [];
    // File order, not (ts, id) order: the tail reports arrivals, and a frame
    // that reordered them would disagree with the file every consumer can read.
    for (const ev of events) {
      eventsTail.fold = foldEvent(eventsTail.fold, ev);
      eventsTail.lastId = ev.id;
      eventsTail.lastTs = typeof ev.ts === 'string' ? ev.ts : eventsTail.lastTs;
      const projected = projectEvent(ev);
      if (projected) out.push(projected);
    }
    if (truncated) {
      // stays 'truncated' until the NEXT append: one poll cannot both report
      // the loss and pretend it is over.
    } else if (eventsTail.reason === 'truncated') {
      if (events.length) eventsTail.reason = 'ok';
    } else {
      eventsTail.reason = 'ok';
    }
    return out;
  }

  /** The `stream` half of both /api/events and the lanes projection. `path` is
   *  deliberately null — the host path is no more a browser's business than the
   *  lock's nonce is (AS-16's rule, by analogy). */
  function eventsStreamInfo(fold = eventsTail.fold, reason = eventsTail.reason) {
    const open = openItems(fold);
    return {
      reason,
      path: null,
      lastId: eventsTail.lastId,
      lastTs: eventsTail.lastTs,
      malformed: eventsTail.malformed,
      open: { stages: open.stages.length, subagents: open.subagents.length },
    };
  }

  /** GET /api/events — the catch-up read, straight from the file through the
   *  tolerant parser. Deliberately NOT served from the tail: the tail is a push
   *  cursor, and a reader asking "what happened before I connected" must see
   *  the file, not this process's memory of it. */
  function readEvents({ since = null, task = null, limit = 200 } = {}) {
    const s = readStream(EVENTS_PATH);
    let events = s.events;
    if (since) {
      // Resolve the cursor on the FULL stream, before any task filter: a client
      // that tails one task with the last id it saw on the unfiltered `company`
      // frames must not get an empty catch-up because that id belongs to another
      // lane (qa-ruben review, AS-100: `task=AS-7&since=<AS-8 id>` returned []).
      const at = events.findIndex((ev) => ev.id === since);
      // An unknown `since` (a Lattice `ev_` id, a typo) returns nothing rather
      // than everything: a catch-up that silently replays the whole log is how
      // a client ends up rendering the same hour twice.
      events = at === -1 ? [] : events.slice(at + 1);
    }
    if (task) events = events.filter((ev) => ev && ev.data && ev.data.task === task);
    const n = Number(limit);
    const capped = Math.min(Math.max(1, Number.isFinite(n) ? Math.trunc(n) : 200), 1000);
    const last = s.events.length ? s.events[s.events.length - 1] : null;
    return {
      stream: {
        reason: s.reason,
        path: null,
        lastId: last ? last.id : null,
        lastTs: last && typeof last.ts === 'string' ? last.ts : null,
        malformed: s.malformed,
        open: (() => {
          const open = openItems(s.events);
          return { stages: open.stages.length, subagents: open.subagents.length };
        })(),
      },
      events: events.slice(0, capped).map(projectEvent).filter(Boolean),
    };
  }

  function readLanes() {
    const nowMs = Date.now();
    // `tickLive` is the ONE existing rule for "a tick is running" (a fresh
    // lock), imported through readLoopStatus rather than restated: while the
    // watcher holds its lock every open stage is alive, because settle() will
    // close it the moment the tick ends.
    let tickLive = false;
    try {
      tickLive = readLoopStatus().tick !== null;
    } catch {
      tickLive = false;
    }
    return composeLanes({
      snapshot: readLoopFile(WORKTREES_PATH),
      tasks: listTasks(root),
      ids: idsByShortId(root),
      nowMs,
      liveness: reduceLiveness(eventsTail.fold, {
        nowMs,
        tickLive,
        tickTimeoutMs: TICK_TIMEOUT_MS,
      }),
      events: eventsStreamInfo(),
    });
  }

  // What counts as a CHANGE worth a lanes frame. `ageS` and `checkedAt` move on
  // every poll and are excluded for the same reason every age field is excluded
  // from loopStateKey; `snapshot.generatedAt` is INCLUDED deliberately — the
  // watcher rewrites it every 15 s whether or not git changed, so one small
  // frame per snapshot is the honest "the feed is alive" signal and keeps the
  // client's age caption sourced from a current timestamp. `stale` is included
  // because it flips at the 60 s boundary with no file write behind it.
  const lanesKey = (p) =>
    JSON.stringify({
      generatedAt: p.snapshot.generatedAt,
      reason: p.snapshot.reason,
      stale: p.snapshot.stale,
      error: p.snapshot.error,
      count: p.count,
      // AS-100: the lanes are reduced field by field rather than serialised
      // whole, because the liveness slots carry `subAgent.elapsedS`, which
      // moves on EVERY poll — keying on `p.lanes` wholesale would emit a frame
      // per second per connection forever (AC-17). The three liveness fields
      // that should earn a frame are in; elapsed is deliberately out, and the
      // client recomputes it from `startedAt` on its own timer, exactly as it
      // already does for every age field in the loop frame.
      lanes:
        p.lanes &&
        p.lanes.map((lane) => ({
          key: lane.key,
          task: lane.task,
          worktree: lane.worktree,
          stageStartedAt: lane.stageStartedAt,
          subAgent: lane.subAgent && {
            actor: lane.subAgent.actor,
            stage: lane.subAgent.stage,
            alive: lane.subAgent.alive,
            startedAt: lane.subAgent.startedAt,
            lastEventId: lane.subAgent.lastEvent && lane.subAgent.lastEvent.id,
          },
        })),
      events: p.events && {
        reason: p.events.reason,
        lastId: p.events.lastId,
        malformed: p.events.malformed,
        open: p.events.open,
      },
    });

  // What counts as a CHANGE worth a push frame. Deliberately excludes every
  // age field: `ageS` moves on every single poll, so comparing whole payloads
  // would emit 30 frames a minute to every connection forever. The client
  // recomputes age locally from startedAt, which is why it can afford to.
  const loopStateKey = (s) =>
    JSON.stringify({
      state: s.state,
      tick: s.tick && { source: s.tick.source, pid: s.tick.pid, startedAt: s.tick.startedAt },
      staleLock: s.staleLock && { source: s.staleLock.source, startedAt: s.staleLock.startedAt, reason: s.staleLock.reason },
      listening: s.watcher.listening,
      reason: s.watcher.reason ?? null,
      // AS-75: a staleness CHANGE is worth a frame; the timestamp it was
      // observed at is not. `build.checkedAt` moves on every deploy-poll, so
      // including it would emit a frame per poll to every connection forever —
      // the same reason every age field is excluded above.
      build: { id: s.build.id, desiredId: s.build.desiredId, current: s.build.current },
      // AS-95: the tick COUNT is the thing that moves in the loop label, so a
      // new loop tick must earn a frame; `startedAt` of the loop is already
      // covered by `active` flipping. `lastLoop.stoppedAt` is included because
      // a second loop can stop for the same reason after the same number of
      // ticks, and the board should still see the sentence refresh.
      loop: s.loop && {
        active: s.loop.active,
        ticks: s.loop.ticks,
        lastLoop: s.loop.lastLoop && { reason: s.loop.lastLoop.reason, stoppedAt: s.loop.lastLoop.stoppedAt, ticks: s.loop.lastLoop.ticks },
      },
    });

  // --- AS-25: SSE push delivery ---------------------------------------------
  // Live stream connections: { res, me }. Registered by GET /api/stream,
  // removed on socket close (and reaped wholesale by close()).
  const streams = new Set();

  // Fan-out: the store's post-commit hook is the single event source (since
  // AS-24 the server is the sole live writer — CLI writes proxy through the
  // HTTP API, lattice ingestion runs in-process). Annotate once; deliver per
  // connection iff visibleTo at delivery time. Non-members of a hidden
  // channel receive zero bytes — nonexistent-parity applies to the stream.
  store.onMessage((msg) => {
    let frame = null;
    for (const conn of streams) {
      if (!store.visibleTo(msg.conversationId, conn.me)) continue;
      frame ??= `event: message\ndata: ${JSON.stringify(annotate(msg))}\n\n`;
      try {
        conn.res.write(frame);
      } catch {
        streams.delete(conn);
      }
    }
  });

  const heartbeat = setInterval(() => {
    for (const conn of streams) {
      try {
        conn.res.write(':hb\n\n');
      } catch {
        streams.delete(conn);
      }
    }
  }, HEARTBEAT_MS);

  // AS-27: loop-status push. Primed at construction so the first poll after
  // boot does not emit a frame describing a state nothing has changed since.
  let lastLoopKey = loopStateKey(readLoopStatus());
  // `loopPollMs` exists so the suite can observe ten real poll cycles in
  // milliseconds instead of twenty seconds — the frame COUNT is the property
  // under test, not the wall-clock cadence. Production always takes the
  // exported default (pinned in api.test.js).
  const loopPoll = setInterval(() => {
    let status;
    try {
      status = readLoopStatus();
    } catch {
      return; // C7: never let a bad file take the server down
    }
    const key = loopStateKey(status);
    if (key === lastLoopKey) return;
    lastLoopKey = key;
    // No visibleTo gate: loop status is identical for every viewer (C4).
    const frame = `event: loop\ndata: ${JSON.stringify(status)}\n\n`;
    for (const conn of streams) {
      try {
        conn.res.write(frame);
      } catch {
        streams.delete(conn);
      }
    }
  }, loopPollMs);
  loopPoll.unref();

  // AS-100: prime the tail BEFORE the lanes key below, not after. `lanesKey`
  // includes `events.reason`, and an unprimed tail still reads its constructed
  // default `no-stream`; priming the lanes key from that state made the first
  // tail poll (which sets `ok`) change the key and push one lanes frame whose
  // visible content was identical — an empty frame to every client that
  // connected near boot (AC-17). The two primings must see the same tail.
  tailEvents();

  // AS-99: lanes push, change-only. Primed at construction for the same reason
  // the loop poll is: the first poll after boot must not emit a frame for a
  // state nothing has changed since.
  let lastLanesKey = lanesKey(readLanes());
  const lanesPoll = setInterval(() => {
    let projection;
    try {
      projection = readLanes();
    } catch {
      return; // a bad snapshot or task file never takes the server down
    }
    const key = lanesKey(projection);
    if (key === lastLanesKey) return;
    lastLanesKey = key;
    // No visibleTo gate: the lane view is identical for every viewer, same
    // contract as the loop frame.
    const frame = `event: lanes\ndata: ${JSON.stringify({ lanes: projection })}\n\n`;
    for (const conn of streams) {
      try {
        conn.res.write(frame);
      } catch {
        streams.delete(conn);
      }
    }
  }, lanesPollMs);
  lanesPoll.unref();

  // AS-100: the company stream tail. Change-only by construction rather than by
  // key comparison — an append-only file HAS no "current", so there is nothing
  // to diff: whatever the tail read since the last poll is new by definition,
  // and a poll that read nothing pushes nothing. Primed here for the same
  // reason the two polls above are primed: the events already in the file when
  // this process booted are history, not news, and /api/events is how a client
  // catches up on them. (The priming call itself is made above, before the
  // lanes key is primed — see the AS-100 note there.)
  const eventsPoll = setInterval(() => {
    let fresh;
    try {
      fresh = tailEvents();
    } catch {
      return; // C7 again: a bad line never takes the server down
    }
    if (!fresh.length) return;
    // No visibleTo gate: the company stream is identical for every viewer,
    // same contract as the loop and lanes frames.
    for (const ev of fresh) {
      const frame = `event: company\ndata: ${JSON.stringify(ev)}\n\n`;
      for (const conn of streams) {
        try {
          conn.res.write(frame);
        } catch {
          streams.delete(conn);
        }
      }
    }
  }, eventsPollMs);
  eventsPoll.unref();

  // Sentinel key for handleApi results that are raw text (currently only
  // /api/dump's JSONL), sent as text/plain instead of a JSON envelope.
  const RAW_TEXT = Symbol('rawText');

  function handleApi(req, url, body) {
    const { pathname, searchParams } = url;
    const q = (k) => searchParams.get(k);

    if (req.method === 'GET' && pathname === '/api/identities') {
      return { identities: store.listIdentities() };
    }
    if (req.method === 'POST' && pathname === '/api/identities') {
      return { identity: store.registerIdentity({ id: body.id, displayName: body.displayName, kind: body.kind }) };
    }
    if (req.method === 'GET' && pathname === '/api/conversations') {
      const me = q('me');
      if (!me) throw new StoreError("Missing query parameter 'me'.");
      return { conversations: store.listConversationsFor(me) };
    }
    if (req.method === 'GET' && pathname === '/api/loop-status') {
      // AS-27: is the company running right now, or waiting on the board?
      // Nothing viewer-relative and nothing private: no 'me', no store, no
      // visibility filter — the answer is the same for everyone. The lock's
      // AS-16 `nonce` is the anti-spoof token and is never copied into this
      // payload (enforced in lib/loop-status.js, asserted in its tests).
      return { status: readLoopStatus() };
    }
    if (req.method === 'GET' && pathname === '/api/lanes') {
      // AS-99: what is in flight, one row per lane. Read-only and identical for
      // every viewer — no 'me', no store, no visibility filter, same contract as
      // /api/loop-status. The lane's `worktree` object is an exact-key
      // whitelist (lib/lanes.js), so a snapshot field added on the host cannot
      // reach a browser without a decision here.
      return { lanes: readLanes() };
    }
    if (req.method === 'GET' && pathname === '/api/events') {
      // AS-100: the company event log, read-only and identical for every
      // viewer — no 'me', no store, no visibility filter, same contract as
      // /api/lanes. Every event goes through projectEvent(), so a line that
      // grew a field on the host cannot reach a browser without a decision
      // here (AC-12). `since` is exclusive by id; unknown ids return nothing.
      return readEvents({ since: q('since'), task: q('task'), limit: q('limit') ?? 200 });
    }
    if (req.method === 'GET' && pathname === '/api/build') {
      // AS-75: what code is actually serving, first-hand. The watcher reads
      // this rather than a file the deployer wrote: a file records intent, this
      // records reality, and the difference between the two is the whole
      // subject of AS-75. Nothing viewer-relative, same as /api/loop-status.
      //
      // `id` is null for an image with no baked id AND for one stamped
      // `unknown` (a hand build) — neither can honestly claim to be a version.
      // `raw` keeps the two distinguishable for a human debugging a deploy.
      return { build: { id: BUILD_ID, raw: RAW_BUILD_ID, startedAt: SERVER_STARTED_AT } };
    }
    if (req.method === 'GET' && pathname === '/api/config') {
      // AS-93: the ONLY server configuration the browser is allowed to see, as
      // an EXPLICIT allowlist. Never spread process.env here, and never add a
      // field without asking whether a browser tab may hold it. Nothing
      // viewer-relative and nothing private: no 'me', no store — same contract
      // as /api/build. An exact key-set assertion in test/api.test.js stands
      // guard over exactly that temptation.
      //
      // null (not '') when unset: compose passes the variable through as an
      // empty string when the host has none, and AS-10 treats '' as unset.
      return { config: { latticeDashboardUrl: process.env.LATTICE_DASHBOARD_URL || null } };
    }
    if (req.method === 'GET' && pathname === '/api/org') {
      // AS-33: the org chart's data source — active employees with their
      // reporting edges, plus every rule violation. Nothing here is
      // viewer-relative and nothing is private: no 'me', no store, no Lattice
      // join. Validation runs over the UNFILTERED roster plus the skipped
      // files, because three of the nine rules exist precisely to catch what
      // the active filter throws away (an unparsed dossier, a duplicate
      // identity, a typo'd status).
      //
      // Same degradation contract as /api/roster, and for the same reason: a
      // malformed dossier or a missing mount must never take the server down.
      // A validator that refused to boot would invert that contract for the
      // worse — one bad frontmatter line would take out chat for everyone,
      // including the conversation needed to fix it. The chart tolerates a
      // broken graph and says so loudly; it does not withhold itself.
      let data = { roster: [], skipped: [], sources: [] };
      try {
        data = readPersonnel(root);
      } catch {
        // Empty org, 200, never a 500.
      }
      const employees = data.roster
        .filter((e) => e.status === 'active')
        .map((e) => ({
          actorId: e.actorId,
          name: e.name,
          title: e.title,
          class: e.class,
          team: e.team,
          reportsTo: e.reportsTo,
        }));
      return { employees, violations: validateOrg(data) };
    }
    if (req.method === 'GET' && pathname === '/api/roster') {
      // AS-8: company roster (personnel/ frontmatter) joined with current
      // work (Lattice) and DM state (chat DB). 'me' is optional since AS-24,
      // mirroring CLI semantics: without it the viewer-relative fields
      // (dmConversationId/unread/self) are omitted entirely. Reads personnel
      // frontmatter and Lattice assignment/status only (both repo-public);
      // never touches channels.
      const me = q('me') || null;
      if (me) store.requireIdentity(me);
      let employees = [];
      let assignments = {};
      try {
        employees = readRoster(root);
        assignments = assignmentsByActor(root);
      } catch {
        // Degradation contract: a missing mount or malformed file means an
        // empty roster (DM-only sidebar), never a down server.
      }
      const roster = employees
        .filter((e) => e.status === 'active')
        .map((e) => {
          const tasks = assignments[e.actorId] ?? [];
          const row = {
            actorId: e.actorId,
            name: e.name,
            title: e.title,
            class: e.class,
            team: e.team,
            reportsTo: e.reportsTo,
            registered: !!store.getIdentity(e.actorId),
            work: tasks[0] ?? null,
            moreTasks: Math.max(0, tasks.length - 1),
          };
          if (me) {
            const self = e.actorId === me;
            const dmId = self ? null : store.dmConversationFor(me, e.actorId);
            row.dmConversationId = dmId;
            row.unread = dmId == null ? 0 : store.unreadCountFor(me, dmId);
            row.self = self;
          }
          return row;
        });
      return { roster };
    }
    if (req.method === 'POST' && pathname === '/api/channels') {
      // AS-24 parity: visibility/members pass through (AS-22 added them to the
      // CLI only). Validation — including "members require private" — lives in
      // store.createChannel, so CLI and HTTP enforce identically.
      return {
        conversation: store.createChannel({
          name: body.name,
          purpose: body.purpose,
          actor: body.actor,
          visibility: body.visibility ?? undefined,
          members: body.members ?? null,
        }),
      };
    }
    if (req.method === 'POST' && pathname === '/api/dms') {
      return { conversation: store.openDm(body.me, body.other) };
    }
    if (req.method === 'GET' && pathname === '/api/messages') {
      const conversation = q('conversation');
      if (!conversation) throw new StoreError("Missing query parameter 'conversation'.");
      // AS-6: 'me' is required — the store gates reads on visibility, and a
      // hidden conversation 404s byte-identically to a nonexistent one.
      const me = q('me');
      if (!me) throw new StoreError("Missing query parameter 'me'.");
      // AS-25: ?since=<id> is the delta path (reconnect catch-up) — a flat,
      // id-ordered slice with replies included and NO threads key; the client
      // merges rows through the same applyMessage as live frames. Same bare
      // Number() coercion as ?limit=. Without since, behavior is unchanged
      // (structured cold-load shape).
      if (q('since') != null) {
        const { conversation: conv, messages } = store.messagesSince(conversation, me, Number(q('since')));
        return {
          conversation: { ...conv, members: conv.type === 'dm' ? store.dmMembers(conv.id) : undefined },
          messages: messages.map(annotate),
        };
      }
      // AS-24 parity: optional ?limit= mirrors CLI `history --limit N` (same
      // bare Number() coercion as the CLI; the store ignores non-numeric).
      const limit = q('limit') != null ? Number(q('limit')) : undefined;
      const { conversation: conv, messages, threads } = store.getMessages(conversation, me, { limit });
      return {
        conversation: { ...conv, members: conv.type === 'dm' ? store.dmMembers(conv.id) : undefined },
        messages: messages.map(annotate),
        threads: Object.fromEntries(Object.entries(threads).map(([k, v]) => [k, v.map(annotate)])),
      };
    }
    if (req.method === 'POST' && pathname === '/api/messages') {
      const message = store.postMessage({
        conversation: body.conversation,
        author: body.author,
        body: body.body,
        threadRoot: body.threadRoot ?? null,
      });
      return { message: annotate(message) };
    }
    if (req.method === 'GET' && pathname === '/api/unread') {
      const me = q('me');
      if (!me) throw new StoreError("Missing query parameter 'me'.");
      const groups = store.unreadFor(me).map((g) => ({ ...g, messages: g.messages.map(annotate) }));
      return { unread: groups };
    }
    if (req.method === 'POST' && pathname === '/api/read') {
      return { read: store.markRead(body.me, body.conversation, body.upTo ?? null) };
    }
    if (req.method === 'POST' && pathname === '/api/catchup') {
      // AS-24 parity: CLI `chat catchup` equivalent.
      if (!body.me) throw new StoreError("Missing body field 'me'.");
      return { conversations: store.catchupAll(body.me) };
    }
    if (req.method === 'POST' && pathname === '/api/sync') {
      // AS-24 parity: forced lattice ingest, bypassing the 10s throttle — the
      // CLI inbox/sync contract is "ingest now, then read". Resets the throttle
      // clock so the next maybeIngest() doesn't immediately re-scan.
      lastIngest = Date.now();
      return { posted: ingestNewEvents(store, root) };
    }
    if (req.method === 'GET' && pathname === '/api/dump') {
      // AS-24 parity: full-store JSONL, CLI `chat dump` equivalent. Operator
      // endpoint — bypasses visibility gates exactly like direct DB access
      // does; exposure unchanged (loopback-only trust domain, same operator
      // who can already read the DB file).
      return { [RAW_TEXT]: store.dumpLines().join('\n') + '\n' };
    }
    if (req.method === 'GET' && pathname === '/api/export') {
      // AS-24 parity: store.exportFiles() as JSON; the CLI writes the files
      // host-side. Operator endpoint — same trust-domain note as /api/dump.
      return { files: store.exportFiles() };
    }
    {
      const m = req.method === 'GET' && /^\/api\/task\/([A-Za-z]+-\d+)$/.exec(pathname);
      if (m) return { task: resolveShortId(m[1], root) };
    }
    if (req.method === 'GET' && pathname === '/api/file') {
      // AS-26 §5: in-app viewer for repo markdown. The gate does all the work.
      return readRepoMarkdown(root, q('path'));
    }
    {
      // AS-26: cross-conversation msg-ref resolver. Navigation data only —
      // no body, no author. Hidden target 404s byte-identically to a
      // nonexistent id (store.resolveMessage enforces the parity).
      const m = req.method === 'GET' && /^\/api\/message\/(\d+)$/.exec(pathname);
      if (m) {
        const me = q('me');
        if (!me) throw new StoreError("Missing query parameter 'me'.");
        return { message: store.resolveMessage(Number(m[1]), me) };
      }
    }
    throw new StoreError(`No such endpoint: ${req.method} ${pathname}`, 'not_found');
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, contentType, payload) => {
      res.writeHead(status, {
        'Content-Type': contentType,
        'Content-Security-Policy': "default-src 'self'",
        'Cache-Control': 'no-store',
      });
      res.end(payload);
    };
    const sendJson = (status, obj) => send(status, 'application/json; charset=utf-8', JSON.stringify(obj));

    // AS-25: SSE stream — handled outside handleApi (the raw res is held open,
    // never wrapped in the JSON envelope). Identity is validated first: an
    // unknown/missing 'me' gets the normal JSON error envelope, never a stream.
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      maybeIngest();
      try {
        const me = url.searchParams.get('me');
        if (!me) throw new StoreError("Missing query parameter 'me'.");
        store.requireIdentity(me);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Content-Security-Policy': "default-src 'self'",
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        res.write(':connected\n\n'); // flushes headers; EventSource fires open
        const conn = { res, me };
        streams.add(conn);
        res.on('close', () => streams.delete(conn));
        // AS-27: one loop frame immediately, after registration — a
        // reconnecting client is current without issuing a fetch, and it
        // arrives before any message frame this connection will ever see.
        try {
          res.write(`event: loop\ndata: ${JSON.stringify(readLoopStatus())}\n\n`);
          // AS-99: and one lanes frame, after the loop frame — a reconnecting
          // client renders the pane without issuing a fetch, and the order is
          // fixed so test/stream.test.js can consume both deterministically.
          res.write(`event: lanes\ndata: ${JSON.stringify({ lanes: readLanes() })}\n\n`);
        } catch {
          streams.delete(conn);
        }
      } catch (e) {
        if (e instanceof StoreError) return sendJson(storeErrorStatus(e), { error: e.message });
        console.error(e);
        return sendJson(500, { error: 'Internal error.' });
      }
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      maybeIngest();
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 1_000_000) req.destroy();
      });
      req.on('end', () => {
        let body = {};
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            return sendJson(400, { error: 'Request body must be valid JSON.' });
          }
        }
        try {
          const result = handleApi(req, url, body);
          if (result && result[RAW_TEXT] !== undefined) {
            return send(200, 'text/plain; charset=utf-8', result[RAW_TEXT]);
          }
          return sendJson(200, result);
        } catch (e) {
          if (e instanceof StoreError) {
            return sendJson(storeErrorStatus(e), { error: e.message });
          }
          console.error(e);
          return sendJson(500, { error: 'Internal error.' });
        }
      });
      return;
    }

    const entry = STATIC_FILES[url.pathname];
    if (req.method === 'GET' && entry) {
      const [file, type] = entry;
      return send(200, type, readFileSync(join(APP_DIR, 'public', file)));
    }
    sendJson(404, { error: 'Not found.' });
  });

  return {
    server,
    store,
    close: () =>
      new Promise((done) => {
        // AS-25: reap push state FIRST — the heartbeat timer and held-open
        // stream responses would otherwise wedge server.close() (it waits for
        // live connections) and keep the event loop (and any test suite)
        // alive forever. end() then destroy(): flush the goodbye, then make
        // sure the socket is actually gone.
        clearInterval(heartbeat);
        clearInterval(loopPoll); // AS-27: same reason as the heartbeat above
        clearInterval(lanesPoll); // AS-99: and the same reason again
        clearInterval(eventsPoll); // AS-100: and once more, for the tail
        for (const conn of streams) {
          try {
            conn.res.end();
            conn.res.destroy();
          } catch {
            // Already dead — reaping is best-effort by definition.
          }
        }
        streams.clear();
        server.close(() => {
          store.close();
          done();
        });
      }),
  };
}

// Run directly: bind localhost and serve.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8347);
  const bind = process.env.CHAT_BIND || '127.0.0.1';
  const { server } = createChatServer();
  server.listen(port, bind, () => {
    console.log(`chat server listening on http://${bind}:${port}/`);
  });
  const shutdown = () => {
    console.log('\nshutting down');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
