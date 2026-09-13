// AS-103 AC-15: the browser walk — a posted frame becomes a `now:` line, the
// line decays, and a reload leaves it blank without asking anyone for it.
//
// Driven with the DOM shim pattern from test/message-pane.test.js: plain-object
// fake elements standing in for the card and its children, the REAL label module
// imported, and — the part that makes this a walk rather than a re-implementation
// — the two pieces of app.js under test are SLICED OUT OF THE SHIPPED FILE and
// compiled, not copied. The `activity` SSE listener and laneCard's two now-line
// statements run here as the bytes the browser loads, so deleting the listener,
// dropping the render, or seeding `state.activity` from a fetch (the plan's M13)
// is red here and nowhere else.
//
// Why not headless CDP, as plan criterion 15 words it: the three properties are
// client-module behaviour, and this repo already proves client-module behaviour
// this way (AS-135). A browser adds a Chromium download to the container and
// answers the same three questions. Noted as a deviation on the task.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVITY_DECAY_MS, describeActivity } from '../public/lanes.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const app = readFileSync(path.join(publicDir, 'app.js'), 'utf8');

// --- the shipped slices -------------------------------------------------------

/** The body of `eventSource.addEventListener('<name>', (e) => { … })`, taken
 *  from app.js by brace matching. Throws loudly rather than silently matching
 *  nothing: a rename must fail this file, not quietly stop testing anything. */
function listenerBody(name) {
  const head = `eventSource.addEventListener('${name}', (e) => {`;
  const start = app.indexOf(head);
  assert.notEqual(start, -1, `app.js registers an SSE listener for '${name}'`);
  const open = start + head.length - 1;
  let depth = 0;
  for (let i = open; i < app.length; i++) {
    if (app[i] === '{') depth++;
    else if (app[i] === '}' && --depth === 0) return app.slice(open + 1, i);
  }
  throw new Error(`unbalanced '${name}' listener body in app.js`);
}

/** laneCard's two now-line statements, verbatim. */
function nowLineSource() {
  const head = 'const now = describeActivity(';
  const tail = 'now.text));';
  const start = app.indexOf(head);
  assert.notEqual(start, -1, 'laneCard derives the now-line through describeActivity');
  const end = app.indexOf(tail, start);
  assert.notEqual(end, -1, 'laneCard appends the now-line node');
  return app.slice(start, end + tail.length);
}

const ACTIVITY_LISTENER = listenerBody('activity');
const NOW_LINE = nowLineSource();

// The free variables each slice closes over, passed in as parameters.
const handleActivity = new Function('e', 'state', 'renderLanes', ACTIVITY_LISTENER);
const drawNowLine = new Function('lane', 'state', 'nowMs', 'card', 'el', 'describeActivity', NOW_LINE);

// --- the DOM shim -------------------------------------------------------------
// app.js's own el(): className set when truthy, textContent set when not null.

function fakeEl(tag, className, text) {
  const node = { tag, className: '', textContent: '', children: [] };
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  node.appendChild = (child) => {
    node.children.push(child);
    return child;
  };
  return node;
}
const el = (tag, className, text) => fakeEl(tag, className, text);

// --- fixtures -----------------------------------------------------------------

const KEY = 'AS-103';
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

/** A lane as /api/lanes projects it — only `key` matters to the now-line, but
 *  the neighbours are here so a lookup against the wrong field is visible. */
const lane = (over = {}) => ({
  key: KEY,
  task: { taskId: 'task_a', shortId: KEY, title: 'Chat: live activity', status: 'in_progress' },
  worktree: null,
  employee: { assignee: 'agent:developer-marcus', lastCommitAuthor: null, agree: null },
  stale: { flag: false, reasons: [] },
  stageStartedAt: null,
  subAgent: null,
  ...over,
});

/** A freshly loaded page's activity state, read out of app.js's own state
 *  literal so "what a reload starts with" is never a guess made here. */
