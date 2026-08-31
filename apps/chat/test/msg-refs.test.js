// Unit tests for public/msg-refs.js — pure tokenizers, no DOM (AS-26).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeMsgRefs, tokenizeFileRefs } from '../public/msg-refs.js';

/** Concatenated token texts must reproduce the input byte-for-byte. */
function assertRoundTrip(tokens, input) {
  assert.equal(tokens.map((t) => t.text).join(''), input, 'tokens round-trip verbatim');
}

const refs = (tokens) => tokens.filter((t) => t.type === 'msgref');

test('msg-refs: single reference, keyword variants, optional #', () => {
  for (const [input, text, id] of [
    ['see msg 156 above', 'msg 156', 156],
    ['see message 156 above', 'message 156', 156],
    ['see msg #12', 'msg #12', 12],
    ['MSG 7 works', 'MSG 7', 7],
    ['Msgs 42', 'Msgs 42', 42],
  ]) {
    const tokens = tokenizeMsgRefs(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(refs(tokens), [{ type: 'msgref', text, id }], input);
  }
});

test('msg-refs: list idioms yield one token per number (edge case 8)', () => {
  const slash = tokenizeMsgRefs('per msgs 218/220/221 the board agreed');
  assertRoundTrip(slash, 'per msgs 218/220/221 the board agreed');
  assert.deepEqual(refs(slash), [
    { type: 'msgref', text: 'msgs 218', id: 218 },
    { type: 'msgref', text: '220', id: 220 },
    { type: 'msgref', text: '221', id: 221 },
  ]);

  const commas = tokenizeMsgRefs('message 12, 14 and 15 cover it');
  assertRoundTrip(commas, 'message 12, 14 and 15 cover it');
  assert.deepEqual(refs(commas).map((r) => r.id), [12, 14, 15]);
  // Each link's text is its exact source slice.
  assert.deepEqual(refs(commas).map((r) => r.text), ['message 12', '14', '15']);

  const spaces = tokenizeMsgRefs('msgs 3 4');
  assert.deepEqual(refs(spaces).map((r) => r.id), [3, 4]);
});

test('msg-refs: list consumption stops at the first non-integer', () => {
  const tokens = tokenizeMsgRefs('msg 5 and then some');
  assertRoundTrip(tokens, 'msg 5 and then some');
  assert.deepEqual(refs(tokens), [{ type: 'msgref', text: 'msg 5', id: 5 }]);
  assert.equal(tokens.at(-1).text, ' and then some');
});

test('msg-refs: AS-n adjacency — task codes never feed msg refs (edge case 7)', () => {
  const both = tokenizeMsgRefs('see AS-26 and msg 156');
  assertRoundTrip(both, 'see AS-26 and msg 156');
  assert.deepEqual(refs(both), [{ type: 'msgref', text: 'msg 156', id: 156 }]);
  assert.ok(both.some((t) => t.type === 'text' && t.text.includes('AS-26')));

  assert.deepEqual(refs(tokenizeMsgRefs('AS-26 alone')), []);
  assert.deepEqual(refs(tokenizeMsgRefs('26 messages arrived')), []);
  assert.deepEqual(refs(tokenizeMsgRefs('backlog has 26 messages')), []);
});

test('msg-refs: bare numbers without a keyword never match', () => {
  for (const input of ['call 911', 'in 2026 we shipped', 'v1.156 released', 'room 42']) {
    const tokens = tokenizeMsgRefs(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(refs(tokens), [], input);
  }
});

test('msg-refs: ids must be positive safe integers', () => {
  assert.deepEqual(refs(tokenizeMsgRefs('msg 0 is nothing')), []);
  const unsafe = 'msg 99999999999999999999';
  const tokens = tokenizeMsgRefs(unsafe);
  assertRoundTrip(tokens, unsafe);
  assert.deepEqual(refs(tokens), []);
  // A list stops consuming at an invalid id but keeps earlier ones.
  const mixed = tokenizeMsgRefs('msgs 5/0');
  assert.deepEqual(refs(mixed).map((r) => r.id), [5]);
  assertRoundTrip(mixed, 'msgs 5/0');
});

test('msg-refs: multiple separate references in one body', () => {
  const input = 'msg 3 replies to message 1, obviously';
  const tokens = tokenizeMsgRefs(input);
  assertRoundTrip(tokens, input);
  assert.deepEqual(refs(tokens).map((r) => r.id), [3, 1]);
});

test('msg-refs: junk-tolerant on non-strings and empty input', () => {
  assert.deepEqual(tokenizeMsgRefs(''), []);
  assert.deepEqual(tokenizeMsgRefs(null), []);
  assert.deepEqual(tokenizeMsgRefs(undefined), []);
});

// --- tokenizeFileRefs (AS-26 §5) --------------------------------------------

const fileRefs = (tokens) => tokens.filter((t) => t.type === 'fileref');

test('file-refs: bare filenames, nested paths, and .lattice paths match', () => {
  for (const [input, path] of [
    ['read README.md first', 'README.md'],
    ['per PHILOSOPHY.md rule 6', 'PHILOSOPHY.md'],
    ['see apps/chat/README.md for the contract', 'apps/chat/README.md'],
    ['plan at .lattice/plans/task_X.md covers it', '.lattice/plans/task_X.md'],
    ['dossier personnel/developer-marcus-webb.md updated', 'personnel/developer-marcus-webb.md'],
  ]) {
    const tokens = tokenizeFileRefs(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(fileRefs(tokens), [{ type: 'fileref', text: path, path }], input);
  }
});

test('file-refs: trailing punctuation and backtick context stay outside the token', () => {
  const dot = tokenizeFileRefs('read README.md.');
  assertRoundTrip(dot, 'read README.md.');
  assert.deepEqual(fileRefs(dot).map((r) => r.path), ['README.md']);
  // Backticks are not path chars: the pass runs on code-span inners upstream,
  // but a raw backtick-wrapped path still tokenizes cleanly here.
  const ticked = tokenizeFileRefs('`apps/chat/README.md`');
  assertRoundTrip(ticked, '`apps/chat/README.md`');
  assert.deepEqual(fileRefs(ticked).map((r) => r.path), ['apps/chat/README.md']);
});

test('file-refs: traversal, absolute, dot-leading, and non-md candidates stay literal', () => {
  for (const input of [
    'foo/../../x.md is a probe',
    '../x.md relative escape',
    'see /etc/x.md there', // absolute: 'etc/x.md' blocked by the / lookbehind
    'personnel/./x.md current-dir segment',
    'hidden personnel/.secret.md dotfile',
    'a/.lattice/x.md — .lattice only as FIRST segment',
    'not markdown README.mdx',
    'code chat.db or app.js never match',
    '.env has no md suffix',
  ]) {
    const tokens = tokenizeFileRefs(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(fileRefs(tokens), [], input);
  }
});

test('file-refs: multiple refs in one body, junk-tolerant input', () => {
  const input = 'compare README.md with apps/chat/README.md';
  const tokens = tokenizeFileRefs(input);
  assertRoundTrip(tokens, input);
  assert.deepEqual(fileRefs(tokens).map((r) => r.path), ['README.md', 'apps/chat/README.md']);
  assert.deepEqual(tokenizeFileRefs(''), []);
  assert.deepEqual(tokenizeFileRefs(null), []);
});
