// lib/events.js — AS-100: the company event stream, pure core.
//
// One stream, many projections (CLAUDE.md § "Observability north star"). This
// module is the ONLY implementation of the envelope, the parser, the fold and
// the outcome rules; the emit CLI (bin/events.js), the watcher's reconciler
// (watch/advance-watcher.mjs) and the server's tail all import from here so
// the three can never drift into three dialects of the same file format.
//
// PURE: no fs, no clock, no process at module scope. Every effect is an
// injectable argument with a default — which is what lets the reconciler's
// rules be unit tests against a planted array instead of a live tick.
//
// The stream is a SOURCE; projectEvent() is the CONTRACT. Keys emitted to a
// browser are an exact whitelist (AS-27's rule, applied to a third file), so a
// line that grows a field tomorrow cannot leak it into a page today.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes as cryptoRandomBytes } from 'node:crypto';

/** Envelope keys, in the sorted order every line is serialised in. Byte-shape
 *  compatible with .lattice/events so one parser reads both streams (AC-1). */
export const ENVELOPE_KEYS = Object.freeze([
  'actor',
  'data',
  'id',
  'schema_version',
  'task_id',
  'ts',
  'type',
]);

export const SCHEMA_VERSION = 1;

/** Max bytes for one serialised line, newline included. Every shape below is
 *  well under 1 KiB; the cap is what keeps a single O_APPEND write atomic on
 *  the filesystems we run on, so a refused line is better than a torn one. */
export const MAX_LINE_BYTES = 8192;

export const STAGES = Object.freeze(['plan', 'implement', 'review']);
export const STAGE_OUTCOMES = Object.freeze(['completed', 'error', 'cut_by_timeout', 'unclosed']);
export const SUBAGENT_EXITS = Object.freeze(['ok', 'error', 'cut_by_timeout', 'unclosed']);
export const TICK_OUTCOMES = Object.freeze(['ok', 'timeout', 'error', 'noop']);
export const CLOSED_BY = Object.freeze(['orchestrator', 'watcher-settle', 'watcher-sweep']);

/** Outcomes only the reconciler may write. The CLI's enums are narrower on
 *  purpose (T3): an orchestrator must not be able to narrate a timeout that
 *  did not happen. */
export const RECONCILER_ONLY_OUTCOMES = Object.freeze(['cut_by_timeout', 'unclosed']);

/** The six types and the exact key list of each `data`. This table is the
 *  projection whitelist, the validator's required-key list, and the
 *  documentation, in that order of load-bearingness. */
export const EVENT_SHAPES = Object.freeze({
  tick_started: Object.freeze(['source', 'pid', 'startedAt', 'messageId', 'loopTick']),
  tick_ended: Object.freeze([
    'tickId', 'outcome', 'code', 'signal', 'timedOut', 'headMoved', 'lanesTouched', 'stagesClosed', 'reason',
  ]),
  stage_started: Object.freeze(['task', 'stage', 'actor', 'worktree', 'branch', 'cycle']),
  // AS-111 F4: `cycle` is appended LAST so every existing key keeps its
  // position, and makeEvent fills it null for every producer that does not
  // state one — nothing that emits today breaks.
  stage_ended: Object.freeze([
    'task', 'stage', 'actor', 'outcome', 'reason', 'closedBy', 'startedId', 'durationS', 'cycle',
  ]),
  subagent_spawned: Object.freeze(['task', 'stage', 'actor', 'model']),
  subagent_exited: Object.freeze([
    'task', 'stage', 'actor', 'exit', 'closedBy', 'spawnedId', 'durationS', 'tokens', 'costUsd',
  ]),
});

export const EVENT_TYPES = Object.freeze(Object.keys(EVENT_SHAPES));

/** The reason codes /api/events and the lanes projection's `events` may report.
 *  Exported so the UI label table is key-set asserted against it (AC-18). */
export const EVENTS_REASON_CODES = Object.freeze([
  'ok',
  'no-stream',
  'unreadable-stream',
  'truncated',
]);

