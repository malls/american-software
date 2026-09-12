// Unit tests for public/leaf-refs.js — the composed leaf chain (AS-115).
// Each ordering constraint in the plan §4 has an input whose token list
// changes if the order is wrong; that is what makes the order a criterion
// rather than a comment (M4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tokenizeLeaf, tokenizeAsRefs } from '../public/leaf-refs.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const refs = [{ shortId: 'AS-87', taskId: 't87', title: 'x', status: 'done', exists: true }];
const shape = (tokens) => tokens.map((t) => `${t.type}:${t.text}`);
const types = (tokens) => tokens.map((t) => t.type);
function assertRoundTrip(tokens, input) {
  assert.equal(tokens.map((t) => t.text).join(''), input, 'tokens round-trip verbatim');
}

test('T8 AC-8 (O1): a hash inside a commit URL is one url token, never a hash', () => {
  const input = 'see https://github.com/malls/american-software/commit/a0cfb0b now';
  const tokens = tokenizeLeaf(input, refs);
  assertRoundTrip(tokens, input);
  assert.deepEqual(shape(tokens), [
    'text:see ',
    'url:https://github.com/malls/american-software/commit/a0cfb0b',
    'text: now',
  ]);
  assert.equal(types(tokens).filter((t) => t === 'hash').length, 0, 'zero hash tokens');
});

test('T9 AC-9 (O2/O2b): branch before AS-refs; AS-refs still fire outside a branch', () => {
  const b = 'feat/AS-87-deploy-heartbeat-and-log';
  const t1 = tokenizeLeaf(b, refs);
  assertRoundTrip(t1, b);
  assert.deepEqual(shape(t1), [`branch:${b}`], 'O2: one branch, zero asref');
  const input = `AS-87 on ${b}`;
  const t2 = tokenizeLeaf(input, refs);
  assertRoundTrip(t2, input);
  assert.deepEqual(shape(t2), ['asref:AS-87', 'text: on ', `branch:${b}`], 'O2b: asref outside, branch whole');
  assert.equal(t2[0].ref, refs[0], 'asref carries its resolved ref');
});

test('T10 AC-10 (O3/O3b): hash after msg-refs; both fire when disjoint', () => {
  const t1 = tokenizeLeaf('msg 1234567', refs);
  assertRoundTrip(t1, 'msg 1234567');
  assert.deepEqual(shape(t1), ['msgref:msg 1234567'], 'O3 (N19): msg-ref consumes the 7 digits');
  assert.equal(t1[0].id, 1234567);
  const t2 = tokenizeLeaf('msg 810 merged 74cb6f9', refs);
  assertRoundTrip(t2, 'msg 810 merged 74cb6f9');
  assert.deepEqual(shape(t2), ['msgref:msg 810', 'text: merged ', 'hash:74cb6f9'], 'O3b');
});

test('T11 AC-11 (O4): a branch inside a URL is one url token, never a branch', () => {
  const input = 'https://github.com/malls/american-software/tree/feat/AS-95-watcher-loop';
  const tokens = tokenizeLeaf(input, refs);
  assertRoundTrip(tokens, input);
  assert.deepEqual(shape(tokens), [`url:${input}`]);
});

test('T12 AC-12 (O5): autolink:false yields no url, branch or hash tokens', () => {
  const input = 'e5a180a on feat/AS-88-x https://x.test';
  const tokens = tokenizeLeaf(input, refs, { autolink: false });
  assertRoundTrip(tokens, input);
  assert.deepEqual(shape(tokens), [`text:${input}`], 'a single text token');
  // AS-refs and msg-refs keep working inside a link label (non-goal: unchanged).
  const t2 = tokenizeLeaf('AS-87 and msg 5', refs, { autolink: false });
  assert.deepEqual(types(t2), ['asref', 'text', 'msgref']);
});

const FIXTURE = 'AS-87 merged 74cb6f9 on feat/AS-87-deploy-heartbeat-and-log, see msg 810 and apps/chat/README.md at https://example.test/x today';

test('T13 AC-13: whole-chain round-trip on a fixture with every token type; exact type sequence', () => {
  const tokens = tokenizeLeaf(FIXTURE, refs);
  assertRoundTrip(tokens, FIXTURE);
  assert.deepEqual(types(tokens), [
    'asref', 'text', 'hash', 'text', 'branch', 'text', 'msgref', 'text', 'fileref', 'text', 'url', 'text',
  ]);
  assert.deepEqual(shape(tokens), [
    'asref:AS-87', 'text: merged ', 'hash:74cb6f9', 'text: on ',
    'branch:feat/AS-87-deploy-heartbeat-and-log', 'text:, see ', 'msgref:msg 810',
    'text: and ', 'fileref:apps/chat/README.md', 'text: at ', 'url:https://example.test/x', 'text: today',
  ]);
});

test('T14 AC-14: tokenizeLeaf emits only the seven known types (cardinality over the fixture)', () => {
  const KNOWN = new Set(['text', 'url', 'branch', 'asref', 'msgref', 'fileref', 'hash']);
  const tokens = tokenizeLeaf(FIXTURE, refs);
  assert.equal(tokens.length, 12, 'fixture yields 12 tokens');
  const seen = new Set(types(tokens));
  assert.equal(seen.size, 7, 'all seven types are exercised by the fixture');
  for (const t of seen) assert.ok(KNOWN.has(t), `unknown token type ${t}`);
  for (const t of tokens) assert.ok(t.text !== '', 'no empty tokens');
  assert.deepEqual(tokenizeLeaf('', refs), [], 'empty leaf');
  assert.deepEqual(tokenizeLeaf(null, refs), [], 'null leaf');
});

test('T15 AC-15: tokenizeAsRefs moved to leaf-refs.js with identical behaviour; app.js no longer defines it', () => {
  assert.deepEqual(tokenizeAsRefs('plain', []), [{ type: 'text', text: 'plain' }], 'refs=[] -> single text token');
  assert.deepEqual(tokenizeAsRefs('', refs), [], 'empty -> []');
  assert.deepEqual(shape(tokenizeAsRefs('AS-870 AS-87x xAS-87 (AS-87)', refs)), ['text:AS-870 AS-87x xAS-87 (', 'asref:AS-87', 'text:)'], '\\b-bounded');
  const app = readFileSync(path.join(publicDir, 'app.js'), 'utf8');
  assert.ok(!app.includes('function tokenizeAsRefs'), 'app.js no longer defines tokenizeAsRefs');
  assert.match(app, /import \{ tokenizeLeaf \} from '\.\/leaf-refs\.js'/, 'app.js imports the composer');
});