function freshState() {
  const m = app.match(/\n {2}activity: (\{\}),\n\};/);
  assert.ok(m, 'app.js seeds state.activity with an empty object literal and nothing else');
  return { activity: JSON.parse(m[1]) };
}

const frame = (over = {}) => ({ key: KEY, text: 'reading apps/chat/server.js', at: iso(NOW), ...over });
const sse = (payload) => ({ data: JSON.stringify(payload) });

/** One card's now-line node, drawn by the shipped statements. */
function nowLine(state, nowMs, laneObj = lane()) {
  const card = fakeEl('div', 'lane-card');
  drawNowLine(laneObj, state, nowMs, card, el, describeActivity);
  const drawn = card.children.filter((n) => n.className.split(' ').includes('lane-now'));
  assert.equal(drawn.length, 1, 'a card carries exactly one now-line, always rendered');
  return drawn[0];
}

// --- AC-15 (a): a posted frame renders live --------------------------------------

test('AC-15 browser walk (a): a posted frame renders as `now: reading …` with .lane-now--live', () => {
  const state = freshState();
  let renders = 0;
  const before = nowLine(state, NOW);
  assert.equal(before.className, 'lane-now lane-now--blank', 'precondition: nothing posted yet');

  handleActivity(sse(frame()), state, () => renders++);

  assert.deepEqual(state.activity, { [KEY]: { text: 'reading apps/chat/server.js', at: iso(NOW) } },
    'the listener stores exactly the frame it was handed, under its lane key');
  assert.equal(renders, 1, 'a frame re-renders the pane — a stored frame nobody draws is not a walk');

  const live = nowLine(state, NOW + 1_000);
  assert.equal(live.className, 'lane-now lane-now--live');
  assert.equal(live.textContent, 'now: reading apps/chat/server.js');
  assert.equal(live.tag, 'div');

  // A second frame on the same lane replaces the first: the line is a
  // "now", not a log.
  handleActivity(sse(frame({ text: 'running docker', at: iso(NOW + 2_000) })), state, () => renders++);
  assert.equal(renders, 2);
  assert.equal(nowLine(state, NOW + 2_000).textContent, 'now: running docker');
  assert.equal(Object.keys(state.activity).length, 1, 'one entry per lane, not one per frame');

  // …and a frame for another lane never bleeds onto this card.
  handleActivity(sse(frame({ key: 'AS-99', text: 'searching' })), state, () => renders++);
  assert.equal(nowLine(state, NOW + 2_000).textContent, 'now: running docker', 'AS-103 card unmoved');
  assert.equal(nowLine(state, NOW + 2_000, lane({ key: 'AS-99' })).textContent, 'now: searching');
});

// --- AC-15 (b): the line decays ---------------------------------------------------

test('AC-15 browser walk (b): after ACTIVITY_DECAY_MS the same card reads --decayed, same words', () => {
  const state = freshState();
  handleActivity(sse(frame()), state, () => {});

  // The boundary, both sides of it: decay is strictly "older than", so the
  // last live millisecond is still live.
  assert.equal(nowLine(state, NOW + ACTIVITY_DECAY_MS).className, 'lane-now lane-now--live',
    `at exactly ${ACTIVITY_DECAY_MS} ms the frame is still live`);
  const decayed = nowLine(state, NOW + ACTIVITY_DECAY_MS + 1);
  assert.equal(decayed.className, 'lane-now lane-now--decayed');
  assert.equal(decayed.textContent, 'now: reading apps/chat/server.js',
    'decay is a tone change, not an erasure — the board still sees what was last seen');

  // Long after, still decayed rather than blank: blank means "never heard
  // anything", and conflating the two would lie about a stalled lane.
  assert.equal(nowLine(state, NOW + 10 * ACTIVITY_DECAY_MS).className, 'lane-now lane-now--decayed');

  // Probe past the list: an unparseable timestamp is decayed, never live.
  const junk = freshState();
  handleActivity(sse(frame({ at: 'not a timestamp' })), junk, () => {});
  assert.equal(nowLine(junk, NOW).className, 'lane-now lane-now--decayed');
  // A clock skew that puts the frame in the future is live, not decayed.
  const future = freshState();
  handleActivity(sse(frame({ at: iso(NOW + 60_000) })), future, () => {});
  assert.equal(nowLine(future, NOW).className, 'lane-now lane-now--live');
});

