// Unit tests for public/markdown.js — pure tokenizers, no DOM (AS-26 §6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeInline, parseBlocks, tokenizeUrls } from '../public/markdown.js';
import { tokenizeMsgRefs, tokenizeFileRefs } from '../public/msg-refs.js';

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

// --- AS-54: bare http/https autolink -------------------------------------

/** url-token texts, in order. */
const urls = (input) => tokenizeUrls(input).filter((t) => t.type === 'url').map((t) => t.text);

test('urls: bare http/https autolink — the corpus cases from chat history', () => {
  const LONG = 'https://claude.ai/code/artifact/0123456789abcdef0123456789abcdef0123';
  assert.equal(LONG.length, 68, 'the corpus long-URL case is the 68-char one');
  for (const [input, expected] of [
    // The §3.1 table, row for row.
    ['apps/chat/server.js → http://127.0.0.1:8347. Agents:', 'http://127.0.0.1:8347'],
    ["('lattice dashboard', http://127.0.0.1:8799), which", 'http://127.0.0.1:8799'],
    ["'(see http://x/)'), runs inside", 'http://x/'],
    ['see https://en.wikipedia.org/wiki/Foo_(bar) for more', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ['see https://en.wikipedia.org/wiki/Foo_(bar)) for more', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ['is it http://x/? yes', 'http://x/'],
    ['ends here: http://x/a,b, ok', 'http://x/a,b'],
    // Plus the two the plan names alongside them.
    ['try http://localhost now', 'http://localhost'],
    [`open ${LONG} in a tab`, LONG],
  ]) {
    const tokens = tokenizeUrls(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(tokens.filter((t) => t.type === 'url').map((t) => t.text), [expected], input);
  }
  // Bare, whole-string, no surrounding prose.
  assertRoundTrip(tokenizeUrls('http://127.0.0.1:8348/'), 'http://127.0.0.1:8348/');
  assert.deepEqual(urls('http://127.0.0.1:8348/'), ['http://127.0.0.1:8348/']);
});

test('urls: trailing sentence punctuation stays literal text', () => {
  for (const ch of '.,;:!?') {
    const trailing = `see http://x/a${ch} end`;
    assertRoundTrip(tokenizeUrls(trailing), trailing);
    assert.deepEqual(urls(trailing), ['http://x/a'], `trailing ${ch}`);

    const interior = `see http://x/a${ch}b end`;
    assertRoundTrip(tokenizeUrls(interior), interior);
    assert.deepEqual(urls(interior), [`http://x/a${ch}b`], `interior ${ch}`);
  }
  // A whole run of trailing punctuation goes, one character per iteration.
  assert.deepEqual(urls('what?! http://x/a?!.,;: ok'), ['http://x/a']);
  // Interior commas survive; only the trailing run is trimmed.
  assert.deepEqual(urls('http://x/a,b,c, ok'), ['http://x/a,b,c']);
});

test('urls: closing brackets belong to the URL only when balanced', () => {
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    const balanced = `see https://en.wikipedia.org/wiki/Foo_${open}bar${close} for more`;
    assertRoundTrip(tokenizeUrls(balanced), balanced);
    assert.deepEqual(
      urls(balanced),
      [`https://en.wikipedia.org/wiki/Foo_${open}bar${close}`],
      `balanced ${open}${close}`,
    );

    const unbalanced = `(dashboard, http://127.0.0.1:8799${close} which`;
    assertRoundTrip(tokenizeUrls(unbalanced), unbalanced);
    assert.deepEqual(urls(unbalanced), ['http://127.0.0.1:8799'], `unbalanced ${close}`);

    const extra = `see https://en.wikipedia.org/wiki/Foo_${open}bar${close}${close} for more`;
    assertRoundTrip(tokenizeUrls(extra), extra);
    assert.deepEqual(
      urls(extra),
      [`https://en.wikipedia.org/wiki/Foo_${open}bar${close}`],
      `stripped back to balanced ${open}${close}`,
    );
  }
  // Mixed classes in one tail: ',' then an unbalanced ')' — why it is a loop.
  assert.deepEqual(urls("('lattice dashboard', http://127.0.0.1:8799), which"), ['http://127.0.0.1:8799']);
});

test('urls: scheme allowlist — non-http(s) schemes never produce a url token', () => {
  for (const input of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,alert(1)',
    'vbscript:msgbox(1)',
    'file://etc/passwd',
    'ftp://files.example.com/pub',
    'mailto:someone@example.com',
    'www.example.com',
    'https://',
    'http://.',
    'https://…',           // the placeholder idiom stays literal
    'HTTP://EXAMPLE.COM/',      // uppercase: parity with the markdown link pattern
    'javascript://x/',
  ]) {
    const tokens = tokenizeUrls(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(tokens.filter((t) => t.type === 'url'), [], input);
  }
});

test('urls: scheme parity — bare URLs and markdown links accept the same schemes', () => {
  const SCHEMES = ['http', 'https', 'HTTP', 'HTTPS', 'Http', 'ftp', 'file', 'javascript', 'data', 'vbscript', 'mailto', 'ws', 'gopher'];
  const bareAccepts = [];
  const mdAccepts = [];
  for (const s of SCHEMES) {
    const bare = `${s}://h/`;
    if (tokenizeUrls(bare).some((t) => t.type === 'url')) bareAccepts.push(s);
    const md = `[x](${s}://h/)`;
    if (tokenizeInline(md).some((t) => t.type === 'link')) mdAccepts.push(s);
  }
  assert.deepEqual(bareAccepts, mdAccepts, 'the two paths to an anchor agree on what a link is');
  assert.deepEqual(bareAccepts, ['http', 'https'], 'and the shared answer is http/https only');
});

test('urls: href is a verbatim source slice; round-trip holds over a fuzz corpus', () => {
  // Deterministic PRNG (mulberry32) — zero dependencies, reproducible failures.
  let seed = 0x5eed54;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  // The non-http salt is load-bearing: without it this test cannot see a
  // broken scheme allowlist.
  const SALT = ['http://', 'https://', 'http://', 'https://', 'ftp://', 'file://', 'javascript://', 'data://'];
  const CHUNK = ['x', 'a1', 'example.com', '8347', 'wiki', 'Foo_', 'README', 'md', 'AS-26', 'msg156', '127.0.0.1'];
  const PUNCT = ['.', ',', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}', '/', '?q=', '#', '&', '%20', '-', '_', '=', '@', '<', '>', '"', "'", '`', '\\', ' ', '\t', '\n'];
  const BAD = /[\s<>"'`\\]/;

  let inputs = 0;
  let urlTokens = 0;
  for (let i = 0; i < 50000; i++) {
    let src = '';
    const pieces = 1 + Math.floor(rnd() * 8);
    for (let p = 0; p < pieces; p++) {
      const r = rnd();
      if (r < 0.34) src += pick(SALT) + pick(CHUNK);
      else if (r < 0.62) src += pick(CHUNK);
      else src += pick(PUNCT);
    }
    inputs++;
    const tokens = tokenizeUrls(src);
    assert.equal(tokens.map((t) => t.text).join(''), src, `round-trip: ${JSON.stringify(src)}`);
    let off = 0;
    for (const t of tokens) {
      assert.equal(src.slice(off, off + t.text.length), t.text, `slice identity at ${off}: ${JSON.stringify(src)}`);
      off += t.text.length;
      if (t.type !== 'url') continue;
      urlTokens++;
      assert.equal(t.href, t.text, `href is the token text: ${JSON.stringify(src)}`);
      assert.match(t.href, /^https?:\/\/[A-Za-z0-9]/, `scheme + alnum host: ${JSON.stringify(src)}`);
      assert.ok(!BAD.test(t.href), `no excluded character in href: ${JSON.stringify(t.href)}`);
    }
    assert.equal(off, src.length);
  }
  assert.equal(inputs, 50000, 'the corpus was actually generated');
  assert.ok(urlTokens >= 10000, `corpus must be non-trivial; saw ${urlTokens} url tokens`);
});

test('urls: pass order — refs inside a URL are never linkified; refs outside still are', () => {
  // The appendRefLeaf order, minus the AS pass (tokenizeAsRefs lives in app.js
  // and is not importable): URL first, then msg-refs, then file-refs, with url
  // tokens terminal.
  const compose = (input) => {
    const out = [];
    for (const u of tokenizeUrls(input)) {
      if (u.type === 'url') { out.push(u); continue; }
      for (const m of tokenizeMsgRefs(u.text)) {
        if (m.type === 'msgref') { out.push(m); continue; }
        for (const f of tokenizeFileRefs(m.text)) out.push(f);
      }
    }
    return out;
  };
  const kinds = (toks, type) => toks.filter((t) => t.type === type).map((t) => t.text);

  for (const [input, url, msgrefs, filerefs] of [
    // The three §3.3 collisions: each is one url token and nothing else.
    ['https://example.com/?f=README.md', 'https://example.com/?f=README.md', [], []],
    ['http://127.0.0.1:8347/msg156', 'http://127.0.0.1:8347/msg156', [], []],
    ['https://ci.example.com/job/AS-26/build', 'https://ci.example.com/job/AS-26/build', [], []],
    // The description's path-position case.
    ['https://github.com/x/blob/main/README.md', 'https://github.com/x/blob/main/README.md', [], []],
    // Genuine refs OUTSIDE the URL still resolve.
    ['q https://example.com/?f=README.md z see README.md too', 'https://example.com/?f=README.md', [], ['README.md']],
    ['q http://127.0.0.1:8347/msg156 z see msg 12 too', 'http://127.0.0.1:8347/msg156', ['msg 12'], []],
  ]) {
    const toks = compose(input);
    assert.equal(toks.map((t) => t.text).join(''), input, `round-trip: ${input}`);
    assert.deepEqual(kinds(toks, 'url'), [url], input);
    assert.deepEqual(kinds(toks, 'msgref'), msgrefs, input);
    assert.deepEqual(kinds(toks, 'fileref'), filerefs, input);
  }
  // The AS pass runs on text tokens only, so an AS-n inside a URL is
  // structurally unreachable by it — no text token carries the ref.
  const as = compose('https://ci.example.com/job/AS-26/build');
  assert.ok(!as.filter((t) => t.type === 'text').some((t) => t.text.includes('AS-26')));
  // The converse: URL_RE anchors on a literal scheme, so a bare ref outside
  // any URL is untouched by the URL pass.
  assert.deepEqual(urls('see AS-26 and README.md and msg 12'), []);
});

test('urls: junk-tolerant on non-strings and empty input', () => {
  assert.deepEqual(tokenizeUrls(null), []);
  assert.deepEqual(tokenizeUrls(undefined), []);
  assert.deepEqual(tokenizeUrls(''), []);
  assert.deepEqual(tokenizeUrls(42), [{ type: 'text', text: '42' }]);
});