export const ACTOR_RE = /^(agent|human|system):[a-z0-9-]+$/;

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LEN = 10;
const RAND_LEN = 16;
const RAND_MAX = (1n << 80n) - 1n;

let lastMs = -1;
let lastRand = 0n;

function encodeBase32(value, len) {
  let out = '';
  let v = BigInt(value);
  for (let i = 0; i < len; i += 1) {
    out = CROCKFORD[Number(v & 31n)] + out;
    v >>= 5n;
  }
  return out;
}

/**
 * `cev_` + a 26-char Crockford ULID: 48-bit ms time, 80 random bits,
 * monotonic within one process (a same-ms collision increments the random
 * part rather than rolling fresh bits, so ids are strictly increasing and
 * `?since=<id>` is a plain string compare — AC-2).
 *
 * The `cev_` prefix is deliberate: a consumer that dedupes this stream and
 * Lattice's `ev_` stream by id must never be able to collide them.
 */
export function ulid({ nowMs = Date.now(), randomBytes = cryptoRandomBytes } = {}) {
  const ms = Math.floor(nowMs);
  if (ms === lastMs) {
    lastRand = lastRand >= RAND_MAX ? 0n : lastRand + 1n;
  } else {
    lastMs = ms;
    let v = 0n;
    for (const byte of randomBytes(10)) v = (v << 8n) | BigInt(byte);
    lastRand = v & RAND_MAX;
  }
  return `cev_${encodeBase32(ms, TIME_LEN)}${encodeBase32(lastRand, RAND_LEN)}`;
}

// ---------------------------------------------------------------------------
// making and writing events
// ---------------------------------------------------------------------------

class EventError extends Error {}

function fail(message) {
  throw new EventError(message);
}

function checkEnum(type, key, value, allowed, { optional = false } = {}) {
  if (value === null || value === undefined) {
    if (optional) return;
    fail(`${type}: ${key} is required`);
  }
  if (!allowed.includes(value)) fail(`${type}: ${key} must be one of ${allowed.join('|')} (got ${JSON.stringify(value)})`);
}

/** A stated cycle is a positive integer; null/undefined is "not stated". */
function checkCycle(type, cycle) {
  if (cycle === null || cycle === undefined) return;
  if (!Number.isInteger(cycle) || cycle < 1) fail(`${type}: cycle must be a positive integer`);
}

function validate(type, data) {
  switch (type) {
    case 'stage_started':
      checkEnum(type, 'stage', data.stage, STAGES);
      checkCycle(type, data.cycle);
      break;
    case 'stage_ended':
      checkEnum(type, 'stage', data.stage, STAGES);
      checkEnum(type, 'outcome', data.outcome, STAGE_OUTCOMES);
      checkEnum(type, 'closedBy', data.closedBy, CLOSED_BY, { optional: true });
      checkCycle(type, data.cycle);
      break;
    case 'subagent_spawned':
      checkEnum(type, 'stage', data.stage, STAGES);
      break;
    case 'subagent_exited':
      checkEnum(type, 'stage', data.stage, STAGES);
      checkEnum(type, 'exit', data.exit, SUBAGENT_EXITS);
      checkEnum(type, 'closedBy', data.closedBy, CLOSED_BY, { optional: true });
      break;
    case 'tick_ended':
      checkEnum(type, 'outcome', data.outcome, TICK_OUTCOMES);
      break;
    default:
      break;
  }
  if (['stage_started', 'stage_ended', 'subagent_spawned', 'subagent_exited'].includes(type)) {
    if (typeof data.task !== 'string' || !data.task) fail(`${type}: task is required`);
    if (typeof data.actor !== 'string' || !ACTOR_RE.test(data.actor)) {
      fail(`${type}: actor must match ${ACTOR_RE}`);
    }
  }
}

/**
 * Build one envelope. Throws on an unknown type, an unknown `data` key, a
 * missing required field or an enum violation — validation is exhaustive
 * BEFORE anything is written, so a refused emit writes zero bytes (AC-4).
 */
