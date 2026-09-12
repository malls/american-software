// Unit tests for public/copy-refs.js — pure tokenizers, no DOM (AS-115), plus
// the source-scan guards that keep the copy chip a span and its styling
// token-only (T17–T19). One test per acceptance criterion; the sweep is a
// floor check (M5), the mutants in the plan §8a are the proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { tokenizeHashes, tokenizeBranches } from '../public/copy-refs.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (f) => readFileSync(path.join(publicDir, f), 'utf8');

function assertRoundTrip(tokens, input) {
  assert.equal(tokens.map((t) => t.text).join(''), input, 'tokens round-trip verbatim');
}
const hashes = (s) => tokenizeHashes(s).filter((t) => t.type === 'hash').map((t) => t.text);
const branches = (s) => tokenizeBranches(s).filter((t) => t.type === 'branch').map((t) => t.text);

const FORTY = 'a0cfb0b1e5a180a74cb6f90337a541411753ef01'; // 40 lowercase hex
assert.equal(FORTY.length, 40);

// P1–P12 (plan §3.1).
const POSITIVE = [
  ['P1', 'merged 74cb6f9 after', ['74cb6f9']],
  ['P2', '(commit e5a180a)', ['e5a180a']],
  ['P3', 'landed as 0337a54.', ['0337a54']],
  ['P4', 'at 1411753, 456/456 host', ['1411753']],
  ['P5', 'four commits to efadfac; host', ['efadfac']],
  ['P6', 'master pushed b3f71ee..44ac58a; worktree', ['b3f71ee', '44ac58a']],
  ['P7', 'build cb92cbbb2c37d4a8, 5 s', ['cb92cbbb2c37d4a8']],
  ['P8', `full ${FORTY} sha`, [FORTY]],
  ['P9', '`e5a180a`', ['e5a180a']],
  ['P10', 'e5a180a:', ['e5a180a']],
  ['P11', 'desiredId == 84639eb29e39d4d7) and', ['84639eb29e39d4d7']],
  ['P12', 'deadbeef in the fixture', ['deadbeef']],
];

// N1–N18 (plan §3.1). N19 is a composer case and lives in leaf-refs.test.js.
const NEGATIVE = [
  ['N1', 'acceded to the plan'],
  ['N2', 'defaced and effaced'],
  ['N3', 'pid 1234567890 exited'],
  ['N4', 'epoch 1757620000 and 1757620000123'],
  ['N5', '2147483648 and 10000000'],
  ['N6', '#1411753 is an issue'],
  ['N7', 'AS-1411753'],
  ['N8', 'x_e5a180a and e5a180a_x'],
  ['N9', '1C41E3FF and Abc1234 and DEADBEEF'],
  ['N10', 'd1d38cac-4449-42ce-babe-fcc1b3e77a2a'],
  ['N11', 'asc-as93-ruben-mm6-test'],
  ['N12', 'apps/abc1234.js and lib/abc1234/x'],
  ['N13', 'abc1234.js'],
  ['N14', `${FORTY}a`],
  ['N15', 'abc123 short'],
  ['N16', 'task_01M28WQ53NHZFJB9SKGXX7X5BT'],
  ['N17', 'watcher:53418 loop tick 10'],
  ['N18', 'v1.156 released'],
];

