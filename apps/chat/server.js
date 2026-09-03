// server.js — localhost HTTP server for the chat app (AS-2).
// Static files from public/ + JSON API under /api/*. No logic beyond HTTP
// plumbing; all domain behavior lives in lib/store.js (and lib/lattice.js).

import { createServer } from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore, StoreError } from './lib/store.js';
import { ingestNewEvents, resolveRefs, resolveShortId, latticeRoot, assignmentsByActor } from './lib/lattice.js';
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
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
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
 * real locations, not just requested spellings); (4) regular file. Checks
 * 1–4 throw ONE byte-identical not_found — a probe cannot distinguish
 * "outside the gate" from "doesn't exist". Check (5), size cap, alone is a
 * 400: the file already passed the gate, nothing leaks.
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

export function createChatServer({ dbPath, repoRoot, dataDir, loopPollMs = LOOP_POLL_MS } = {}) {
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
    return { ...status, lastTick };
  }

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
