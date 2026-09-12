#!/usr/bin/env node
// bin/events.js — AS-100: the company event stream's producer CLI.
//
// The orchestrator runs this at each stage boundary (.claude/commands/advance.md);
// the watcher emits tick_* itself and never shells out here. Zero dependencies,
// node:* only, the bin/chat.js mould.
//
// It never opens the chat DB and never talks to the server: the stream is a
// host file this CLI owns end to end, so the AS-24 server-vs-direct question
// does not arise here at all.
//
//   events emit <type> --actor <emitter> [type flags] [--json]
//   events tail [--since <id>] [--limit <n>] [--task AS-<n>] [--json]
//   events open [--json]
//
// `--actor` is the EMITTER (who ran the command); `--employee` is who the stage
// is about (data.actor). Neither defaults from the other: "who decided" and
// "who is doing the work" are different questions and the record should not
// guess at either.
import { join } from 'node:path';
import {
  EVENT_TYPES,
  STAGES,
  appendEvent,
  makeEvent,
  openItems,
  readStream,
} from '../lib/events.js';
import { idsByShortId, latticeRoot } from '../lib/lattice.js';

const USAGE = `usage:
  events emit stage_started    --task AS-<n> --stage plan|implement|review --employee <id> --actor <id> [--worktree <rel>] [--branch <name>] [--cycle <k>] [--json]
  events emit stage_ended      --task AS-<n> --stage <stage> --employee <id> --actor <id> --outcome completed|error [--reason "…"] [--json]
  events emit subagent_spawned --task AS-<n> --stage <stage> --employee <id> --actor <id> [--model <name>] [--json]
  events emit subagent_exited  --task AS-<n> --stage <stage> --employee <id> --actor <id> --exit ok|error [--json]
  events emit tick_started|tick_ended --actor <id> [watcher flags] [--json]
  events tail [--since <id>] [--limit <n>] [--task AS-<n>] [--json]
  events open [--json]

stream: $CHAT_EVENTS_PATH, else <repo>/apps/chat/data/events/company.jsonl`;

// Only the reconciler may say a stage was cut or left unclosed — an
// orchestrator must not be able to narrate a timeout that did not happen.
const CLI_STAGE_OUTCOMES = ['completed', 'error'];
const CLI_SUBAGENT_EXITS = ['ok', 'error'];

const FLAGS = [
  'actor', 'employee', 'task', 'stage', 'worktree', 'branch', 'cycle',
  'outcome', 'reason', 'model', 'exit', 'since', 'limit',
  'source', 'pid', 'startedAt', 'messageId', 'loopTick', 'tickId',
  'code', 'signal', 'closedBy', 'startedId', 'spawnedId',
];

function fail(message) {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
    } else if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!FLAGS.includes(name)) fail(`unknown flag: ${arg}`);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`flag ${arg} needs a value`);
      flags[name] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function streamPath() {
  if (process.env.CHAT_EVENTS_PATH) return process.env.CHAT_EVENTS_PATH;
  const root = latticeRoot();
  return join(root, 'apps', 'chat', 'data', 'events', 'company.jsonl');
}

function require_(flags, name, type) {
  const value = flags[name];
  if (value === undefined || value === '') fail(`${type}: --${name} is required`);
  return value;
}

function oneOf(flags, name, allowed, type) {
  const value = require_(flags, name, type);
  if (!allowed.includes(value)) fail(`${type}: --${name} must be one of ${allowed.join('|')} (got ${value})`);
  return value;
}

function intFlag(flags, name, { min = 1 } = {}) {
  if (flags[name] === undefined) return null;
  const n = Number(flags[name]);
  if (!Number.isInteger(n) || n < min) fail(`--${name} must be an integer >= ${min}`);
  return n;
}

/** A short id that does not resolve still emits, with task_id null and one
 *  stderr warning: a missing join must never lose the record (T1). */
function resolveTask(short) {
  if (!short) return null;
  try {
    const id = idsByShortId(latticeRoot())[short] ?? null;
    if (!id) process.stderr.write(`warning: ${short} does not resolve to a Lattice task; emitting with task_id: null\n`);
    return id;
  } catch {
    process.stderr.write(`warning: could not read the Lattice id map; emitting with task_id: null\n`);
    return null;
  }
}

/** Best effort back-reference to the open item this event closes, so a
 *  consumer can pair them without re-folding. Null when there is none — the
 *  event is still written. */
function closing(path, type, data) {
  const { events } = readStream(path);
  const open = openItems(events);
  const list = type === 'stage_ended' ? open.stages : open.subagents;
  const match = list.find((item) => item.task === data.task && item.stage === data.stage && item.actor === data.actor);
  if (!match) return { id: null, durationS: null };
  const started = Date.parse(match.ts);
  return { id: match.id, durationS: Number.isFinite(started) ? Math.round((Date.now() - started) / 1000) : null };
}