export function makeEvent({ type, actor, taskId = null, data = {}, now = new Date(), id = null, idFactory = ulid }) {
  if (!EVENT_TYPES.includes(type)) fail(`unknown event type: ${type}`);
  if (typeof actor !== 'string' || !ACTOR_RE.test(actor)) fail(`actor must match ${ACTOR_RE}`);
  const shape = EVENT_SHAPES[type];
  for (const key of Object.keys(data)) {
    if (!shape.includes(key)) fail(`${type}: unknown data key ${key}`);
  }
  validate(type, data);
  const filled = {};
  for (const key of shape) filled[key] = data[key] === undefined ? null : data[key];
  const ts = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  return {
    actor,
    data: filled,
    id: id ?? idFactory({ nowMs: Date.parse(ts) }),
    schema_version: SCHEMA_VERSION,
    task_id: taskId ?? null,
    ts,
    type,
  };
}

function sortedStringify(value) {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const out = {};
      for (const key of Object.keys(val).sort()) out[key] = val[key];
      return out;
    }
    return val;
  });
}

/** One serialised line, sorted keys, no newline. */
export function serialiseEvent(ev) {
  return sortedStringify(ev);
}

/**
 * Append one event. One line, one write syscall, O_APPEND — the only write
 * path in this module, and there is deliberately no path here that can
 * shorten the file (AC-3).
 */
export function appendEvent(path, ev, { append = appendFileSync, mkdir = mkdirSync } = {}) {
  const line = `${serialiseEvent(ev)}\n`;
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes > MAX_LINE_BYTES) fail(`event line is ${bytes} bytes, over the ${MAX_LINE_BYTES} byte cap`);
  mkdir(dirname(path), { recursive: true });
  append(path, line);
  return ev;
}

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/**
 * Tolerant JSONL parse — the rule readTaskEvents has always used, lifted here
 * so both streams share one parser (AC-1). A malformed line is counted and
 * skipped: ingestion never crashes on someone else's file.
 */
export function parseJsonl(text) {
  const events = [];
  let malformed = 0;
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev && ev.id) events.push(ev);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { events, malformed };
}

export function sortEvents(events) {
  return [...events].sort((a, b) =>
    a.ts === b.ts ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.ts < b.ts ? -1 : 1
  );
}

/** Read the whole stream. A missing file is `no-stream`, not an error: a
 *  pre-AS-100 watcher writes no file and that is a fact, not a fault. */
export function readStream(path, { readFile = readFileSync } = {}) {
  let text;
  try {
    text = readFile(path, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { events: [], malformed: 0, reason: 'no-stream' };
    return { events: [], malformed: 0, reason: 'unreadable-stream' };
  }
  const { events, malformed } = parseJsonl(text);
  const reason = events.length === 0 && malformed > 0 ? 'unreadable-stream' : 'ok';
  return { events: sortEvents(events), malformed, reason };
}

// ---------------------------------------------------------------------------
// the fold — what "open" means, derived from the stream every time
// ---------------------------------------------------------------------------

export function emptyFold() {
  return { lanes: {}, tick: null };
}

function tsMs(ts) {
  const v = Date.parse(ts);
  return Number.isFinite(v) ? v : null;
}

function durationBetween(startTs, endTs) {
  const a = tsMs(startTs);
  const b = tsMs(endTs);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 1000);
}

function matches(open, ev, idKey) {
  if (!open) return false;
  const declared = ev.data?.[idKey];
  if (declared) return declared === open.id;
  // The fallback, for a close emitted WITHOUT the id of its own open event —
  // what the CLI produces when an orchestrator closes a stage by hand. The
  // lane is keyed by `data.task` and `open` came out of that lane, so the task
  // already matches by construction; comparing `open.task` (which the fold
  // does not store on the stage or sub record) made this whole branch
  // unreachable, and every hand-closed stage stayed open until the sweep cut
  // it as a timeout. Found by api-events-since-exclusive, whose planted
  // stage_ended carries a null startedId exactly as `events close` emits one.
  if (open.stage !== ev.data?.stage || open.actor !== ev.data?.actor) return false;
  // AS-111 F4: the triple is not unique across rework cycles. A mismatch
  // exists only when BOTH sides state a cycle and they differ — a null on
  // either side ("not stated") matches on the triple as before, so a hand
  // close without --cycle never strands. Sub-agent records carry no `cycle`
  // (undefined), so sub-agent closes are untouched by construction.
  if (ev.data?.cycle != null && open.cycle != null && ev.data.cycle !== open.cycle) return false;
  return true;
}