// --- AC-15 (c): a reload is blank, and asks nobody for a backlog -------------------

test('AC-15 browser walk (c): a reload leaves the line blank and issues no request to restore it', (t) => {
  // M13's subject. Any request the render path makes is counted here, and the
  // source pins below cover the seed a request elsewhere in the file could feed.
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    requests.push(args[0]);
    return Promise.reject(new Error('the now-line must never issue a request'));
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  // A session that saw frames…
  const session = freshState();
  handleActivity(sse(frame()), session, () => {});
  assert.equal(nowLine(session, NOW).className, 'lane-now lane-now--live');

  // …then a reload: a brand-new page, built from app.js's own state literal.
  const reloaded = freshState();
  assert.deepEqual(reloaded.activity, {}, 'a reload starts with no frames');
  const blank = nowLine(reloaded, NOW);
  assert.equal(blank.className, 'lane-now lane-now--blank');
  assert.equal(blank.textContent, '', 'blank is empty text, not the last thing the previous page saw');
  assert.deepEqual(requests, [], 'nothing was fetched to fill the line');

  // The line stays blank until a frame arrives — there is no replay, and time
  // passing does not conjure one.
  assert.equal(nowLine(reloaded, NOW + 10 * ACTIVITY_DECAY_MS).className, 'lane-now lane-now--blank');
  handleActivity(sse(frame({ text: 'editing public/app.js', at: iso(NOW + 60_000) })), reloaded, () => {});
  assert.equal(nowLine(reloaded, NOW + 60_000).textContent, 'now: editing public/app.js');
  assert.deepEqual(requests, [], 'and a frame arriving still fetches nothing');
});

// --- AC-15 (c), the source half: nothing in app.js can seed the state -------------

test('AC-15 browser walk (c): state.activity is written in one place only, and app.js never names the endpoint', () => {
  // The behavioural half above can only see the render path. This half covers
  // the whole file: a seed dropped into openLanes(), refreshLanes(), catchUp()
  // or the `open` listener would satisfy every assertion above and still break
  // the ephemerality contract.
  const writes = [...app.matchAll(/state\.activity(\[[^\]]*\])?\s*=(?!=)/g)].map((m) => m[0]);
  assert.deepEqual(writes, ['state.activity[frame.key] ='],
    'exactly one write to state.activity, keyed by an arriving frame');
  assert.ok(ACTIVITY_LISTENER.includes('state.activity[frame.key] ='), 'and it is inside the activity listener');

  assert.doesNotMatch(app, /\/api\/activity/, 'the client never names the producer endpoint');
  for (const forbidden of ['fetch(', 'localStorage', 'sessionStorage']) {
    assert.ok(!ACTIVITY_LISTENER.includes(forbidden), `the activity listener must not contain ${forbidden}`);
  }
  assert.match(ACTIVITY_LISTENER, /renderLanes\(\)/, 'the listener draws; it does not merely store');

  // The badge counts lanes, not tool calls: the listener must not touch it.
  assert.ok(!ACTIVITY_LISTENER.includes('renderLanesBadge'), 'activity never moves the lane badge');

  // A torn frame is a no-op, not a crash, and not a write.
  const state = freshState();
  let renders = 0;
  for (const bad of ['not json {{{', '[1,2,3]', 'null', '{}', '{"text":"x"}', '{"key":""}', '{"key":5}']) {
    handleActivity({ data: bad }, state, () => renders++);
  }
  assert.deepEqual(state.activity, {}, 'no malformed frame reaches the card');
  assert.equal(renders, 0, 'and none of them repaint the pane');
});
