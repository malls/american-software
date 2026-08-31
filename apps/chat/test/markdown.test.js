// Unit tests for public/markdown.js — pure tokenizers, no DOM (AS-26 §6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeInline, parseBlocks } from '../public/markdown.js';

function assertRoundTrip(tokens, input) {
  assert.equal(tokens.map((t) => t.text).join(''), input, 'tokens round-trip verbatim');
}

test('inline: strong, em (both delimiters), code, link — delimiters dropped from inner', () => {
  for (const [input, type, inner] of [
    ['**bold**', 'strong', 'bold'],
    ['*italic*', 'em', 'italic'],
    ['_italic_', 'em', 'italic'],
    ['`code`', 'code', 'code'],
  ]) {
    const tokens = tokenizeInline(input);
    assertRoundTrip(tokens, input);
    assert.equal(tokens.length, 1, input);
    assert.equal(tokens[0].type, type);
    assert.equal(tokens[0].inner, inner);
    assert.equal(tokens[0].text, input, 'text keeps the exact source slice');
  }
  const link = tokenizeInline('see [the spec](https://example.com/x) now');
  assertRoundTrip(link, 'see [the spec](https://example.com/x) now');
  assert.deepEqual(link[1], {
    type: 'link',
    text: '[the spec](https://example.com/x)',
    inner: 'the spec',
    href: 'https://example.com/x',
  });
});

test('inline: mixed body tokenizes in order with text between', () => {
  const input = 'ship **it** with `care` today';
  const tokens = tokenizeInline(input);
  assertRoundTrip(tokens, input);
  assert.deepEqual(tokens.map((t) => t.type), ['text', 'strong', 'text', 'code', 'text']);
});

test('inline: javascript: and other non-http schemes stay literal (edge case 16)', () => {
  for (const input of [
    '[x](javascript:alert(1))',
    '[x](data:text/html,hi)',
    '[x](vbscript:evil)',
    '[x](ftp://host/f)',
  ]) {
    const tokens = tokenizeInline(input);
    assertRoundTrip(tokens, input);
    assert.ok(tokens.every((t) => t.type === 'text'), `${input} stays literal`);
  }
});

test('inline: false positives stay literal (edge case 14)', () => {
  for (const input of [
    '2 * 3 * 4', // space-hugging rule
    '** x **', // delimiters must hug non-space content
    'snake_case_name', // _ must be word-boundary-adjacent
    'unmatched ` backtick',
    'unmatched **bold',
    'a ** b ** c',
    '**', // empty delimiters
  ]) {
    const tokens = tokenizeInline(input);
    assertRoundTrip(tokens, input);
    assert.ok(tokens.every((t) => t.type === 'text'), `${input} stays literal`);
  }
});

test('inline: code has precedence — styling never fires inside a code span', () => {
  const tokens = tokenizeInline('run `x **not bold** y` ok');
  assertRoundTrip(tokens, 'run `x **not bold** y` ok');
  assert.deepEqual(tokens.map((t) => t.type), ['text', 'code', 'text']);
  assert.equal(tokens[1].inner, 'x **not bold** y');
});

test('inline: refs inside styling keep their text for the per-leaf ref passes (edge case 15)', () => {
  const strong = tokenizeInline('**see msg 5**');
  assert.equal(strong[0].type, 'strong');
  assert.equal(strong[0].inner, 'see msg 5');
  const code = tokenizeInline('`apps/chat/README.md`');
  assert.equal(code[0].type, 'code');
  assert.equal(code[0].inner, 'apps/chat/README.md');
});

test('inline: single level — inner is not re-tokenized by the caller contract', () => {
  // The tokenizer itself never nests: inner is a plain string.
  const tokens = tokenizeInline('**a `b` c**');
  assert.equal(tokens[0].type, 'strong');
  assert.equal(typeof tokens[0].inner, 'string');
});

test('inline: junk-tolerant on non-strings and empty input', () => {
  assert.deepEqual(tokenizeInline(''), []);
  assert.deepEqual(tokenizeInline(null), []);
  assert.deepEqual(tokenizeInline(undefined), []);
});

test('blocks: headings, fenced code, paragraphs on blank lines, list lines stay plain', () => {
  const doc = [
    '# Title',
    '',
    'First para line one',
    'line two',
    '',
    '## Section',
    '```',
    'const x = 1;',
    '**not styled in code**',
    '```',
    '- item one',
    '- item two',
    '',
    '###### Deep',
  ].join('\n');
  assert.deepEqual(parseBlocks(doc), [
    { type: 'heading', level: 1, text: 'Title' },
    { type: 'para', text: 'First para line one\nline two' },
    { type: 'heading', level: 2, text: 'Section' },
    { type: 'code', text: 'const x = 1;\n**not styled in code**' },
    { type: 'para', text: '- item one\n- item two' },
    { type: 'heading', level: 6, text: 'Deep' },
  ]);
});

test('blocks: unclosed fence runs to EOF; ####### is a paragraph, not a heading', () => {
  assert.deepEqual(parseBlocks('```\nab\ncd'), [{ type: 'code', text: 'ab\ncd' }]);
  assert.deepEqual(parseBlocks('####### seven'), [{ type: 'para', text: '####### seven' }]);
  assert.deepEqual(parseBlocks(''), []);
});