function buildData(type, flags) {
  switch (type) {
    case 'stage_started':
      return {
        task: require_(flags, 'task', type),
        stage: oneOf(flags, 'stage', STAGES, type),
        actor: require_(flags, 'employee', type),
        worktree: flags.worktree ?? null,
        branch: flags.branch ?? null,
        cycle: intFlag(flags, 'cycle'),
      };
    case 'stage_ended':
      return {
        task: require_(flags, 'task', type),
        stage: oneOf(flags, 'stage', STAGES, type),
        actor: require_(flags, 'employee', type),
        outcome: oneOf(flags, 'outcome', CLI_STAGE_OUTCOMES, type),
        reason: flags.reason ?? null,
        closedBy: 'orchestrator',
        startedId: null,
        durationS: null,
      };
    case 'subagent_spawned':
      return {
        task: require_(flags, 'task', type),
        stage: oneOf(flags, 'stage', STAGES, type),
        actor: require_(flags, 'employee', type),
        model: flags.model ?? null,
      };
    case 'subagent_exited':
      return {
        task: require_(flags, 'task', type),
        stage: oneOf(flags, 'stage', STAGES, type),
        actor: require_(flags, 'employee', type),
        exit: oneOf(flags, 'exit', CLI_SUBAGENT_EXITS, type),
        closedBy: 'orchestrator',
        spawnedId: null,
        durationS: null,
        tokens: null,
        costUsd: null,
      };
    case 'tick_started':
      return {
        source: flags.source ?? 'watcher',
        pid: intFlag(flags, 'pid'),
        startedAt: flags.startedAt ?? new Date().toISOString(),
        messageId: flags.messageId ?? null,
        loopTick: intFlag(flags, 'loopTick'),
      };
    case 'tick_ended':
      return {
        tickId: flags.tickId ?? null,
        outcome: oneOf(flags, 'outcome', ['ok', 'timeout', 'error', 'noop'], type),
        code: intFlag(flags, 'code', { min: 0 }),
        signal: flags.signal ?? null,
        timedOut: false,
        headMoved: false,
        lanesTouched: [],
        stagesClosed: 0,
        reason: flags.reason ?? null,
      };
    default:
      return fail(`unknown event type: ${type}`);
  }
}

function cmdEmit(positional, flags) {
  const type = positional[1];
  if (!type) fail('emit: an event type is required');
  if (!EVENT_TYPES.includes(type)) fail(`unknown event type: ${type}`);
  const actor = require_(flags, 'actor', type);
  const data = buildData(type, flags);
  const path = streamPath();
  if (type === 'stage_ended' || type === 'subagent_exited') {
    const back = closing(path, type, data);
    if (type === 'stage_ended') data.startedId = back.id;
    else data.spawnedId = back.id;
    data.durationS = back.durationS;
  }
  let ev;
  try {
    ev = makeEvent({ type, actor, taskId: resolveTask(data.task ?? null), data });
  } catch (err) {
    fail(err.message);
  }
  try {
    appendEvent(path, ev);
  } catch (err) {
    fail(err.message);
  }
  process.stdout.write(`${flags.json ? JSON.stringify(ev) : ev.id}\n`);
}

function cmdTail(flags) {
  const { events, malformed, reason } = readStream(streamPath());
  let rows = events;
  if (flags.task) rows = rows.filter((ev) => ev.data?.task === flags.task);
  if (flags.since) rows = rows.filter((ev) => ev.id > flags.since);
  const limit = Math.min(intFlag(flags, 'limit') ?? 200, 1000);
  rows = rows.slice(-limit);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ stream: { reason, malformed, count: rows.length }, events: rows })}\n`);
    return;
  }
  for (const ev of rows) {
    const bits = [ev.ts, ev.type, ev.data?.task ?? '', ev.data?.stage ?? '', ev.data?.actor ?? ev.actor];
    process.stdout.write(`${bits.filter(Boolean).join('  ')}\n`);
  }
  if (reason !== 'ok') process.stderr.write(`stream: ${reason}\n`);
}

function cmdOpen(flags) {
  const { events, reason } = readStream(streamPath());
  const open = openItems(events);
  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ stream: { reason }, ...open })}\n`);
    return;
  }
  if (open.tick) process.stdout.write(`tick  ${open.tick.ts}  ${open.tick.source ?? ''}\n`);
  for (const s of open.stages) process.stdout.write(`stage  ${s.task}  ${s.stage}  ${s.actor}  since ${s.ts}\n`);
  for (const s of open.subagents) process.stdout.write(`subagent  ${s.task}  ${s.stage}  ${s.actor}  since ${s.ts}\n`);
  if (!open.tick && !open.stages.length && !open.subagents.length) process.stdout.write('nothing open\n');
}

function main(argv) {
  const { positional, flags } = parseArgs(argv);
  switch (positional[0]) {
    case 'emit': return cmdEmit(positional, flags);
    case 'tail': return cmdTail(flags);
    case 'open': return cmdOpen(flags);
    default: return fail(positional[0] ? `unknown command: ${positional[0]}` : 'a command is required');
  }
}

main(process.argv.slice(2));
