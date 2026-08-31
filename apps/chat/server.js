// server.js — localhost HTTP server for the chat app (AS-2).
// Static files from public/ + JSON API under /api/*. No logic beyond HTTP
// plumbing; all domain behavior lives in lib/store.js (and lib/lattice.js).

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore, StoreError } from './lib/store.js';
import { ingestNewEvents, resolveRefs, resolveShortId, latticeRoot, assignmentsByActor } from './lib/lattice.js';
import { readRoster } from './lib/personnel.js';

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
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const INGEST_THROTTLE_MS = 10_000;

// AS-25: SSE heartbeat cadence. One shared timer writes a comment line (:hb)
// to every open stream — keeps proxy/NAT idle timeouts from reaping the
// connection and surfaces dead sockets as write errors. Uniform to all
// connections (no information content).
const HEARTBEAT_MS = 25_000;

/** StoreError -> HTTP status (one mapping for the JSON API and /api/stream). */
function storeErrorStatus(e) {
  return e.code === 'not_found' ? 404
    : e.code === 'forbidden' ? 403
    : e.code === 'conflict' ? 409
    : e.code === 'unknown_identity' || e.code === 'unknown_conversation' ? 404
    : 400;
}

export function createChatServer({ dbPath, repoRoot } = {}) {
  const store = openStore(dbPath || process.env.CHAT_DB || join(APP_DIR, 'data', 'chat.db'));
  const root = repoRoot || latticeRoot();

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