test('T1 AC-1: P1–P12 each yield exactly the listed hash tokens and round-trip', () => {
  assert.equal(POSITIVE.length, 12, 'cardinality: 12 positive rows');
  for (const [id, input, expected] of POSITIVE) {
    const tokens = tokenizeHashes(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(hashes(input), expected, `${id}: ${JSON.stringify(input)}`);
  }
});

test('T2 AC-2: N1–N18 each yield zero hash tokens and round-trip', () => {
  assert.equal(NEGATIVE.length, 18, 'cardinality: 18 negative rows');
  for (const [id, input] of NEGATIVE) {
    const tokens = tokenizeHashes(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(hashes(input), [], `${id}: ${JSON.stringify(input)}`);
    assert.deepEqual(tokens, [{ type: 'text', text: input }], `${id}: single text token`);
  }
});

test('T3 AC-3: composition rule — all-digit only at length 7, all-alpha except HEX_WORDS', () => {
  assert.deepEqual(hashes('1234567'), ['1234567'], 'all-digit length 7 admitted');
  assert.deepEqual(hashes('12345678'), [], 'all-digit length 8 rejected');
  assert.deepEqual(hashes('1234567890'), [], 'all-digit length 10 rejected');
  assert.deepEqual(hashes('efadfac'), ['efadfac'], 'all-alpha admitted');
  assert.deepEqual(hashes('deadbeefcafe'), ['deadbeefcafe'], 'all-alpha 12 admitted');
  for (const w of ['acceded', 'defaced', 'effaced']) {
    assert.deepEqual(hashes(w), [], `${w}: stoplist`);
  }
  assert.deepEqual(hashes('1234567 acceded'), ['1234567'], 'mixed line: only the admitted one');
});

test('T4 AC-4: junk-tolerant — empty/null/undefined yield [] from both tokenizers', () => {
  for (const junk of ['', null, undefined]) {
    assert.deepEqual(tokenizeHashes(junk), [], `hashes(${String(junk)})`);
    assert.deepEqual(tokenizeBranches(junk), [], `branches(${String(junk)})`);
  }
});

const BRANCH_POS = [
  ['BP1', 'branch feat/AS-88-deploy-names-its-project from', ['feat/AS-88-deploy-names-its-project']],
  ['BP2', '(feat/AS-26-message-permalinks).', ['feat/AS-26-message-permalinks']],
  ['BP3', 'on feat/AS-83-probe-budget.', ['feat/AS-83-probe-budget']],
  ['BP4', 'git diff master...feat/AS-93-deep-link-host', ['feat/AS-93-deep-link-host']],
  ['BP5', 'origin/feat/AS-95-watcher-loop', ['feat/AS-95-watcher-loop']],
  ['BP6', '`feat/AS-28-favicon`', ['feat/AS-28-favicon']],
  ['BP7', 'feat/AS-115-copy-refs,', ['feat/AS-115-copy-refs']],
];
const BRANCH_NEG = [
  ['BN1', 'feat/AS-88'],
  ['BN2', 'feat/AS-88-'],
  ['BN3', 'feat/AS-88-slug-'],
  ['BN4', 'xfeat/AS-88-slug'],
  ['BN5', 'feat/AS-88-slug/extra'],
  ['BN6', 'fix/AS-88-slug'],
  ['BN7', '.worktrees/AS-88'],
  ['BN8', 'feat/as-88-slug'],
];

test('T5 AC-5: BP1–BP7 yield exactly the listed branch tokens and round-trip', () => {
  assert.equal(BRANCH_POS.length, 7, 'cardinality: 7 positive rows');
  for (const [id, input, expected] of BRANCH_POS) {
    const tokens = tokenizeBranches(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(branches(input), expected, `${id}: ${JSON.stringify(input)}`);
  }
});

test('T6 AC-6: BN1–BN8 yield zero branch tokens', () => {
  assert.equal(BRANCH_NEG.length, 8, 'cardinality: 8 negative rows');
  for (const [id, input] of BRANCH_NEG) {
    const tokens = tokenizeBranches(input);
    assertRoundTrip(tokens, input);
    assert.deepEqual(branches(input), [], `${id}: ${JSON.stringify(input)}`);
  }
});

test('T7 AC-7: right-boundary `.?` clause — abc1234.js stays text while 0337a54. tokenizes', () => {
  assert.deepEqual(tokenizeHashes('abc1234.js'), [{ type: 'text', text: 'abc1234.js' }]);
  assert.deepEqual(tokenizeHashes('landed as 0337a54.'), [
    { type: 'text', text: 'landed as ' },
    { type: 'hash', text: '0337a54' },
    { type: 'text', text: '.' },
  ]);
  assert.deepEqual(hashes('0337a54. next'), ['0337a54'], 'sentence-ending period then space');
});

// --- source-scan guards (T17–T19) ---------------------------------------

test('T17 AC-17: the chip is not a link site — app.js has exactly 9 `.href =` and 0 setAttribute(\'href\'; the new modules have none', () => {
  const app = read('app.js');
  const hrefAssigns = app.match(/\.href\s*=/g) || [];
  assert.equal(hrefAssigns.length, 9, `app.js .href assignments (got ${hrefAssigns.length})`);
  assert.equal((app.match(/setAttribute\(\s*['"]href['"]/g) || []).length, 0, 'app.js has no setAttribute(href)');
  // Anchored: none of the href assignments lives inside copyRefNode.
  const at = app.indexOf('function copyRefNode(');
  assert.ok(at !== -1, 'copyRefNode is present');
  const body = app.slice(at, app.indexOf('\n}\n', at));
  assert.doesNotMatch(body, /\.href\s*=|setAttribute\(\s*['"]href['"]|Object\.assign\(|['"]href['"]\s*\]/, 'copyRefNode assigns no href of any spelling');
  assert.match(body, /el\('span', 'copy-ref'/, 'the chip is a span');
  for (const f of ['copy-refs.js', 'leaf-refs.js']) {
    const src = read(f);
    assert.equal((src.match(/\.href\s*=/g) || []).length, 0, `${f}: no .href assignment`);
    assert.equal((src.match(/setAttribute\(\s*['"]href['"]/g) || []).length, 0, `${f}: no setAttribute(href)`);
  }
});

test('T18 AC-18: index.html links /tokens.css before /style.css and pins data-theme="light"', () => {
  const html = read('index.html');
  const tokensAt = html.indexOf('<link rel="stylesheet" href="/tokens.css">');
  const styleAt = html.indexOf('<link rel="stylesheet" href="/style.css">');
  assert.ok(tokensAt !== -1, 'tokens.css is linked');
  assert.ok(styleAt !== -1, 'style.css is linked');
  assert.ok(tokensAt < styleAt, 'tokens.css precedes style.css');
  assert.match(html, /<html[^>]*\sdata-theme="light"[^>]*>/, '<html> carries data-theme="light"');
});

test('T19 AC-19: the .copy-ref rule blocks use tokens only — no #hex and no px literal', () => {
  const css = read('style.css');
  const blocks = [...css.matchAll(/^[^\n{]*\.copy-ref[^\n{]*\{([^}]*)\}/gm)];
  assert.equal(blocks.length, 5, `cardinality: 5 .copy-ref rule blocks (got ${blocks.length})`);
  for (const b of blocks) {
    assert.doesNotMatch(b[1], /#[0-9a-fA-F]{3,8}\b/, `no hex literal in: ${b[0].split('\n')[0]}`);
    assert.doesNotMatch(b[1], /\d(px|rem|em)\b/, `no raw length in: ${b[0].split('\n')[0]}`);
  }
  const declared = blocks.map((b) => b[1]).join('\n').match(/var\(--[a-z0-9-]+\)/g) || [];
  assert.ok(declared.length >= 10, `token references present (got ${declared.length})`);
  const tokens = read('tokens.css');
  for (const v of new Set(declared)) {
    const name = v.slice(4, -1);
    assert.ok(tokens.includes(`${name}:`), `${name} is defined in tokens.css`);
  }
});
