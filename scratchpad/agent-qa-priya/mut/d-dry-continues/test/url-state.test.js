// Unit tests for the pure URL-state module (AS-9). No server, no DOM — the
// same file the browser imports is imported here directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChatUrl, serializeChatUrl, resolveConversation } from '../public/url-state.js';

// --- parse -----------------------------------------------------------------

test('url-state: parse — every grammar production', () => {
  assert.deepEqual(parseChatUrl('?c=general'), {
    conv: { kind: 'channel', name: 'general' },
    thread: null,
    msg: null,
  });
  assert.deepEqual(parseChatUrl('?c=dm:7'), {
    conv: { kind: 'dm', id: 7 },
    thread: null,
    msg: null,
  });
  assert.deepEqual(parseChatUrl('?c=engineering&t=42'), {
    conv: { kind: 'channel', name: 'engineering' },
    thread: 42,
    msg: null,
  });
  assert.deepEqual(parseChatUrl('?c=engineering&m=9'), {
    conv: { kind: 'channel', name: 'engineering' },
    thread: null,
    msg: 9,
  });
  // t and m both present -> both parsed; which one wins is app policy.
  assert.deepEqual(parseChatUrl('?c=dm:3&t=10&m=11'), {
    conv: { kind: 'dm', id: 3 },
    thread: 10,
    msg: 11,
  });
  // Order-independent; leading '?' optional; encoded ':' equivalent to bare.
  assert.deepEqual(parseChatUrl('t=5&c=general'), parseChatUrl('?c=general&t=5'));
  assert.deepEqual(parseChatUrl('?c=dm%3A7'), parseChatUrl('?c=dm:7'));
  // Percent-encoded channel name decodes before validation.
  assert.deepEqual(parseChatUrl('?c=%67eneral').conv, { kind: 'channel', name: 'general' });
  // Numeric channel names are channels, never DMs (the dm: prefix exists for this).
  assert.deepEqual(parseChatUrl('?c=2024').conv, { kind: 'channel', name: '2024' });
});

test('url-state: parse — junk tolerance, never throws', () => {
  const empty = { conv: null, thread: null, msg: null };
  assert.deepEqual(parseChatUrl(''), empty);
  assert.deepEqual(parseChatUrl('?'), empty);
  assert.deepEqual(parseChatUrl('?x=1&y=2'), empty); // foreign-only
  assert.deepEqual(parseChatUrl(undefined), empty);
  assert.deepEqual(parseChatUrl(null), empty);

  // Bad channel charset.
  for (const c of ['%3B', 'Bad_Name', 'UPPER', 'a%20b', 'caf%C3%A9', '']) {
    assert.equal(parseChatUrl(`?c=${c}`).conv, null, `c=${c}`);
  }
  // Malformed dm: forms.
  for (const c of ['dm:', 'dm:x', 'dm:0', 'dm:-3', 'dm:1.5', 'dm:7x', 'dm:07:9']) {
    assert.equal(parseChatUrl(`?c=${c}`).conv, null, `c=${c}`);
  }
  // Non-integer / non-positive t and m parse to null, independently of c.
  for (const v of ['abc', '0', '-1', '1.5', '', '7x', '1e3']) {
    assert.equal(parseChatUrl(`?c=general&t=${v}`).thread, null, `t=${v}`);
    assert.equal(parseChatUrl(`?c=general&m=${v}`).msg, null, `m=${v}`);
  }
  // t without c still parses (the app decides it cannot be applied).
  assert.deepEqual(parseChatUrl('?t=5'), { conv: null, thread: 5, msg: null });
});

// --- serialize ---------------------------------------------------------------

test('url-state: serialize — roundtrip property for valid selections', () => {
  const selections = [
    { conv: { kind: 'channel', name: 'general' }, thread: null, msg: null },
    { conv: { kind: 'channel', name: 'a-1' }, thread: 42, msg: null },
    { conv: { kind: 'channel', name: '2024' }, thread: null, msg: 7 },
    { conv: { kind: 'dm', id: 7 }, thread: null, msg: null },
    { conv: { kind: 'dm', id: 123 }, thread: 9, msg: 10 },
    { conv: null, thread: null, msg: null },
  ];
  for (const sel of selections) {
    const roundtripped = parseChatUrl(serializeChatUrl(sel, ''));
    assert.deepEqual(roundtripped, sel, JSON.stringify(sel));
  }
  // The dm: prefix stays literal in the serialized form (readable links).
  assert.equal(serializeChatUrl({ conv: { kind: 'dm', id: 7 } }, ''), '?c=dm:7');
});

