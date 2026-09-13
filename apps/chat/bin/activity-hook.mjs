#!/usr/bin/env node
// bin/activity-hook.mjs — AS-103: the live-activity producer.
//
// One harness tool call in on stdin (the PreToolUse hook payload), one small
// POST out to the chat server's /api/activity, nothing else. Wired from
// .claude/settings.json by the METAWORK LAYER, never by an employee — the plan's
// appendix carries the exact block.
//
// THREE HARD RULES, in priority order over everything else this script does:
//
//   1. ALWAYS EXIT 0. A non-zero hook exit can block the tool call it is
//      reporting on. An observability layer that can fail a tick is worse than
//      no observability layer.
//   2. WRITE NOTHING to stdout or stderr. The harness surfaces both; a chat
//      server that is merely down must not put a line in an employee's console.
//   3. SELF-BOUND AT 250 ms. The settings block also carries `timeout: 2`, but
//      that is the harness's backstop, not this script's contract.
//
// It reads exactly three fields — `cwd`, `tool_name`, `tool_input` — which are
// common to PreToolUse and PostToolUse. That is deliberate: switching which
// event fires it stays a one-word edit in settings, with no change here.
//
// NOTE FOR ANYONE TIDYING THIS UP: the `.catch()` on the fetch below is the
// whole of rule 1 on the no-listener path, and `main()` is deliberately NOT
// wrapped in a try/catch that would make it redundant. Removing it is a red
// (AC-12/M11 in test/activity.test.js), not a simplification.

import { coarseObject } from '../lib/activity.js';

/** The wall-clock bound this script promises the harness. */
const DEADLINE_MS = 250;

/** Loopback only, and the same port the compose file publishes. Overridable so
 *  the test battery can point a spawned child at an ephemeral port. */
const URL_DEFAULT = 'http://127.0.0.1:8347/api/activity';

/** Enough for any real hook payload; a stdin larger than this is not one. */
const STDIN_MAX = 1_000_000;

const controller = new AbortController();
// unref'd on purpose: with the fetch (or the stdin read) in flight something
// else holds the loop open and this fires on time, and with nothing in flight
// there is nothing to bound — the process is already exiting.
const deadline = setTimeout(() => {
  try {
    controller.abort();
  } catch {
    // aborting an already-settled request is not a failure mode we report
  }
  process.exit(0);
}, DEADLINE_MS);
deadline.unref();

/** Never rejects, never throws: a stdin that errors mid-read is an empty
 *  payload, which main() turns into a silent exit 0. */
async function readStdin() {
  let out = '';
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      out += chunk;
      if (out.length > STDIN_MAX) return '';
    }
  } catch {
    return '';
  }
  return out;
}

async function main() {
  // The kill switch: set in the environment, honoured before anything is read
  // or sent. One variable turns the whole producer off without touching
  // .claude/settings.json (which employees may not edit anyway).
  if (process.env.CHAT_ACTIVITY_OFF === '1') return;

  const raw = await readStdin();
  if (!raw) return;

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // garbage stdin is not an error worth a byte of stderr
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

  const tool = payload.tool_name;
  if (typeof tool !== 'string' || !tool) return;
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : null;

  // Reduced HERE, in the process that can see the whole input. What crosses the
  // socket is a relative path, a program name, a hostname, a subagent type, or
  // null — never a command line, a search pattern, or a file body.
  const object = coarseObject(tool, payload.tool_input, cwd);

  await fetch(process.env.CHAT_ACTIVITY_URL || URL_DEFAULT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd, tool, object }),
    signal: controller.signal,
  }).catch(() => {}); // rule 1 on the no-listener path — see the note above
}

main().then(() => {
  clearTimeout(deadline);
  process.exit(0);
});
