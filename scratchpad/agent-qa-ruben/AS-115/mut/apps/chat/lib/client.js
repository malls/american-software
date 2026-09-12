// lib/client.js — HTTP backend for bin/chat.js (AS-24).
//
// Why this exists: on the macOS Docker bind mount, a host-side process and the
// containerized server each see their own WAL view of chat.db — a host CLI
// write can land in a fork the server never sees (verified: orphan message
// 161). While a server is up, the server is the single reader/writer of the
// shared DB, so the CLI proxies every command through the HTTP API instead of
// opening the DB file. This module is the probe plus a thin fetch client that
// maps the CLI command surface onto /api/*.
//
// Shape parity contract: everything returned here matches the direct-mode
// (store-backed) shapes byte-for-byte at the CLI output layer. Concretely:
// server-side `refs` annotations are stripped (the CLI annotates locally from
// the repo's .lattice/ in both modes), and roster rows drop the web-UI-only
// `self` field. A script consuming `chat <cmd> --json` cannot tell which mode
// served it.

import { StoreError } from './store.js';

export const DEFAULT_API = 'http://127.0.0.1:8347';

/**
 * Wall-clock budget for the mode probe (AS-83). This is the ONLY bounded step
 * in a CLI invocation, and blowing it is not "the server is down" — it is
 * ambiguity, which refuses loudly. The original half-second budget was tight
 * enough (the value below is the only budget literal in this file) that a
 * merely *slow but live* server got refused: an emulated linux/amd64 test
 * container under a concurrent `docker compose build`, and equally a host
 * `chat.js` call racing the watcher's rebuild, could not answer one GET inside
 * it. Raising the budget cannot mask a mode regression — no budget turns
 * 'ambiguous' into 'down' (that needs a positive ECONNREFUSED/ENOTFOUND) — it
 * only costs a pathological accept-and-never-answer listener more wall clock
 * before the same refusal. Override per invocation with CHAT_PROBE_TIMEOUT_MS.
 */
export const DEFAULT_PROBE_TIMEOUT_MS = 3000;

const DOWN_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND']);

/** True only for a positive "nothing is listening" signal. Walks the cause
 *  chain (undici wraps errors in TypeError('fetch failed') with a cause that
 *  may itself be an AggregateError over per-address attempts). */
function isConnDown(err) {
  for (let e = err; e; e = e.cause) {
    if (DOWN_CODES.has(e.code)) return true;
    if (Array.isArray(e.errors) && e.errors.some((x) => DOWN_CODES.has(x?.code))) return true;
  }
  return false;
}

/** First error code in the cause chain (same walk as isConnDown), or null. */
function errCode(err) {
  for (let e = err; e; e = e.cause) {
    if (typeof e.code === 'string') return e.code;
    if (Array.isArray(e.errors)) {
      const hit = e.errors.find((x) => typeof x?.code === 'string');
      if (hit) return hit.code;
    }
  }
  return null;
}

/**
 * Probe a chat server at `base`. Returns `{ state, reason }` where state is
 * exactly one of:
 *   'up'        — GET /api/identities answered 2xx with an {identities: […]}
 *                 JSON body (shape-checked so a squatted port can't pass);
 *   'down'      — hard ECONNREFUSED/ENOTFOUND: provably nothing listening;
 *   'ambiguous' — anything else (timeout, 5xx, wrong shape, other errors).
 * Ambiguity must fail loud at the caller, never fall back to direct DB access:
 * silent divergence was the AS-24 failure mode.
 * `reason` is null for 'up' and otherwise a short phrase the caller appends to
 * its refusal, so a refusal in a log names its own exit path (AS-83): four
 * sightings of the timeout case could not be told apart from a 5xx or a
 * squatted port without re-running it.
 */