test('url-state: serialize — owns only c/t/m; foreign params preserved', () => {
  const sel = { conv: { kind: 'channel', name: 'general' }, thread: 5, msg: null };
  // Foreign param survives alongside ours.
  const withForeign = serializeChatUrl(sel, '?x=1&c=old-channel&t=99&m=3');
  const p = new URLSearchParams(withForeign);
  assert.equal(p.get('x'), '1');
  assert.equal(p.get('c'), 'general');
  assert.equal(p.get('t'), '5');
  assert.equal(p.get('m'), null, 'stale m removed, not carried over');
  // Clearing the selection strips c/t/m but keeps foreign params.
  assert.equal(serializeChatUrl({ conv: null }, '?x=1&c=old&t=2&m=3'), '?x=1');
  // Full clear with no foreign params returns the empty string.
  assert.equal(serializeChatUrl({ conv: null }, '?c=old&t=2'), '');
  assert.equal(serializeChatUrl({ conv: null, thread: null, msg: null }, ''), '');
  // Grammar: t and m require c — never emitted without a conversation.
  assert.equal(serializeChatUrl({ conv: null, thread: 5, msg: 6 }, ''), '');
});

// --- resolve -----------------------------------------------------------------

// A viewer's /api/conversations list: public channels + own DMs. Note what is
// ABSENT: the private channel 'board' this viewer is not a member of — the
// server never sends it, so resolution cannot even see it.
const VIEWER_LIST = [
  { id: 1, type: 'channel', name: 'general', visibility: 'public' },
  { id: 4, type: 'channel', name: '2024', visibility: 'public' },
  { id: 7, type: 'dm', members: ['human:forrest', 'agent:cto-owen'] },
];

test('url-state: resolve — channel and dm hits', () => {
  assert.equal(resolveConversation({ kind: 'channel', name: 'general' }, VIEWER_LIST).id, 1);
  assert.equal(resolveConversation({ kind: 'dm', id: 7 }, VIEWER_LIST).id, 7);
  // No kind confusion: c=2024 is the channel named '2024', c=dm:4 is not.
  assert.equal(resolveConversation({ kind: 'channel', name: '2024' }, VIEWER_LIST).id, 4);
  assert.equal(resolveConversation({ kind: 'dm', id: 4 }, VIEWER_LIST), null);
  assert.equal(resolveConversation({ kind: 'channel', name: '7' }, VIEWER_LIST), null);
});

test('url-state: resolve — oracle-safety contract: hidden === nonexistent', () => {
  // 'board' exists on the server as a private channel, but it is absent from
  // this viewer's list. Resolving it must be INDISTINGUISHABLE from resolving
  // a channel that never existed: same code path, same null, and (because
  // this is a pure list lookup) provably zero network requests either way.
  const hidden = resolveConversation({ kind: 'channel', name: 'board' }, VIEWER_LIST);
  const neverExisted = resolveConversation({ kind: 'channel', name: 'no-such-channel' }, VIEWER_LIST);
  assert.equal(hidden, null);
  assert.deepEqual(hidden, neverExisted);
  // Same for a DM the viewer is not a member of.
  assert.equal(resolveConversation({ kind: 'dm', id: 999999 }, VIEWER_LIST), null);
});

test('url-state: resolve — null-safe on empty/missing inputs', () => {
  assert.equal(resolveConversation(null, VIEWER_LIST), null);
  assert.equal(resolveConversation({ kind: 'channel', name: 'general' }, []), null);
  assert.equal(resolveConversation({ kind: 'channel', name: 'general' }, undefined), null);
  assert.equal(resolveConversation({ kind: 'nonsense' }, VIEWER_LIST), null);
});
