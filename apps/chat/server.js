// server.js — localhost HTTP server for the chat app (AS-2).
// Static files from public/ + JSON API under /api/*. No logic beyond HTTP
// plumbing; all domain behavior lives in lib/store.js (and lib/lattice.js).

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore, StoreError } from './lib/store.js';
import { ingestNewEvents, resolveRefs, resolveShortId, latticeRoot } from './lib/lattice.js';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const INGEST_THROTTLE_MS = 10_000;

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
    if (req.method === 'POST' && pathname === '/api/channels') {
      return { conversation: store.createChannel({ name: body.name, purpose: body.purpose, actor: body.actor }) };
    }
    if (req.method === 'POST' && pathname === '/api/dms') {
      return { conversation: store.openDm(body.me, body.other) };
    }
    if (req.method === 'GET' && pathname === '/api/messages') {
      const conversation = q('conversation');
      if (!conversation) throw new StoreError("Missing query parameter 'conversation'.");
      const { conversation: conv, messages, threads } = store.getMessages(conversation);
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
          sendJson(200, handleApi(req, url, body));
        } catch (e) {
          if (e instanceof StoreError) {
            const status =
              e.code === 'not_found' ? 404
              : e.code === 'forbidden' ? 403
              : e.code === 'conflict' ? 409
              : e.code === 'unknown_identity' || e.code === 'unknown_conversation' ? 404
              : 400;
            return sendJson(status, { error: e.message });
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