export async function probe(base, { timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await fetch(base + '/api/identities', { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // A timeout is never 'down': only a positive connection-refused/not-found
    // proves nothing is listening. Slow and absent are different facts.
    return isConnDown(e)
      ? { state: 'down', reason: errCode(e) }
      : {
          state: 'ambiguous',
          reason:
            e?.name === 'TimeoutError'
              ? `timed out after ${timeoutMs} ms`
              : errCode(e) ?? e?.message ?? String(e),
        };
  }
  if (!res.ok) return { state: 'ambiguous', reason: `HTTP ${res.status}` };
  let data;
  try {
    data = await res.json();
  } catch {
    return { state: 'ambiguous', reason: 'unparseable body' };
  }
  return data && Array.isArray(data.identities)
    ? { state: 'up', reason: null }
    : { state: 'ambiguous', reason: 'wrong shape' };
}

const CONV_KEYS = ['id', 'type', 'name', 'purpose', 'dmKey', 'visibility', 'createdBy', 'createdAt'];

/** Normalize a conversations-list entry to the store's CONV_COLS row shape
 *  (plus members for DMs) — what direct-mode resolveConv hands the commands. */
function convShape(c) {
  const out = {};
  for (const k of CONV_KEYS) out[k] = c[k];
  if (c.type === 'dm') out.members = c.members;
  return out;
}

/** Drop the server-side refs annotation; the CLI annotates locally. */
function stripRefs(m) {
  if (m && 'refs' in m) {
    const { refs, ...rest } = m;
    return rest;
  }
  return m;
}

const statusToCode = (status) =>
  status === 404 ? 'not_found'
  : status === 403 ? 'forbidden'
  : status === 409 ? 'conflict'
  : 'bad_request';

/**
 * API-mode backend: the same surface bin/chat.js's direct (store) backend
 * exposes, every method async, every error a StoreError whose message is the
 * server's own — the server raises the same StoreErrors the store raises, so
 * stderr and exit codes match direct mode without any mapping table.
 */
export function createApiBackend(base) {
  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // Mid-command loss of the server. Never fall back to the DB file here —
      // one mode decision per invocation (AS-24).
      throw new StoreError(
        `chat: lost the server at ${base} mid-command (${e.cause?.code ?? e.message}); ` +
          `not touching the shared DB directly (AS-24). Retry, or set CHAT_MODE=direct if the server is really down.`,
        'unreachable'
      );
    }
    if (path === '/api/dump') {
      if (!res.ok) throw new StoreError(`HTTP ${res.status} from ${base}${path}.`, statusToCode(res.status));
      return res.text();
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new StoreError(data?.error ?? `HTTP ${res.status} from ${base}${path}.`, statusToCode(res.status));
    }
    return data;
  }

  const enc = encodeURIComponent;
  // One conversation view fetch per invocation per conversation (inbox thread
  // context does repeated getMessage lookups).
  const viewCache = new Map();
  async function conversationView(conversationId, me) {
    const key = `${conversationId}\x00${me}`;
    if (!viewCache.has(key)) {
      viewCache.set(key, await call('GET', `/api/messages?conversation=${enc(conversationId)}&me=${enc(me)}`));
    }
    return viewCache.get(key);
  }

  return {
    mode: 'api',
    base,
    close() {},

    async requireIdentity(id) {
      const { identities } = await call('GET', '/api/identities');
      const row = identities.find((r) => r.id === id);
      if (!row) {
        // Byte-identical to store.requireIdentity's wording.
        throw new StoreError(
          `Unknown identity '${id}'. Register it first (chat register / POST /api/identities).`,
          'unknown_identity'
        );
      }
      return row;
    },

    async listConversations(me) {
      const { conversations } = await call('GET', `/api/conversations?me=${enc(me)}`);
      return conversations;
    },

    async findChannel(name, me) {
      const { conversations } = await call('GET', `/api/conversations?me=${enc(me)}`);
      const chan = conversations.find((c) => c.type === 'channel' && c.name === name);
      return chan ? convShape(chan) : null;
    },

    // Pure DM lookup (AS-3): resolves from the caller's own conversation list,
    // never POST /api/dms — that would create the row non-`dm` paths must not.
    async findDm(me, other) {
      const { conversations } = await call('GET', `/api/conversations?me=${enc(me)}`);
      const dm = conversations.find((c) => c.type === 'dm' && (c.members ?? []).includes(other));
      return dm ? convShape(dm) : null;
    },

    async createChannel({ name, purpose, actor, visibility, members }) {
      const { conversation } = await call('POST', '/api/channels', {
        name,
        purpose: purpose ?? null,
        actor,
        visibility,
        members,
      });
      return conversation;
    },

    // Direct mode counts inserted membership rows; over HTTP the created
    // conversation carries no members, and the store's insert is OR IGNORE
    // over validated ids — so the unique requested set is the same count.
    async privateMemberCount(conversation, requestedMembers) {
      return new Set(requestedMembers).size;
    },

    async openDm(me, other) {
      const { conversation } = await call('POST', '/api/dms', { me, other });
      return conversation;
    },

    async postMessage({ conversation, author, body, threadRoot }) {
      const { message } = await call('POST', '/api/messages', {
        conversation,
        author,
        body,
        threadRoot: threadRoot ?? null,
      });
      return stripRefs(message);
    },

    async getMessages(conversationId, me, { limit } = {}) {
      const qs = `conversation=${enc(conversationId)}&me=${enc(me)}${limit != null ? `&limit=${enc(limit)}` : ''}`;
      const view = await call('GET', `/api/messages?${qs}`);
      return {
        conversation: view.conversation,
        messages: view.messages.map(stripRefs),
        threads: Object.fromEntries(
          Object.entries(view.threads).map(([k, v]) => [k, v.map(stripRefs)])
        ),
      };
    },

    // Single-message lookup for inbox thread context. There is no per-message
    // endpoint; the conversation id is always known at the call site, so fetch
    // (and cache) that conversation's view and search it. Thread roots are
    // top-level by invariant, but replies are searched too for safety.
    async getMessage(id, { conversationId, me }) {
      const view = await conversationView(conversationId, me);
      const hit =
        view.messages.find((m) => m.id === Number(id)) ??
        Object.values(view.threads).flat().find((m) => m.id === Number(id));
      return hit ? stripRefs(hit) : undefined;
    },

    async unreadFor(me) {
      const { unread } = await call('GET', `/api/unread?me=${enc(me)}`);
      return unread.map((g) => ({ ...g, messages: g.messages.map(stripRefs) }));
    },

    async markRead(me, conversationId) {
      const { read } = await call('POST', '/api/read', { me, conversation: conversationId });
      return read;
    },

    async catchupAll(me) {
      const { conversations } = await call('POST', '/api/catchup', { me });
      return conversations;
    },

    async rosterRows(me) {
      const { roster } = await call('GET', `/api/roster${me ? `?me=${enc(me)}` : ''}`);
      // `self` is web-UI-only; the CLI row shape never had it.
      return roster.map(({ self, ...row }) => row);
    },

    async registerIdentity({ id, displayName, kind }) {
      const { identity } = await call('POST', '/api/identities', { id, displayName, kind });
      return identity;
    },

    async syncLattice() {
      const { posted } = await call('POST', '/api/sync');
      return posted;
    },

    async dumpLines() {
      const text = await call('GET', '/api/dump');
      const lines = text.split('\n');
      if (lines.at(-1) === '') lines.pop();
      return lines;
    },

    async exportFiles() {
      const { files } = await call('GET', '/api/export');
      return files;
    },
  };
}