function lastEventOf(ev, outcome = null) {
  return { id: ev.id, type: ev.type, ts: ev.ts, outcome: outcome ?? null };
}

/**
 * Fold one event into the liveness state. Mutates and returns `state` so the
 * incremental tail and the batch reducer are literally the same code path —
 * AC-15 holds the two equal over any prefix split.
 */
export function foldEvent(state, ev) {
  if (!ev || typeof ev !== 'object') return state;
  const data = ev.data && typeof ev.data === 'object' ? ev.data : {};
  const task = typeof data.task === 'string' ? data.task : null;
  const lane = task ? state.lanes[task] : null;
  switch (ev.type) {
    case 'tick_started':
      state.tick = { id: ev.id, ts: ev.ts, source: data.source ?? null, lanesTouched: [], stagesStarted: 0 };
      break;
    case 'tick_ended':
      state.tick = null;
      break;
    case 'stage_started': {
      if (!task) break;
      state.lanes[task] = {
        stage: {
          id: ev.id,
          ts: ev.ts,
          stage: data.stage ?? null,
          actor: data.actor ?? null,
          worktree: data.worktree ?? null,
          branch: data.branch ?? null,
          cycle: data.cycle ?? null,
          open: true,
          endedTs: null,
          outcome: null,
          durationS: null,
        },
        sub: null,
        lastEvent: lastEventOf(ev),
      };
      if (state.tick) {
        state.tick.stagesStarted += 1;
        if (!state.tick.lanesTouched.includes(task)) state.tick.lanesTouched.push(task);
      }
      break;
    }
    case 'stage_ended': {
      if (!lane || !lane.stage) break;
      if (lane.stage.open && matches(lane.stage, ev, 'startedId')) {
        lane.stage.open = false;
        lane.stage.endedTs = ev.ts;
        lane.stage.outcome = data.outcome ?? null;
        lane.stage.durationS = Number.isFinite(data.durationS)
          ? data.durationS
          : durationBetween(lane.stage.ts, ev.ts);
      }
      lane.lastEvent = lastEventOf(ev, data.outcome ?? null);
      break;
    }
    case 'subagent_spawned': {
      if (!lane) break; // an orphan sub-agent never invents a lane (AC-15)
      lane.sub = {
        id: ev.id,
        ts: ev.ts,
        stage: data.stage ?? null,
        actor: data.actor ?? null,
        open: true,
        endedTs: null,
        exit: null,
        durationS: null,
      };
      lane.lastEvent = lastEventOf(ev);
      break;
    }
    case 'subagent_exited': {
      if (!lane) break;
      if (lane.sub && lane.sub.open && matches(lane.sub, ev, 'spawnedId')) {
        lane.sub.open = false;
        lane.sub.endedTs = ev.ts;
        lane.sub.exit = data.exit ?? null;
        lane.sub.durationS = Number.isFinite(data.durationS)
          ? data.durationS
          : durationBetween(lane.sub.ts, ev.ts);
      }
      lane.lastEvent = lastEventOf(ev, data.exit ?? null);
      break;
    }
    default:
      break;
  }
  return state;
}

export function foldEvents(events, state = emptyFold()) {
  for (const ev of events) foldEvent(state, ev);
  return state;
}

/**
 * The open set — derived from the stream, never stored (AC-9). There is no
 * open-set file and nothing the orchestrator has to tell the watcher: if its
 * own stage_ended landed, the next read simply sees the stage closed.
 */
