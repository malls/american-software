// url-state.js — pure URL <-> selection mapping for the chat UI (AS-9).
// No DOM, no fetch, no globals: importable from the browser (app.js) and from
// node:test alike. All history/DOM side effects live in app.js.
//
// URL grammar (the deep-link contract; documented in README.md):
//   c = <channel-name>        channel by name, ^[a-z0-9-]+$        ?c=general
//     | "dm:" <conv-id>       DM by numeric conversation id        ?c=dm:7
//   t = <message-id>          thread root to open; requires c
//   m = <message-id>          scroll-to anchor in the main pane; requires c
//
// Identity is NEVER encoded in the URL — 'me' lives in localStorage only.
// Unknown/foreign query params are preserved verbatim-by-value; serialize
// writes and removes ONLY c, t, and m.

const CHANNEL_NAME_RE = /^[a-z0-9-]+$/;
const INT_RE = /^[0-9]+$/;

/** Parse a string as a positive integer id; null on anything else. */
function parseId(value) {
  if (typeof value !== 'string' || !INT_RE.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Parse a location.search string (with or without the leading '?').
 * Junk-tolerant: malformed values yield null for that field, never throw.
 *
 * @returns {{ conv: {kind:'channel',name:string}|{kind:'dm',id:number}|null,
 *             thread: number|null, msg: number|null }}
 */
export function parseChatUrl(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  let conv = null;
  const c = params.get('c');
  if (c != null) {
    if (c.startsWith('dm:')) {
      const id = parseId(c.slice(3));
      if (id != null) conv = { kind: 'dm', id };
    } else if (CHANNEL_NAME_RE.test(c)) {
      conv = { kind: 'channel', name: c };
    }
  }
  return {
    conv,
    thread: parseId(params.get('t')),
    msg: parseId(params.get('m')),
  };
}

/**
 * Serialize a selection back into a search string ('' or '?...').
 * Writes/removes only c, t, m; every other param in currentSearch is
 * preserved (AS-10-proofing). Per the grammar, t and m are emitted only when
 * a conversation is present. Which of t/m the app actually applies is app
 * policy — this function writes what it is given.
 *
 * @param {{ conv: object|null, thread?: number|null, msg?: number|null }} sel
 * @param {string} currentSearch  the current location.search
 */
export function serializeChatUrl(sel, currentSearch) {
  const params = new URLSearchParams(typeof currentSearch === 'string' ? currentSearch : '');
  params.delete('c');
  params.delete('t');
  params.delete('m');
  const { conv = null, thread = null, msg = null } = sel || {};
  if (conv) {
    params.set('c', conv.kind === 'dm' ? `dm:${conv.id}` : conv.name);
    if (thread != null) params.set('t', String(thread));
    if (msg != null) params.set('m', String(msg));
  }
  // URLSearchParams percent-encodes ':' in values; keep our own dm: prefix
  // literal (both forms parse identically — this is cosmetic only, and it
  // touches only the c param we just wrote, never foreign params).
  const out = params.toString().replace(/(^|&)c=dm%3A/, '$1c=dm:');
  return out ? `?${out}` : '';
}

/**
 * Resolve a parsed conv reference against the viewer's own already-fetched,
 * visibility-filtered /api/conversations list. This list is the ONLY
 * resolution input, by design: a hidden private channel resolves exactly like
 * one that never existed (same null), and no network request is ever issued
 * from an unresolved URL param.
 *
 * @returns {object|null} the conversation object from the list, or null
 */
export function resolveConversation(parsedConv, conversations) {
  if (!parsedConv || !Array.isArray(conversations)) return null;
  if (parsedConv.kind === 'channel') {
    return conversations.find((c) => c.type === 'channel' && c.name === parsedConv.name) || null;
  }
  if (parsedConv.kind === 'dm') {
    return conversations.find((c) => c.type === 'dm' && Number(c.id) === parsedConv.id) || null;
  }
  return null;
}