export function openItems(events) {
  const state = events && events.lanes ? events : foldEvents(events ?? []);
  const stages = [];
  const subagents = [];
  for (const [task, lane] of Object.entries(state.lanes)) {
    if (lane.stage?.open) {
      stages.push({
        id: lane.stage.id,
        ts: lane.stage.ts,
        task,
        stage: lane.stage.stage,
        actor: lane.stage.actor,
        worktree: lane.stage.worktree,
        branch: lane.stage.branch,
        cycle: lane.stage.cycle,
      });
    }
    if (lane.sub?.open) {
      subagents.push({
        id: lane.sub.id,
        ts: lane.sub.ts,
        task,
        stage: lane.sub.stage,
        actor: lane.sub.actor,
      });
    }
  }
  return { stages, subagents, tick: state.tick };
}

/**
 * Liveness, per lane, keyed by `data.task` ↔ AS-99's `lane.key`.
 *
 * `alive = open ∧ (tickLive ∨ age < tickTimeoutMs)`: while a tick holds its
 * lock every open stage is alive (settle() will close it the moment the tick
 * ends); with no lock held an open stage is alive for at most the tick box,
 * after which the UI reads the pair (alive:false, lastEvent.type ===
 * 'stage_started') as "no signal since HH:MM" — never as "running".
 */
export function reduceLiveness(events, { nowMs, tickLive = false, tickTimeoutMs = 30 * 60_000 } = {}) {
  const state = events && events.lanes ? events : foldEvents(events ?? []);
  const out = {};
  for (const [task, lane] of Object.entries(state.lanes)) {
    if (!lane.stage) continue;
    const sub = lane.sub;
    const startedAt = sub ? sub.ts : lane.stage.ts;
    const open = lane.stage.open && (sub ? sub.open : true);
    const startMs = tsMs(startedAt);
    const ageMs = startMs === null ? 0 : nowMs - startMs;
    const alive = open && (tickLive || ageMs < tickTimeoutMs);
    const ended = sub && !sub.open ? sub : !lane.stage.open ? lane.stage : null;
    const elapsedS = open
      ? startMs === null ? null : Math.round((nowMs - startMs) / 1000)
      : ended?.durationS ?? durationBetween(startedAt, ended?.endedTs ?? null);
    out[task] = {
      stageStartedAt: lane.stage.ts,
      subAgent: {
        actor: sub ? sub.actor : lane.stage.actor,
        stage: lane.stage.stage,
        alive,
        startedAt,
        elapsedS,
        lastEvent: { ...lane.lastEvent },
      },
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// projection and outcome rules
// ---------------------------------------------------------------------------

/** Envelope keys exact, `data` keys exactly EVENT_SHAPES[type]: a line that
 *  grew a field never reaches a browser (AC-12). Unknown type → null. */
export function projectEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const shape = EVENT_SHAPES[ev.type];
  if (!shape) return null;
  const data = ev.data && typeof ev.data === 'object' ? ev.data : {};
  const out = {};
  for (const key of shape) out[key] = data[key] === undefined ? null : data[key];
  return {
    actor: typeof ev.actor === 'string' ? ev.actor : null,
    data: out,
    id: ev.id,
    schema_version: Number.isFinite(ev.schema_version) ? ev.schema_version : null,
    task_id: ev.task_id ?? null,
    ts: typeof ev.ts === 'string' ? ev.ts : null,
    type: ev.type,
  };
}

function childFailed(code, signal) {
  return Boolean(signal) || (code !== null && code !== undefined && code !== 0);
}

/** How a tick ended (AC-6). A tick that started no stage and moved no commit
 *  is a `noop` — the honest word for a tick that reported and did nothing. */
export function tickOutcome({ code = null, signal = null, timedOut = false, stagesStarted = 0, headMoved = false } = {}) {
  if (timedOut) return 'timeout';
  if (childFailed(code, signal)) return 'error';
  if (!stagesStarted && !headMoved) return 'noop';
  return 'ok';
}

/**
 * How a stage still open at tick end is closed (AC-7, AC-10). `unclosed` is
 * deliberate: a clean exit with an open stage means the orchestrator never
 * emitted stage_ended, and recording that as `completed` would invent a fact
 * while recording it as `error` would blame the stage for the omission.
 */
export function stageCloseOutcome({ code = null, signal = null, timedOut = false } = {}) {
  if (timedOut) return 'cut_by_timeout';
  if (childFailed(code, signal)) return 'error';
  return 'unclosed';
}
