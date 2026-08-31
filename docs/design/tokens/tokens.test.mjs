// Run: node --test 'docs/design/tokens/*.test.mjs'   (from repo root)
// Node 22+ takes a GLOB, not a directory — `node --test <dir>` fails with
// "Could not find". Verified on v24.13.1 in this environment.
//
// This is a PARITY test: it parses BRANDING.md's own markdown tables — the
// specification, not code checking code — and compares them against
// tokens.css and tokens.json. Zero dependencies: node:test + node:assert/strict.
//
// Design principle (non-negotiable, per .lattice/plans/task_01M1C5EK9EP82NFSS9DZF43V7T.md
// §8.1.9): a parser that silently finds zero tokens and reports success is
// the exact failure mode this test exists to prevent (AS-17, AS-26). Every
// extraction helper below throws a distinct, named error naming the section
// or marker it could not find, rather than returning an empty/partial result.
//
// Two corollaries, both learned the hard way in review cycle 1, where four
// assertions passed while the property they named was false:
//
//   1. AN ASSERTION MUST NAME WHAT IT COVERS, AND COVER ALL OF IT. The
//      "nothing extra" scan examined tokens.css block 1 only while claiming
//      completeness in both directions, so an undocumented brand value
//      declared one block lower went green. tokens.json's primitives and
//      alias fields were read by nothing at all.
//   2. EVERY SCAN CARRIES A FLOOR. A guard that only ran on one branch let a
//      zero-byte reference.css pass; a Result column the parser stopped
//      understanding let the AA check run zero assertions and report green.
//      Where this file loops over parsed material, it asserts how much
//      material it actually saw. Adjust a floor only alongside the change
//      that legitimately moved it.
//
// Rule for anyone editing this file: mutate the thing your assertion claims
// to check, run the suite, and confirm it fails. A check you cannot
// demonstrate failing is not a check.
//
// Side effect, deliberate (plan §8.3): this test COMPUTES the full
// foreground x background x mode contrast matrix and WRITES it into
// tokens.json's "contrast" field each run (idempotent — only touches the
// file if the computed matrix actually differs from what's on disk).
// tokens.json.contrast is generated output, not hand-authored; if this test
// stops reading/writing it, delete the field.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const BRANDING_PATH = join(REPO_ROOT, 'BRANDING.md');
const TOKENS_CSS_PATH = join(HERE, 'tokens.css');
const TOKENS_JSON_PATH = join(HERE, 'tokens.json');
const STYLE_REF_HTML_PATH = join(REPO_ROOT, 'docs', 'design', 'style-reference', 'index.html');
const STYLE_REF_CSS_PATH = join(REPO_ROOT, 'docs', 'design', 'style-reference', 'reference.css');

const branding = readFileSync(BRANDING_PATH, 'utf8');
const tokensCss = readFileSync(TOKENS_CSS_PATH, 'utf8');
const tokensJsonRaw = readFileSync(TOKENS_JSON_PATH, 'utf8');
const tokensJson = JSON.parse(tokensJsonRaw);
const styleRefHtml = readFileSync(STYLE_REF_HTML_PATH, 'utf8');
const styleRefCss = readFileSync(STYLE_REF_CSS_PATH, 'utf8');

// ----------------------------------------------------------------------------
// Floors. A scan that examines nothing must never be able to report success —
// that is the AS-17 / AS-26 failure mode, and it recurred here in review cycle
// 1 (truncating reference.css to zero bytes left the suite 28/28 green while
// the page rendered completely unstyled). Every floor below is set well under
// what the shipped files contain today, so ordinary editing never trips one;
// they fire only when a file has been emptied, truncated, or had the structure
// the parsers depend on destroyed.
// ----------------------------------------------------------------------------
const MIN_FILE_BYTES = {
  'BRANDING.md': 20000,
  'docs/design/tokens/tokens.css': 5000,
  'docs/design/style-reference/index.html': 20000,
  'docs/design/style-reference/reference.css': 8000,
};
for (const [label, text] of [
  ['BRANDING.md', branding],
  ['docs/design/tokens/tokens.css', tokensCss],
  ['docs/design/style-reference/index.html', styleRefHtml],
  ['docs/design/style-reference/reference.css', styleRefCss],
]) {
  if (text.length < MIN_FILE_BYTES[label]) {
    throw new Error(
      `FORMAT CONTRACT BROKEN in ${label}: file is ${text.length} bytes, below the ${MIN_FILE_BYTES[label]}-byte floor. ` +
      `Something truncated or emptied it — every scan below would examine little or nothing and report success. ` +
      `This is a hard failure, not a skip.`
    );
  }
}

// ============================================================================
// Generic, fail-loud extraction helpers
// ============================================================================

/** Slice text between two literal markers. Throws a NAMED error if either is missing. */
function sliceBetween(text, startMarker, endMarker, sourceLabel) {
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(
      `FORMAT CONTRACT BROKEN in ${sourceLabel}: could not find start marker ${JSON.stringify(startMarker)}. ` +
      `The parser cannot locate this section — this is a hard failure, not a skip.`
    );
  }
  const contentStart = startIdx + startMarker.length;
  if (endMarker == null) return text.slice(contentStart);
  const endIdx = text.indexOf(endMarker, contentStart);
  if (endIdx === -1) {
    throw new Error(
      `FORMAT CONTRACT BROKEN in ${sourceLabel}: found start marker ${JSON.stringify(startMarker)} but not ` +
      `end marker ${JSON.stringify(endMarker)} after it. The parser cannot bound this section — this is a hard failure, not a skip.`
    );
  }
  return text.slice(contentStart, endIdx);
}

/** Strip backticks and surrounding markdown bold/whitespace from a table cell. */
function stripCode(cell) {
  return cell.replace(/`/g, '').replace(/\*\*/g, '').trim();
}

/**
 * Extract every pipe-table in a block of markdown text as an array of tables,
 * each table an array of rows, each row an array of raw (un-stripped) cells.
 * Separator rows (|---|---|) are dropped. Throws if NO tables are found —
 * silently returning [] would be exactly the AS-17/AS-26 failure mode.
 */
function extractTables(text, sourceLabel) {
  const lines = text.split('\n');
  const tables = [];
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1) {
      const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
      // Separator row (e.g. "|---|---|" or "|:--|--:|") — every cell is only
      // dashes/colons. Must split into cells FIRST: a whole-line regex like
      // /^\|[\s:-]+\|$/ cannot match a multi-column separator because the
      // "|" between columns isn't in that character class.
      const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));
      if (isSeparator) continue;
      if (!current) current = [];
      current.push(cells);
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);
  if (tables.length === 0) {
    throw new Error(`FORMAT CONTRACT BROKEN in ${sourceLabel}: no pipe tables found in this section at all.`);
  }
  return tables;
}

function requireTable(tables, predicate, description, sourceLabel) {
  const found = tables.find(predicate);
  if (!found) {
    throw new Error(`FORMAT CONTRACT BROKEN in ${sourceLabel}: expected to find a table for "${description}" but none matched.`);
  }
  return found;
}

// ============================================================================
// §3.1 Primitives
// ============================================================================

const primitivesSection = sliceBetween(branding, '### 3.1 Primitives', '### 3.2 Semantic tokens', 'BRANDING.md §3.1');
const primTables = extractTables(primitivesSection, 'BRANDING.md §3.1');

const inkTable = requireTable(primTables, (t) => t[1] && stripCode(t[1][0]).includes('--color-ink-'), 'ink primitives', 'BRANDING.md §3.1');
const accentTable = requireTable(primTables, (t) => t[1] && stripCode(t[1][0]).includes('--color-accent-'), 'accent primitives', 'BRANDING.md §3.1');
const statusTable = requireTable(primTables, (t) => t[0][0] === 'Scale', 'success/warning/danger status scales', 'BRANDING.md §3.1');

const brandingPrimitives = {}; // shortName -> hex

function shortNameOf(fullToken) {
  // "--color-ink-50" -> "ink-50"
  const m = fullToken.match(/^--color-(.+)$/);
  if (!m) throw new Error(`FORMAT CONTRACT BROKEN in BRANDING.md §3.1: token "${fullToken}" doesn't match --color-<name>.`);
  return m[1];
}

for (const row of inkTable.slice(1)) {
  const [tokenCell, hexCell] = row.map(stripCode);
  brandingPrimitives[shortNameOf(tokenCell)] = hexCell.toUpperCase();
}
for (const row of accentTable.slice(1)) {
  const [tokenCell, hexCell] = row.map(stripCode);
  brandingPrimitives[shortNameOf(tokenCell)] = hexCell.toUpperCase();
}
for (const row of statusTable.slice(1)) {
  const [scaleCell, , , tokenListCell] = row.map(stripCode);
  const scale = scaleCell.trim();
  const stepMatches = [...tokenListCell.matchAll(/(-\d+)\s+(#[0-9A-Fa-f]{6})/g)];
  if (stepMatches.length === 0) {
    throw new Error(`FORMAT CONTRACT BROKEN in BRANDING.md §3.1: status scale row "${scale}" has no parseable step/hex pairs.`);
  }
  for (const [, step, hex] of stepMatches) {
    brandingPrimitives[`${scale}${step}`] = hex.toUpperCase();
  }
}

test('§3.1 primitives — pinned counts (12 ink, 10 accent)', () => {
  const inkCount = Object.keys(brandingPrimitives).filter((k) => k.startsWith('ink-')).length;
  const accentCount = Object.keys(brandingPrimitives).filter((k) => k.startsWith('accent-')).length;
  assert.equal(inkCount, 12, 'BRANDING.md §3.1 ink primitives count');
  assert.equal(accentCount, 10, 'BRANDING.md §3.1 accent primitives count');
  assert.equal(Object.keys(brandingPrimitives).length, 43, 'total primitive count (12 ink + 10 accent + 7 success + 6 warning + 8 danger)');
});

// ============================================================================
// tokens.css block extraction (fail-loud on missing markers)
// ============================================================================

function parseCssDeclarations(cssText) {
  const out = {};
  const re = /--([a-zA-Z0-9-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(cssText))) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/**
 * Parse ordinary (non-custom-property) declarations out of a block — used for
 * `color-scheme`, which plan §4.1 requires alongside the semantic layer so
 * native <input>/<select>/scrollbars follow the theme. Custom properties are
 * excluded here; parseCssDeclarations owns those.
 */
function parsePlainDeclarations(cssText) {
  const out = {};
  const re = /(?:^|[{;])\s*([a-zA-Z][a-zA-Z0-9-]*)\s*:\s*([^;{}]+);/g;
  let m;
  while ((m = re.exec(cssText))) {
    if (m[1].startsWith('--')) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

const block1Text = sliceBetween(tokensCss, 'BLOCK 1 — PRIMITIVES', 'BLOCK 2 — LIGHT SEMANTICS', 'tokens.css');
const block2Text = sliceBetween(tokensCss, 'BLOCK 2 — LIGHT SEMANTICS', 'BLOCK 3 — DARK SEMANTICS', 'tokens.css');
const block3Text = sliceBetween(tokensCss, 'BLOCK 3 — DARK SEMANTICS', 'BLOCK 4 — EXPLICIT DARK', 'tokens.css');
const block4Text = sliceBetween(tokensCss, 'BLOCK 4 — EXPLICIT DARK', null, 'tokens.css');

const cssBlock1 = parseCssDeclarations(block1Text); // primitives + all scheme-independent scales
const cssBlock2 = parseCssDeclarations(block2Text); // light semantics, raw var() strings
const cssBlock3 = parseCssDeclarations(block3Text); // dark semantics (media), raw var() strings
const cssBlock4 = parseCssDeclarations(block4Text); // dark semantics (explicit), raw var() strings

if (Object.keys(cssBlock1).length === 0) throw new Error('FORMAT CONTRACT BROKEN in tokens.css: block 1 parsed to zero declarations.');
if (Object.keys(cssBlock2).length === 0) throw new Error('FORMAT CONTRACT BROKEN in tokens.css: block 2 parsed to zero declarations.');
if (Object.keys(cssBlock3).length === 0) throw new Error('FORMAT CONTRACT BROKEN in tokens.css: block 3 parsed to zero declarations.');
if (Object.keys(cssBlock4).length === 0) throw new Error('FORMAT CONTRACT BROKEN in tokens.css: block 4 parsed to zero declarations.');

/** Resolve a raw `var(--color-X)` (or bare hex) declaration to its final hex, chasing at most one semantic->semantic hop. */
function resolveCssValue(rawValue, semanticBlockDict, primDict) {
  const m = rawValue.match(/^var\(--color-(.+)\)$/);
  if (!m) return rawValue.toUpperCase(); // already a literal (primitives block)
  const name = m[1];
  if (Object.prototype.hasOwnProperty.call(semanticBlockDict, `color-${name}`)) {
    return resolveCssValue(semanticBlockDict[`color-${name}`], semanticBlockDict, primDict);
  }
  if (Object.prototype.hasOwnProperty.call(primDict, name)) {
    return primDict[name].toUpperCase();
  }
  throw new Error(`tokens.css: cannot resolve var(--color-${name}) — not found in this block's semantics or in primitives.`);
}

const cssPrimitives = {};
for (const [key, value] of Object.entries(cssBlock1)) {
  if (key.startsWith('color-')) {
    const short = key.replace(/^color-/, '');
    // only real primitive scales (ink/accent/success/warning/danger), not font-family etc (those aren't "color-" prefixed anyway)
    cssPrimitives[short] = value.toUpperCase();
  }
}

// ============================================================================
// §3.2 / §3.3 Semantic tokens
// ============================================================================

function parseSemanticSection(sectionText, sourceLabel) {
  const tables = extractTables(sectionText, sourceLabel);
  const table = requireTable(tables, (t) => t[0].map(stripCode).join('|') === 'Token|Value|Alias of', 'semantic token table', sourceLabel);
  const out = {}; // shortName -> { value, aliasRaw }
  for (const row of table.slice(1)) {
    const [tokenCell, valueCell, aliasCell] = row.map(stripCode);
    const short = shortNameOf(tokenCell);
    out[short] = { value: valueCell.toUpperCase(), aliasRaw: aliasCell.replace(/^=\s*/, '') };
  }
  return out;
}

const lightSection = sliceBetween(branding, '### 3.2 Semantic tokens — light mode', '### 3.3 Semantic tokens — dark mode', 'BRANDING.md §3.2');
const darkSemanticSection = sliceBetween(branding, '### 3.3 Semantic tokens — dark mode', '### 3.4 Contrast ratios', 'BRANDING.md §3.3');
const brandingLight = parseSemanticSection(lightSection, 'BRANDING.md §3.2');
const brandingDark = parseSemanticSection(darkSemanticSection, 'BRANDING.md §3.3');

test('§3.2/§3.3 semantic tokens — pinned counts (28 light, 28 dark)', () => {
  assert.equal(Object.keys(brandingLight).length, 28, 'BRANDING.md §3.2 light alias count');
  assert.equal(Object.keys(brandingDark).length, 28, 'BRANDING.md §3.3 dark alias count');
});

test('§3.2 light semantic tokens — value equality across BRANDING.md, tokens.css, tokens.json', () => {
  let checked = 0;
  for (const [short, { value }] of Object.entries(brandingLight)) {
    const cssKey = `color-${short}`;
    assert.ok(Object.prototype.hasOwnProperty.call(cssBlock2, cssKey), `tokens.css block 2 missing --${cssKey}`);
    const cssResolved = resolveCssValue(cssBlock2[cssKey], cssBlock2, cssPrimitives);
    assert.equal(cssResolved, value, `tokens.css light --${cssKey} resolves to ${cssResolved}, BRANDING.md says ${value}`);

    assert.ok(tokensJson.semantic?.light?.[cssKey], `tokens.json semantic.light missing "${cssKey}"`);
    assert.equal(tokensJson.semantic.light[cssKey].value.toUpperCase(), value, `tokens.json semantic.light.${cssKey}.value mismatch`);
    checked += 1;
  }
  assert.equal(checked, 28, 'must compare all 28 light semantic tokens — a parse that yielded none would otherwise report green');
});

test('§3.3 dark semantic tokens — value equality across BRANDING.md, tokens.css (both blocks), tokens.json', () => {
  let checked = 0;
  for (const [short, { value }] of Object.entries(brandingDark)) {
    const cssKey = `color-${short}`;
    assert.ok(Object.prototype.hasOwnProperty.call(cssBlock3, cssKey), `tokens.css block 3 missing --${cssKey}`);
    assert.ok(Object.prototype.hasOwnProperty.call(cssBlock4, cssKey), `tokens.css block 4 missing --${cssKey}`);
    const resolved3 = resolveCssValue(cssBlock3[cssKey], cssBlock3, cssPrimitives);
    const resolved4 = resolveCssValue(cssBlock4[cssKey], cssBlock4, cssPrimitives);
    assert.equal(resolved3, value, `tokens.css block 3 dark --${cssKey} resolves to ${resolved3}, BRANDING.md says ${value}`);
    assert.equal(resolved4, value, `tokens.css block 4 dark --${cssKey} resolves to ${resolved4}, BRANDING.md says ${value}`);

    assert.ok(tokensJson.semantic?.dark?.[cssKey], `tokens.json semantic.dark missing "${cssKey}"`);
    assert.equal(tokensJson.semantic.dark[cssKey].value.toUpperCase(), value, `tokens.json semantic.dark.${cssKey}.value mismatch`);
    checked += 1;
  }
  assert.equal(checked, 28, 'must compare all 28 dark semantic tokens — a parse that yielded none would otherwise report green');
});

test('dark-block duplication invariant — tokens.css block 3 and block 4 declare the same tokens with identical raw and resolved values', () => {
  // NOT filtered on the `color-` prefix (review cycle 1, V1): filtering meant a
  // 4th geometry token added to BOTH dark blocks was invisible to this
  // invariant AND to the block-1-only completeness scan. Compare every custom
  // property either block declares.
  const keys3 = Object.keys(cssBlock3).sort();
  const keys4 = Object.keys(cssBlock4).sort();
  assert.deepEqual(keys3, keys4, 'block 3 and block 4 declare a different set of custom properties');
  assert.deepEqual(keys3.filter((k) => !k.startsWith('color-')), [], 'blocks 3/4 must declare only color- semantics');
  assert.equal(keys3.length, 28, 'block 3/4 token count');
  for (const key of keys3) {
    // Raw declaration text first: plan §4.2 asks for the two blocks to be
    // identical in content, not merely to resolve alike.
    assert.equal(cssBlock3[key], cssBlock4[key], `--${key} raw declaration differs between block 3 and block 4`);
    const r3 = resolveCssValue(cssBlock3[key], cssBlock3, cssPrimitives);
    const r4 = resolveCssValue(cssBlock4[key], cssBlock4, cssPrimitives);
    assert.equal(r3, r4, `--${key} differs between block 3 (${r3}) and block 4 (${r4})`);
  }
});

test('color-scheme is declared alongside every semantic block (plan §4.1)', () => {
  // Asserted nowhere before review cycle 1 (B4). It matters for the native
  // <input>, <select> and scrollbars the style reference renders: without it
  // they keep the OS scheme while everything around them re-themes.
  assert.equal(parsePlainDeclarations(block2Text)['color-scheme'], 'light', 'tokens.css block 2 (light semantics) must declare color-scheme: light');
  assert.equal(parsePlainDeclarations(block3Text)['color-scheme'], 'dark', 'tokens.css block 3 (dark under prefers-color-scheme) must declare color-scheme: dark');
  assert.equal(parsePlainDeclarations(block4Text)['color-scheme'], 'dark', 'tokens.css block 4 (explicit dark) must declare color-scheme: dark');
});

test('§3.1 primitives — tokens.json.primitive.color matches BRANDING.md in BOTH directions', () => {
  // Review cycle 1, V2: nothing read tokensJson.primitive at all. Corrupting
  // ink-50 passed; deleting all 43 primitives passed. Plan §8.1.1 requires
  // three-way equality, and criterion 3 requires every §3.1 token present in
  // BOTH artifacts — for tokens.json that was entirely unenforced.
  assert.ok(tokensJson.primitive, 'tokens.json has no "primitive" key at all');
  const jsonPrimitives = tokensJson.primitive.color;
  assert.ok(jsonPrimitives && typeof jsonPrimitives === 'object', 'tokens.json.primitive.color missing or not an object');

  // Nothing missing: every BRANDING.md §3.1 primitive is present with the same hex.
  for (const [short, hex] of Object.entries(brandingPrimitives)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(jsonPrimitives, short),
      `tokens.json primitive.color missing "${short}" (BRANDING.md §3.1 documents it as ${hex})`
    );
    assert.equal(String(jsonPrimitives[short]).toUpperCase(), hex, `tokens.json primitive.color.${short}`);
  }
  // Nothing extra: no primitive in tokens.json that BRANDING.md does not document.
  for (const short of Object.keys(jsonPrimitives)) {
    assert.ok(brandingPrimitives[short] !== undefined, `tokens.json primitive.color."${short}" is not in BRANDING.md §3.1`);
  }
  // And the count is pinned, so a row deleted from both sides at once is caught.
  assert.equal(Object.keys(jsonPrimitives).length, 43, 'tokens.json primitive.color count');
  // tokens.css block 1 and tokens.json must agree too (the third leg of §8.1.1).
  for (const [short, hex] of Object.entries(brandingPrimitives)) {
    assert.equal(cssPrimitives[short], hex, `tokens.css block 1 --color-${short}`);
  }
});

test('alias integrity — every semantic token resolves to the hex its "Alias of" column names (light + dark)', () => {
  let checked = 0;
  for (const [mode, dict, primOrSemLookup] of [
    ['light', brandingLight, brandingLight],
    ['dark', brandingDark, brandingDark],
  ]) {
    for (const [short, { value, aliasRaw }] of Object.entries(dict)) {
      if (brandingPrimitives[aliasRaw] !== undefined) {
        assert.equal(brandingPrimitives[aliasRaw], value, `${mode} --color-${short}: alias "${aliasRaw}" is a primitive with hex ${brandingPrimitives[aliasRaw]}, but the semantic table says ${value}`);
      } else if (primOrSemLookup[aliasRaw] !== undefined) {
        // semantic-to-semantic alias (only --color-focus-ring: "= accent-solid" today)
        assert.equal(primOrSemLookup[aliasRaw].value, value, `${mode} --color-${short}: alias "${aliasRaw}" is semantic token with value ${primOrSemLookup[aliasRaw].value}, but the row says ${value}`);
      } else {
        throw new Error(`${mode} --color-${short}: alias "${aliasRaw}" is neither a known primitive nor a known semantic token.`);
      }
      checked += 1;
    }
  }
  assert.equal(checked, 56, 'must check all 56 semantic aliases (28 light + 28 dark)');
});

test('alias parity — tokens.json records the same "Alias of" name BRANDING.md does (56 semantic tokens)', () => {
  // Review cycle 1, B1: replacing all 56 alias fields with "WRONG-ALIAS" left
  // the suite green. Plan §5 names this column as precisely what makes the
  // parity check meaningful ("it catches 'alias says ink-700, value is
  // ink-600'") and what a future re-theme needs — so it has to be read.
  let checked = 0;
  for (const [mode, dict] of [['light', brandingLight], ['dark', brandingDark]]) {
    const jsonMode = tokensJson.semantic?.[mode];
    assert.ok(jsonMode, `tokens.json semantic.${mode} missing`);
    for (const [short, { value, aliasRaw }] of Object.entries(dict)) {
      const cssKey = `color-${short}`;
      const entry = jsonMode[cssKey];
      assert.ok(entry, `tokens.json semantic.${mode} missing "${cssKey}"`);
      assert.equal(entry.alias, aliasRaw, `tokens.json semantic.${mode}.${cssKey}.alias — BRANDING.md §3.${mode === 'light' ? 2 : 3} says "${aliasRaw}"`);
      // ...and the recorded alias must still close over the recorded value, so
      // a rename that keeps both columns internally consistent but wrong is
      // caught by the alias-integrity test above, and a mismatched pair here.
      const aliasHex = brandingPrimitives[aliasRaw] ?? dict[aliasRaw]?.value;
      assert.equal(aliasHex, value, `tokens.json semantic.${mode}.${cssKey}: alias "${aliasRaw}" does not resolve to the recorded value ${value}`);
      assert.equal(String(entry.value).toUpperCase(), value, `tokens.json semantic.${mode}.${cssKey}.value`);
      checked += 1;
    }
    // Nothing extra in tokens.json either.
    for (const key of Object.keys(jsonMode)) {
      assert.ok(dict[key.replace(/^color-/, '')] !== undefined, `tokens.json semantic.${mode}."${key}" is not in BRANDING.md`);
    }
  }
  assert.equal(checked, 56, 'alias parity must examine all 56 semantic tokens (28 light + 28 dark)');
});

// ============================================================================
// §3.4 Contrast ratios — parity + generated matrix
// ============================================================================

/**
 * Parse a §3.4 Result cell STRICTLY.
 *
 * Review cycle 1, V4: this used to be `resultCell.split(/\s|—/)[0]`, which
 * silently degraded. `| ✅ PASS |` parsed to the token "✅", matched no branch
 * downstream, and switched off that row's threshold assertion — and with the
 * whole table decorated, the §8.3 test ran zero assertions and reported green.
 * A brand doc adding a tick emoji to its own table must break the build
 * loudly, not quietly stop enforcing AA.
 *
 * The contract: the cell is exactly one of PASS / FAIL / EXEMPT / DECORATIVE,
 * optionally followed by " — <rationale>" (which is how §3.4 writes its two
 * EXEMPT/DECORATIVE rows today). Anything else is a format breach.
 */
const RESULT_CONTRACT = /^(PASS|FAIL|EXEMPT|DECORATIVE)(?:\s*—\s*\S[\s\S]*)?$/;
function parseResultCell(resultCell, pairCell, sourceLabel) {
  const m = RESULT_CONTRACT.exec(resultCell);
  if (!m) {
    throw new Error(
      `FORMAT CONTRACT BROKEN in ${sourceLabel}: Result cell ${JSON.stringify(resultCell)} for pair ` +
      `"${pairCell}" is not one of PASS / FAIL / EXEMPT / DECORATIVE (optionally followed by " — <rationale>"). ` +
      `A decorated or reworded verdict must never silently disable this row's threshold assertion — ` +
      `this is a hard failure, not a skip.`
    );
  }
  return m[1];
}

function parseContrastSection(sectionText, sourceLabel) {
  const tables = extractTables(sectionText, sourceLabel);
  const table = requireTable(tables, (t) => t[0].map(stripCode).join('|') === 'Pair|Ratio|Threshold|Result', 'contrast ratio table', sourceLabel);
  const rows = [];
  const pairRe = /^([a-z0-9-]+)(?:\s*\(white\))?\s+(?:boundary\s+)?(?:on|vs)\s+([a-z0-9-]+)(?:\s*\(non-text\))?$/i;
  for (const row of table.slice(1)) {
    const [pairCell, ratioCell, thresholdCell, resultCell] = row.map(stripCode);
    const m = pairCell.match(pairRe);
    if (!m) {
      throw new Error(`FORMAT CONTRACT BROKEN in ${sourceLabel}: could not parse Pair column "${pairCell}".`);
    }
    const fg = shortNameOf(`--color-${m[1]}`);
    const bg = shortNameOf(`--color-${m[2]}`);
    const ratio = parseFloat(ratioCell);
    const threshold = thresholdCell === '—' ? null : parseFloat(thresholdCell);
    const result = parseResultCell(resultCell, pairCell, sourceLabel);
    if (!Number.isFinite(ratio)) {
      throw new Error(`FORMAT CONTRACT BROKEN in ${sourceLabel}: Ratio cell ${JSON.stringify(ratioCell)} for pair "${pairCell}" is not a number.`);
    }
    if (result === 'PASS' && threshold === null) {
      throw new Error(`FORMAT CONTRACT BROKEN in ${sourceLabel}: pair "${pairCell}" claims PASS but its Threshold cell is ${JSON.stringify(thresholdCell)}, not a number.`);
    }
    rows.push({ fg, bg, ratio, threshold, result });
  }
  return rows;
}

const lightContrastSection = sliceBetween(branding, '**Light mode**', '**Dark mode**', 'BRANDING.md §3.4 light');
const darkContrastSection = sliceBetween(branding, '**Dark mode**', '\n---\n', 'BRANDING.md §3.4 dark');
const brandingContrastLight = parseContrastSection(lightContrastSection, 'BRANDING.md §3.4 light');
const brandingContrastDark = parseContrastSection(darkContrastSection, 'BRANDING.md §3.4 dark');

test('§3.4 contrast — pinned row counts (27 light, 27 dark = 54 total)', () => {
  assert.equal(brandingContrastLight.length, 27, 'light contrast row count');
  assert.equal(brandingContrastDark.length, 27, 'dark contrast row count');
});

// --- WCAG 2.1 relative-luminance contrast, per BRANDING.md §11 ---
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function relativeLuminance([r, g, b]) {
  const lin = (c) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [r, g, b].map(lin);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}
function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

function hexForShortName(mode, shortName) {
  const dict = mode === 'light' ? brandingLight : brandingDark;
  if (dict[shortName]) return dict[shortName].value;
  if (brandingPrimitives[shortName]) return brandingPrimitives[shortName];
  throw new Error(`Cannot resolve "${shortName}" in ${mode} mode — not a known semantic token or primitive.`);
}

test('§3.4 contrast recomputation — every documented row recomputes to the documented ratio (2dp) and clears its threshold when PASS', () => {
  let rowsChecked = 0;
  let passRowsChecked = 0;
  for (const [mode, rows] of [['light', brandingContrastLight], ['dark', brandingContrastDark]]) {
    for (const { fg, bg, ratio, threshold, result } of rows) {
      const computed = round2(contrastRatio(hexForShortName(mode, fg), hexForShortName(mode, bg)));
      assert.equal(computed, ratio, `${mode} ${fg} on ${bg}: recomputed ${computed}, BRANDING.md documents ${ratio}`);
      rowsChecked += 1;
      if (result === 'PASS') {
        assert.ok(threshold !== null, `${mode} ${fg} on ${bg}: result PASS but no numeric threshold parsed`);
        assert.ok(computed >= threshold, `${mode} ${fg} on ${bg}: documented PASS at ${computed}:1 does not clear its own ${threshold}:1 floor`);
        passRowsChecked += 1;
      }
    }
  }
  // Floors (review cycle 1, V4): without these, a Result column the parser
  // stopped understanding would leave this test running zero threshold
  // assertions and still reporting green.
  assert.equal(rowsChecked, 54, 'must recompute all 54 documented rows (27 light + 27 dark)');
  assert.equal(passRowsChecked, 50, 'must check the threshold of all 50 documented PASS rows (54 less 2 EXEMPT and 2 DECORATIVE)');
});

// --- Generated full matrix (§8.3): 19 foregrounds x 3 backgrounds x 2 modes ---
// text-on-accent / text-on-danger are deliberately excluded: they are
// single-purpose "text on that color's own solid fill" tokens, not
// general-purpose text used against neutral backgrounds. Their only valid
// pairings are already covered by the §3.4 parity rows above. The four
// *-bg-subtle tokens are excluded for the same reason (they are backgrounds
// for their matching *-text-on-subtle token, not foregrounds).
const MATRIX_FOREGROUNDS = {
  'text-primary': 'text', 'text-secondary': 'text', 'text-muted': 'text', 'text-disabled': 'exempt',
  'border-hairline': 'decorative', 'border-interactive': 'non-text',
  'link': 'text',
  'accent-solid': 'non-text', 'accent-solid-hover': 'non-text', 'accent-text-on-subtle': 'text', 'focus-ring': 'non-text',
  'success-text': 'text', 'success-text-on-subtle': 'text',
  'warning-text': 'text', 'warning-text-on-subtle': 'text',
  'danger-text': 'text', 'danger-text-on-subtle': 'text',
  'danger-solid': 'non-text', 'danger-solid-hover': 'non-text',
};
const MATRIX_BACKGROUNDS = ['bg-canvas', 'bg-surface', 'bg-surface-sunken'];
const MATRIX_MODES = ['light', 'dark'];

function buildContrastMatrix() {
  const matrix = [];
  for (const mode of MATRIX_MODES) {
    for (const bg of MATRIX_BACKGROUNDS) {
      for (const [fg, kind] of Object.entries(MATRIX_FOREGROUNDS)) {
        const computed = round2(contrastRatio(hexForShortName(mode, fg), hexForShortName(mode, bg)));
        const threshold = kind === 'text' ? 4.5 : kind === 'non-text' ? 3.0 : null;
        let result;
        if (kind === 'exempt') result = 'EXEMPT';
        else if (kind === 'decorative') result = 'DECORATIVE';
        else result = computed >= threshold ? 'PASS' : 'FAIL';
        matrix.push({ mode, foreground: `color-${fg}`, background: `color-${bg}`, ratio: computed, threshold, kind, result });
      }
    }
  }
  return matrix;
}

const generatedMatrix = buildContrastMatrix();

test('generated contrast matrix — pinned size (19 fg x 3 bg x 2 modes = 114 rows)', () => {
  assert.equal(generatedMatrix.length, 114);
});

test('generated contrast matrix — every §3.4-documented PASS row still passes in the generated matrix', () => {
  const byKey = new Map(generatedMatrix.map((r) => [`${r.mode}|${r.foreground}|${r.background}`, r]));
  let asserted = 0;
  for (const [mode, rows] of [['light', brandingContrastLight], ['dark', brandingContrastDark]]) {
    for (const { fg, bg, result } of rows) {
      if (result !== 'PASS') continue;
      const key = `${mode}|color-${fg}|color-${bg}`;
      const matched = byKey.get(key);
      if (!matched) continue; // pairs outside the 3-background cross-product (e.g. *-on-subtle on *-bg-subtle) aren't in this matrix — already covered by the parity test above
      assert.equal(matched.result, 'PASS', `${key}: BRANDING.md §3.4 documents PASS, generated matrix says ${matched.result} (${matched.ratio}:1)`);
      asserted += 1;
    }
  }
  // Floor (review cycle 1, V4): this test's whole job is comparing documented
  // PASS rows against the generated matrix. If the Result column stops parsing
  // — or the §3.4 tables shrink — it must fail, not quietly assert nothing.
  assert.equal(asserted, 34, 'must compare all 34 documented PASS rows that fall inside the generated cross-product');
});

test('generated contrast matrix — write to tokens.json.contrast (idempotent)', () => {
  const current = JSON.stringify(tokensJson.contrast ?? null);
  const next = JSON.stringify(generatedMatrix);
  if (current !== next) {
    const updated = { ...tokensJson, contrast: generatedMatrix };
    writeFileSync(TOKENS_JSON_PATH, JSON.stringify(updated, null, 2) + '\n');
  }
  // Re-read what's on disk now and assert it matches what we computed, so a
  // failure here means the write itself is broken, not just "was stale".
  const onDisk = JSON.parse(readFileSync(TOKENS_JSON_PATH, 'utf8'));
  assert.deepEqual(onDisk.contrast, generatedMatrix);
});

// ============================================================================
// §4.2 Type scale
// ============================================================================

const typeScaleSection = sliceBetween(branding, '### 4.2 Type scale', '### 4.3 Weights', 'BRANDING.md §4.2');
const typeTables = extractTables(typeScaleSection, 'BRANDING.md §4.2');
const typeScaleTable = requireTable(
  typeTables,
  (t) => t[0].map(stripCode).join('|').startsWith('Token|rem|px|Line-height token'),
  'type scale table',
  'BRANDING.md §4.2'
);

const brandingFontSize = {}; // shortName -> rem
const brandingLineHeight = {}; // shortName -> rem
for (const row of typeScaleTable.slice(1)) {
  const [tokenCell, remCell, , lhTokenCell, lhValueCell] = row.map(stripCode);
  const fsShort = tokenCell.replace(/^--font-size-/, '');
  const lhShort = lhTokenCell.replace(/^--line-height-/, '');
  brandingFontSize[fsShort] = remCell;
  brandingLineHeight[lhShort] = lhValueCell.split('/')[0].trim();
}
const relaxedMatch = typeScaleSection.match(/`--line-height-relaxed:\s*([0-9.]+)`/);
if (!relaxedMatch) {
  throw new Error('FORMAT CONTRACT BROKEN in BRANDING.md §4.2: could not find inline `--line-height-relaxed: N` definition.');
}
brandingLineHeight['relaxed'] = relaxedMatch[1];

test('§4.2 type scale — pinned counts (9 font sizes, 10 line-heights incl. relaxed) and cross-source equality', () => {
  assert.equal(Object.keys(brandingFontSize).length, 9, 'font-size step count');
  assert.equal(Object.keys(brandingLineHeight).length, 10, 'line-height step count (9 + relaxed)');
  for (const [short, rem] of Object.entries(brandingFontSize)) {
    assert.equal(cssBlock1[`font-size-${short}`], rem, `tokens.css --font-size-${short}`);
    assert.equal(tokensJson.scale['font-size'][short], rem, `tokens.json scale.font-size.${short}`);
  }
  for (const [short, rem] of Object.entries(brandingLineHeight)) {
    assert.equal(cssBlock1[`line-height-${short}`], rem, `tokens.css --line-height-${short}`);
    assert.equal(tokensJson.scale['line-height'][short], rem, `tokens.json scale.line-height.${short}`);
  }
});

// ============================================================================
// §4.3 Weights, §4.4 Letter-spacing
// ============================================================================

function parseSimpleTokenTable(sectionText, sourceLabel, tokenPrefix) {
  const tables = extractTables(sectionText, sourceLabel);
  const table = requireTable(tables, (t) => t[0].map(stripCode).join('|').startsWith('Token|Value'), `${tokenPrefix} table`, sourceLabel);
  const out = {};
  for (const row of table.slice(1)) {
    const [tokenCell, valueCell] = row.map(stripCode);
    out[tokenCell.replace(new RegExp(`^--${tokenPrefix}-`), '')] = valueCell;
  }
  return out;
}

const weightsSection = sliceBetween(branding, '### 4.3 Weights', '### 4.4 Letter-spacing', 'BRANDING.md §4.3');
const brandingWeights = parseSimpleTokenTable(weightsSection, 'BRANDING.md §4.3', 'font-weight');

const letterSpacingSection = sliceBetween(branding, '### 4.4 Letter-spacing', '## 5. Logo direction', 'BRANDING.md §4.4');
const brandingLetterSpacing = parseSimpleTokenTable(letterSpacingSection, 'BRANDING.md §4.4', 'letter-spacing');

test('§4.3 weights (4) and §4.4 letter-spacing (3) — cross-source equality', () => {
  assert.equal(Object.keys(brandingWeights).length, 4);
  assert.equal(Object.keys(brandingLetterSpacing).length, 3);
  for (const [short, value] of Object.entries(brandingWeights)) {
    assert.equal(cssBlock1[`font-weight-${short}`], value, `tokens.css --font-weight-${short}`);
    assert.equal(String(tokensJson.scale['font-weight'][short]), value, `tokens.json scale.font-weight.${short}`);
  }
  for (const [short, value] of Object.entries(brandingLetterSpacing)) {
    assert.equal(cssBlock1[`letter-spacing-${short}`], value, `tokens.css --letter-spacing-${short}`);
    assert.equal(tokensJson.scale['letter-spacing'][short], value, `tokens.json scale.letter-spacing.${short}`);
  }
});

// ============================================================================
// §4.1 Typefaces — font-family stacks verbatim (F1)
// ============================================================================

test('§4.1 font-family stacks are verbatim in tokens.css and tokens.json (F1)', () => {
  const sansStack = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const monoStack = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
  assert.ok(branding.includes(sansStack), 'sans stack literal not found in BRANDING.md §4.1 (fixture out of sync)');
  assert.ok(branding.includes(monoStack), 'mono stack literal not found in BRANDING.md §4.1 (fixture out of sync)');
  assert.equal(cssBlock1['font-family-sans'], sansStack);
  assert.equal(cssBlock1['font-family-mono'], monoStack);
  assert.equal(tokensJson.scale['font-family'].sans, sansStack);
  assert.equal(tokensJson.scale['font-family'].mono, monoStack);
});

// ============================================================================
// §6.1 Spacing, §6.2 Radius, §6.3 Shadow, §6.4 Breakpoints
// ============================================================================

const spacingSection = sliceBetween(branding, '### 6.1 Spacing scale', '### 6.2 Radius', 'BRANDING.md §6.1');
const spacingTables = extractTables(spacingSection, 'BRANDING.md §6.1');
const spacingTable = requireTable(spacingTables, (t) => t[0].map(stripCode).join('|') === 'Token|rem|px', 'spacing scale table', 'BRANDING.md §6.1');
const brandingSpace = {};
for (const row of spacingTable.slice(1)) {
  const [tokenCell, remCell] = row.map(stripCode);
  brandingSpace[tokenCell.replace(/^--space-/, '')] = remCell === '0' ? '0' : remCell;
}

test('§6.1 spacing scale — pinned count (13) and cross-source equality', () => {
  assert.equal(Object.keys(brandingSpace).length, 13);
  for (const [short, rem] of Object.entries(brandingSpace)) {
    assert.equal(cssBlock1[`space-${short}`], rem, `tokens.css --space-${short}`);
    assert.equal(tokensJson.scale.space[short], rem, `tokens.json scale.space.${short}`);
  }
});

const radiusSection = sliceBetween(branding, '### 6.2 Radius', '### 6.3 Elevation', 'BRANDING.md §6.2');
const radiusTables = extractTables(radiusSection, 'BRANDING.md §6.2');
const radiusTable = requireTable(radiusTables, (t) => t[0].map(stripCode).join('|').startsWith('Token|Value'), 'radius table', 'BRANDING.md §6.2');
const brandingRadius = {};
for (const row of radiusTable.slice(1)) {
  const [tokenCell, valueCell] = row.map(stripCode);
  const short = tokenCell.replace(/^--radius-/, '');
  brandingRadius[short] = valueCell.includes('/') ? valueCell.split('/')[0].trim() : valueCell.trim();
}

test('§6.2 radius — pinned count (4) and cross-source equality', () => {
  assert.equal(Object.keys(brandingRadius).length, 4);
  for (const [short, value] of Object.entries(brandingRadius)) {
    assert.equal(cssBlock1[`radius-${short}`], value, `tokens.css --radius-${short}`);
    assert.equal(tokensJson.scale.radius[short], value, `tokens.json scale.radius.${short}`);
  }
});

const shadowSection = sliceBetween(branding, '### 6.3 Elevation (shadow)', '### 6.4 Breakpoints', 'BRANDING.md §6.3');
const shadowTables = extractTables(shadowSection, 'BRANDING.md §6.3');
const shadowTable = requireTable(shadowTables, (t) => t[0].map(stripCode).join('|').startsWith('Token|Value'), 'shadow table', 'BRANDING.md §6.3');
const brandingShadow = {};
for (const row of shadowTable.slice(1)) {
  const [tokenCell, valueCell] = row.map(stripCode);
  brandingShadow[tokenCell.replace(/^--shadow-/, '')] = valueCell;
}

test('§6.3 shadow — pinned count (2) and cross-source equality', () => {
  assert.equal(Object.keys(brandingShadow).length, 2);
  for (const [short, value] of Object.entries(brandingShadow)) {
    assert.equal(cssBlock1[`shadow-${short}`], value, `tokens.css --shadow-${short}`);
    assert.equal(tokensJson.scale.shadow[short], value, `tokens.json scale.shadow.${short}`);
  }
});

const breakpointSection = sliceBetween(branding, '### 6.4 Breakpoints & containers', '### 6.5 Suggested token', 'BRANDING.md §6.4');
const breakpointTables = extractTables(breakpointSection, 'BRANDING.md §6.4');
const breakpointTable = requireTable(breakpointTables, (t) => t[0].map(stripCode).join('|').startsWith('Token|Value|Note'), 'breakpoints table', 'BRANDING.md §6.4');
const brandingBreakpoints = {};
const brandingLayout = {};
for (const row of breakpointTable.slice(1)) {
  const [tokenCell, valueCell] = row.map(stripCode);
  if (tokenCell.startsWith('--breakpoint-')) {
    brandingBreakpoints[tokenCell.replace(/^--breakpoint-/, '')] = valueCell;
  } else if (tokenCell === '--content-measure' || tokenCell === '--layout-max') {
    brandingLayout[tokenCell.replace(/^--/, '')] = valueCell.includes('/') ? valueCell.split('/')[0].trim() : valueCell.trim();
  }
}

test('§6.4 breakpoints — pinned count (4) and cross-source equality, plus content-measure/layout-max', () => {
  assert.equal(Object.keys(brandingBreakpoints).length, 4);
  for (const [short, value] of Object.entries(brandingBreakpoints)) {
    assert.equal(cssBlock1[`breakpoint-${short}`], value, `tokens.css --breakpoint-${short}`);
    assert.equal(tokensJson.scale.breakpoint[short], value, `tokens.json scale.breakpoint.${short}`);
  }
  assert.equal(Object.keys(brandingLayout).length, 2);
  for (const [short, value] of Object.entries(brandingLayout)) {
    assert.equal(cssBlock1[short], value, `tokens.css --${short}`);
    assert.equal(tokensJson.scale.layout[short], value, `tokens.json scale.layout.${short}`);
  }
});

test('@media breakpoint literals in tokens.css, index.html, reference.css carry a naming comment', () => {
  // Every hardcoded px literal inside an @media condition must carry a
  // `/* --breakpoint-* */`-style comment naming the token it stands in for
  // (var() is invalid inside a media query — BRANDING.md §6.4's gotcha).
  const files = [
    ['docs/design/tokens/tokens.css', tokensCss],
    ['docs/design/style-reference/index.html', styleRefHtml],
    ['docs/design/style-reference/reference.css', styleRefCss],
  ];
  const bpValues = new Set(Object.values(brandingBreakpoints).map((v) => v.replace('px', '')));
  // Both the classic `(min-width: 480px)` form and the range syntax
  // `(width >= 480px)` — the latter was a blind spot in review cycle 1 (B3):
  // rewriting a named breakpoint in range form dropped its comment
  // requirement entirely.
  const mediaRe = /@media[^{;]*\((?:min-width\s*:\s*|width\s*>=\s*)(\d+)px\)[^{;]*\{/g;
  let inspected = 0;
  for (const [label, text] of files) {
    let m;
    mediaRe.lastIndex = 0;
    while ((m = mediaRe.exec(text))) {
      // A px literal in a media condition that is NOT one of the four named
      // breakpoints is a magic value by plan §8.1.7's own definition — the
      // allowlist there covers "@media breakpoint literals that carry their
      // /* --breakpoint-* */ comment", and a one-off carries no token to name.
      // This used to `continue`, silently exempting exactly the case that
      // needed catching (review cycle 1, B3).
      assert.ok(
        bpValues.has(m[1]),
        `${label}: @media at ${m[1]}px is not one of the four BRANDING.md §6.4 breakpoints ` +
        `(${[...bpValues].join(', ')}) — a one-off viewport literal is a magic value`
      );
      const context = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 40);
      assert.match(context, /\/\*\s*--breakpoint-\w+\s*\*\//, `${label}: @media at ${m[1]}px missing a "/* --breakpoint-* */" naming comment nearby`);
      inspected += 1;
    }
  }
  // Floor: reference.css carries 10 breakpoint media queries today. Without
  // this, a regex that stopped matching would leave the test asserting nothing
  // and reporting green (review cycle 1, B3).
  assert.ok(inspected >= 8, `only ${inspected} breakpoint media queries were inspected across the three files — expected at least 8`);
});

// ============================================================================
// AS-29 additions allowlist
// ============================================================================

const ADDITIONS_ALLOWLIST = [
  { token: 'border-width-hairline', reason: 'F5: spacing scale starts at 4px; a 1px rule has no token.' },
  { token: 'focus-ring-width', reason: 'F5: WCAG 2.1 §2.4.7 requires a visible focus indicator; it needs a number.' },
  { token: 'focus-ring-offset', reason: "F5: separates ring from control so the fill doesn't swallow it." },
];

test('AS-29 additions — exactly the three allowlisted tokens, each present with a reason and a matching value, in tokens.css and tokens.json', () => {
  assert.equal(ADDITIONS_ALLOWLIST.length, 3);
  for (const { token, reason } of ADDITIONS_ALLOWLIST) {
    assert.ok(Object.prototype.hasOwnProperty.call(cssBlock1, token), `tokens.css missing addition --${token}`);
    assert.ok(tokensJson.additions?.[token], `tokens.json missing additions.${token}`);
    assert.equal(tokensJson.additions[token].reason, reason, `tokens.json additions.${token}.reason mismatch`);
    // The value was unchecked before review cycle 1: tokens.json could claim
    // a focus ring of 13px while tokens.css declared 2px and nothing objected.
    assert.equal(tokensJson.additions[token].value, cssBlock1[token], `tokens.json additions.${token}.value disagrees with tokens.css --${token}`);
  }
  assert.equal(Object.keys(tokensJson.additions).length, 3, 'tokens.json additions must contain exactly the 3 allowlisted tokens');
});

// ============================================================================
// Completeness (both directions): every token in the artifacts is either
// from BRANDING.md or on the additions allowlist; nothing in BRANDING.md's
// scope is missing from the artifacts (the per-section tests above already
// prove the "nothing missing" direction token by token — this proves the
// "nothing extra" direction across all of tokens.css's declarations).
// ============================================================================

test('completeness — every color- token in tokens.css block 1 is a known primitive', () => {
  let checked = 0;
  for (const key of Object.keys(cssBlock1)) {
    if (!key.startsWith('color-')) continue;
    const short = key.replace(/^color-/, '');
    assert.ok(brandingPrimitives[short] !== undefined, `tokens.css primitive --${key} is not in BRANDING.md §3.1`);
    checked += 1;
  }
  assert.equal(checked, 43, 'block 1 must declare all 43 §3.1 primitives — a block that parsed to no colours would otherwise report green');
});

test('completeness — every non-color token in tokens.css block 1 is either a known BRANDING.md scale value or an allowlisted addition', () => {
  const known = new Set([
    ...Object.keys(brandingFontSize).map((s) => `font-size-${s}`),
    ...Object.keys(brandingLineHeight).map((s) => `line-height-${s}`),
    ...Object.keys(brandingWeights).map((s) => `font-weight-${s}`),
    ...Object.keys(brandingLetterSpacing).map((s) => `letter-spacing-${s}`),
    ...Object.keys(brandingSpace).map((s) => `space-${s}`),
    ...Object.keys(brandingRadius).map((s) => `radius-${s}`),
    ...Object.keys(brandingShadow).map((s) => `shadow-${s}`),
    ...Object.keys(brandingBreakpoints).map((s) => `breakpoint-${s}`),
    ...Object.keys(brandingLayout),
    'font-family-sans', 'font-family-mono',
  ]);
  const allowlisted = new Set(ADDITIONS_ALLOWLIST.map((a) => a.token));
  let checked = 0;
  for (const key of Object.keys(cssBlock1)) {
    if (key.startsWith('color-')) continue; // covered by the primitives test above
    const ok = known.has(key) || allowlisted.has(key);
    assert.ok(ok, `tokens.css token --${key} is neither a known BRANDING.md scale value nor in the AS-29 additions allowlist`);
    checked += 1;
  }
  assert.equal(checked, 56, 'block 1 must declare all 56 non-colour tokens (53 BRANDING.md scale values + 3 allowlisted additions)');
});

test('completeness — tokens.css blocks 2, 3 and 4 declare exactly the documented semantic tokens, nothing extra', () => {
  // THE fix from review cycle 1 (V1), and the most important one. The "nothing
  // extra" scan used to look at block 1 only, so plan §4.4's allowlist — "the
  // mechanism that keeps 'additions' from becoming a back door for undocumented
  // brand values" — could be walked straight around by declaring the token one
  // block lower. `--color-smuggled-brand-value: #BADA55` in block 2 went green;
  // so did `--sneaky-radius: 13px`; so did a 4th geometry token present in both
  // dark blocks (the duplication invariant filtered on the `color-` prefix).
  //
  // deepEqual on the sorted key sets enforces BOTH directions at once: an
  // undocumented token is an addition to the set, a dropped token is a
  // subtraction, and either fails. Tokens on the ADDITIONS allowlist are
  // permitted in any block — that is what the allowlist is for, and adding a
  // fourth still requires a reviewed edit to the array above.
  const allowlisted = new Set(ADDITIONS_ALLOWLIST.map((a) => a.token));
  const expectedLight = Object.keys(brandingLight).map((s) => `color-${s}`).sort();
  const expectedDark = Object.keys(brandingDark).map((s) => `color-${s}`).sort();
  for (const [label, block, expected] of [
    ['block 2 (light semantics)', cssBlock2, expectedLight],
    ['block 3 (dark semantics, prefers-color-scheme)', cssBlock3, expectedDark],
    ['block 4 (explicit dark semantics)', cssBlock4, expectedDark],
  ]) {
    const declared = Object.keys(block).filter((k) => !allowlisted.has(k)).sort();
    assert.deepEqual(
      declared,
      expected,
      `tokens.css ${label}: declared custom properties do not match BRANDING.md's semantic token set exactly ` +
      `(extra: ${JSON.stringify(declared.filter((k) => !expected.includes(k)))}, ` +
      `missing: ${JSON.stringify(expected.filter((k) => !declared.includes(k)))})`
    );
  }
});

test('completeness — tokens.json has no top-level scale entries absent from tokens.css', () => {
  let checked = 0;
  for (const category of Object.keys(tokensJson.scale)) {
    for (const short of Object.keys(tokensJson.scale[category])) {
      let cssKey;
      if (category === 'layout') cssKey = short;
      else if (category === 'font-family') cssKey = `font-family-${short}`;
      else cssKey = `${category}-${short}`;
      assert.ok(Object.prototype.hasOwnProperty.call(cssBlock1, cssKey), `tokens.json scale.${category}.${short} has no matching --${cssKey} in tokens.css`);
      checked += 1;
    }
  }
  assert.equal(checked, 53, 'tokens.json must carry all 53 scale entries — an emptied scale object would otherwise report green');
});

// ============================================================================
// §8.1.7 Magic-value scan (index.html + reference.css)
// ============================================================================

test('magic-value scan — zero raw hex/rgb/hsl colors, no bare numeric literals outside the allowlist, font-family always via var()', () => {
  // Per-file floor on how many declarations the scan must actually parse.
  // Today: index.html 141, reference.css 386. Review cycle 1 (V3) truncated
  // reference.css to zero bytes and the suite stayed 28/28 green — a scan that
  // examines nothing must not be able to report success.
  const files = [
    ['docs/design/style-reference/index.html', styleRefHtml, 'html', 100],
    ['docs/design/style-reference/reference.css', styleRefCss, 'css', 300],
  ];
  const bpValues = new Set(Object.values(brandingBreakpoints).map((v) => v.replace('px', '')));
  // The wordmark's responsive tracking reduction is a literal named directly
  // in BRANDING.md §5.1 prose ("reduce tracking to 0.04em"), not a value
  // invented here — it has no token because it applies to exactly one
  // component in exactly one narrow-viewport state. 1.5 is the wordmark
  // demo SVG's height, sized relative to the surrounding text for visual
  // comparison with the HTML/CSS wordmark next to it (BRANDING.md §5.2: the
  // SVG is "a copy-paste reference fragment, not a portable image asset") —
  // not a UI component value, and there is no token for "illustrative sizing
  // of a secondary reference fragment". These are the only two em literals
  // allowed anywhere in these files.
  const EM_ALLOWLIST = new Set(['0.04', '1.5']);
  // The "343px worked example" section reproduces BRANDING.md §6.4's own
  // arithmetic (375 - 32 = 343) as a literal, labeled demo box simulating
  // the mobile viewport itself — content being illustrated, not a component
  // silently exceeding the mobile floor. Same reasoning as the mobile-first
  // scan's allowlist below; no other px value gets this pass.
  const PX_ALLOWLIST = new Set(['375']);
  // Units the scan understands. px/rem/em were the original three; the rest
  // were a blind spot found in review cycle 1 (B3) — `padding-top: 7vw` went
  // green. None occur in the shipped files; the scan just refuses to have a
  // shape of magic value it cannot see.
  const SCANNED_UNITS = 'px|rem|em|vw|vh|vmin|vmax|ch|ex|pt|pc|cm|mm|in|q';

  for (const [label, fullText, kind, minDeclarations] of files) {
    // Strip HTML comments and CSS comments so documentation examples (e.g. a
    // code sample showing what a token expands to) don't trip the scanner.
    const text = fullText.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // A .css file IS a CSS declaration context in its entirety. An .html
    // file's CSS lives only inside <style> blocks and style="" attributes —
    // extracting those is required, not optional: without it, cssLike is ''
    // for anything that isn't marked up as HTML, and the scan below would
    // silently check nothing and report success. (Caught in QA on this very
    // task: reference.css has no <style> tags, so the original version of
    // this test — which only ever looked inside <style>/style="" — produced
    // an empty cssLike for it and passed without checking a single line of
    // that file. Exactly the AS-17/AS-26 failure mode this suite exists to
    // prevent, found in its own harness.)
    //
    // The guard is HOISTED (review cycle 1, V3): it used to sit inside the
    // else branch only, so `if (kind === 'css') cssLike = text;` carried no
    // length assertion at all and a zero-byte reference.css passed while the
    // page rendered completely unstyled. That is the fourth instance of the
    // AS-17/AS-26 class in this codebase; the guard now covers every branch,
    // and a declaration floor below covers the case where the file is
    // non-empty but the scan still parses (nearly) nothing out of it.
    let cssLike;
    if (kind === 'css') {
      cssLike = text;
    } else {
      const styleBlocks = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
      const inlineStyles = [...text.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
      // Joined with ";\n" rather than "\n": an inline style attribute normally
      // has no trailing semicolon, and without a terminator the declaration
      // regex used to run one attribute's value into the next one's (or off
      // the end of the string), so it bounded values wrongly and, at the tail,
      // missed them entirely — 9 of index.html's 141 declarations were parsed.
      cssLike = styleBlocks.concat(inlineStyles).join(';\n') + ';\n';
    }
    assert.ok(
      cssLike.length > 0,
      `${label}: extracted zero bytes of CSS context — the scan below would silently check nothing`
    );

    // Raw hex colors.
    const hexMatches = cssLike.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
    assert.deepEqual(hexMatches, [], `${label}: raw hex color(s) found outside tokens.css: ${hexMatches.join(', ')}`);

    // Raw rgb()/hsl() (not inside a var() fallback, which we don't use anyway).
    const rgbMatches = cssLike.match(/\b(rgb|rgba|hsl|hsla)\s*\(/g) || [];
    assert.deepEqual(rgbMatches, [], `${label}: raw rgb()/hsl() color(s) found: ${rgbMatches.join(', ')}`);

    // Bare px/rem/em numeric literals in property values, outside the
    // allowlist: 0, breakpoint literals (checked separately above for their
    // required comment), and the one documented wordmark exception above.
    // A declaration ends at `;`, at the closing `}` of its rule, or at a
    // newline. The `}`/newline terminators are review cycle 1's B3 fix: the
    // old `([^;{}]+);` demanded a semicolon, so the last declaration in a rule
    // and every semicolon-less inline style attribute escaped the scan.
    const declRe = /([a-zA-Z-]+)\s*:\s*([^;{}\n]+)(?=[;}\n]|$)/g;
    let m;
    const offenders = [];
    let declarationsScanned = 0;
    while ((m = declRe.exec(cssLike))) {
      const prop = m[1].trim();
      const value = m[2].trim();
      if (prop === '--' || prop.startsWith('--')) continue; // custom property definitions aren't scanned (there shouldn't be any here anyway)
      if (/^@media/.test(prop)) continue;
      declarationsScanned += 1;
      const numRe = new RegExp(`(-?\\d*\\.?\\d+)(${SCANNED_UNITS})\\b`, 'gi');
      let nm;
      while ((nm = numRe.exec(value))) {
        const num = nm[1];
        const unit = nm[2].toLowerCase();
        if (num === '0') continue;
        if (unit === 'px' && bpValues.has(num)) continue; // breakpoint literal, allowed (checked for its comment elsewhere)
        if (unit === 'px' && PX_ALLOWLIST.has(num)) continue; // 343px worked example, named above
        if (unit === 'em' && EM_ALLOWLIST.has(num)) continue; // wordmark exceptions, named above
        offenders.push(`${prop}: ${value}`);
      }
    }
    assert.deepEqual(offenders, [], `${label}: bare numeric literal(s) outside the allowlist: ${JSON.stringify(offenders)}`);
    assert.ok(
      declarationsScanned >= minDeclarations,
      `${label}: only ${declarationsScanned} declarations were scanned, below the floor of ${minDeclarations} — ` +
      `the file or the extraction is broken and this scan is reporting success on almost nothing`
    );

    // font-family must always resolve through var(--font-family-*).
    const ffMatches = [...cssLike.matchAll(/font-family\s*:\s*([^;{}\n]+)(?=[;}\n]|$)/g)];
    for (const [, value] of ffMatches) {
      assert.match(value.trim(), /^var\(--font-family-(sans|mono)\)$/, `${label}: font-family not resolved through var(--font-family-*): "${value.trim()}"`);
    }

    // SVG presentation attributes live outside any CSS context, so the hex
    // scan above never saw them (review cycle 1, B3): <svg fill="#FF0000">
    // went green. The two shipped SVGs correctly use fill="currentColor".
    if (kind === 'html') {
      const svgColorAttrs = [...text.matchAll(/\b(fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*"([^"]*)"/g)];
      const svgOffenders = svgColorAttrs
        .filter(([, , v]) => /#[0-9A-Fa-f]{3,8}\b/.test(v) || /\b(rgb|rgba|hsl|hsla)\s*\(/.test(v))
        .map(([whole]) => whole);
      assert.deepEqual(svgOffenders, [], `${label}: raw color(s) in SVG presentation attribute(s): ${svgOffenders.join(', ')}`);
    }
  }
});

// ============================================================================
// §8.1.8 Mobile-first scan
// ============================================================================

test('mobile-first scan — no max-width media query; no fixed width in px exceeding 343 outside a media query', () => {
  const files = [
    ['docs/design/style-reference/index.html', styleRefHtml],
    ['docs/design/style-reference/reference.css', styleRefCss],
    ['docs/design/tokens/tokens.css', tokensCss],
  ];
  // "No max-width media query" is an absence assertion, and an empty file
  // satisfies every absence assertion trivially. The module-level byte floors
  // are the real guard; this is the local restatement of it so the test is
  // self-contained (review cycle 1, V3).
  for (const [label, rawText] of files) {
    assert.ok(rawText.length > 1000, `${label}: file is ${rawText.length} bytes — too small to be the real artifact; this scan would pass on nothing`);
  }
  for (const [label, rawText] of files) {
    // Strip comments first — a doc comment that merely mentions "max-width"
    // in prose (e.g. explaining this very rule) is not a media query.
    const text = rawText.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const maxWidthMediaMatches = text.match(/@media[^{]*max-width/g) || [];
    assert.deepEqual(maxWidthMediaMatches, [], `${label}: max-width media quer(y/ies) found — mobile-first is min-width only`);
  }

  // No fixed `width` declaration wider than 343px, unless it appears inside
  // an @media block (i.e. only kicks in at a wider viewport). Proxy check,
  // not a layout engine — deliberately conservative (plan §8.1.8).
  for (const [label, text] of [['index.html', styleRefHtml], ['reference.css', styleRefCss]]) {
    // crude but sufficient: strip everything inside @media {...} blocks (balanced-ish; our media blocks don't nest), then scan what's left.
    let depth = 0;
    let outsideMedia = '';
    let i = 0;
    while (i < text.length) {
      const mediaIdx = text.indexOf('@media', i);
      if (mediaIdx === -1) {
        outsideMedia += text.slice(i);
        break;
      }
      outsideMedia += text.slice(i, mediaIdx);
      const braceIdx = text.indexOf('{', mediaIdx);
      let d = 1;
      let j = braceIdx + 1;
      while (d > 0 && j < text.length) {
        if (text[j] === '{') d++;
        else if (text[j] === '}') d--;
        j++;
      }
      i = j;
    }
    // 375 is allowlisted for exactly one reason: the "343px worked example"
    // section reproduces BRANDING.md §6.4's own arithmetic (375 - 32 = 343)
    // as a literal, labeled demo box simulating the mobile viewport itself —
    // that's content being illustrated, not a component silently exceeding
    // the mobile floor. No other value gets this pass.
    const WORKED_EXAMPLE_ALLOWLIST = new Set([375]);
    assert.ok(
      outsideMedia.length > 500,
      `${label}: only ${outsideMedia.length} bytes survived @media stripping — the extraction is broken and this scan sees nothing`
    );
    const widthMatches = [...outsideMedia.matchAll(/\bwidth\s*:\s*(\d+)px/g)];
    for (const [, num] of widthMatches) {
      const n = Number(num);
      if (WORKED_EXAMPLE_ALLOWLIST.has(n)) continue;
      assert.ok(n <= 343, `${label}: fixed width ${num}px outside any @media block exceeds the 343px mobile floor (BRANDING.md §6.4 worked example)`);
    }
  }
});

// ============================================================================
// Style-reference ↔ generated-data join
//
// Review cycle 1 (B2): the page's hex labels and its rendered contrast matrix
// were hand-transcribed with no join to anything. A swatch label could be
// changed to #BADA55, a printed ratio to 99.99:1, a dark FAIL relabelled PASS,
// or a FAIL row deleted outright — all four passed. Acceptance criterion 10
// ("known-failing combinations are rendered and labelled with their ratio, not
// hidden") was therefore met by the implementer's honesty rather than by
// anything enforcing it. These tests make the page a checked mirror of the
// generated data.
//
// This couples the tests to the page's markup, deliberately. The parsers fail
// loudly by name if the shapes they expect disappear, so a markup refactor
// breaks the build with an explanation instead of silently switching the
// enforcement off — which is the failure mode this whole suite exists for.
// ============================================================================

/** Mode of the nearest enclosing data-theme panel at a given index, or null. */
function themeAt(html, index) {
  const before = html.slice(0, index);
  const lastLight = before.lastIndexOf('data-theme="light"');
  const lastDark = before.lastIndexOf('data-theme="dark"');
  if (lastLight === -1 && lastDark === -1) return null;
  return lastLight > lastDark ? 'light' : 'dark';
}

const SWATCH_RE =
  /<code class="swatch__name">--color-([a-z0-9-]+)<\/code><span class="swatch__hex">(#[0-9A-Fa-f]{6})<\/span>(?:<span class="swatch__alias">alias of ([a-z0-9-]+)<\/span>)?/g;

test('style reference — every printed swatch hex matches the generated token data (43 primitive + 56 semantic)', () => {
  const swatches = [...styleRefHtml.matchAll(SWATCH_RE)];
  if (swatches.length === 0) {
    throw new Error(
      'FORMAT CONTRACT BROKEN in docs/design/style-reference/index.html: no swatch markup matched ' +
      '(expected <code class="swatch__name">--color-X</code><span class="swatch__hex">#HEX</span>). ' +
      'This is a hard failure, not a skip — without it the page\'s hex labels are unchecked.'
    );
  }
  let primitiveCount = 0;
  const semanticSeen = { light: new Set(), dark: new Set() };
  for (const m of swatches) {
    const [, short, hex, alias] = m;
    if (alias === undefined) {
      // Primitive swatch: no alias label, name is a §3.1 primitive.
      assert.ok(brandingPrimitives[short] !== undefined, `index.html swatch --color-${short} is not a BRANDING.md §3.1 primitive`);
      assert.equal(hex.toUpperCase(), brandingPrimitives[short], `index.html primitive swatch --color-${short} prints ${hex}`);
      primitiveCount += 1;
      continue;
    }
    // Semantic swatch: mode comes from the enclosing data-theme panel, which
    // is also what actually colours it in the browser.
    const mode = themeAt(styleRefHtml, m.index);
    assert.ok(mode, `index.html semantic swatch --color-${short} sits outside any data-theme panel — its mode is undeterminable`);
    const documented = (mode === 'light' ? brandingLight : brandingDark)[short];
    assert.ok(documented, `index.html ${mode} swatch --color-${short} is not a BRANDING.md §3.${mode === 'light' ? 2 : 3} semantic token`);
    assert.equal(hex.toUpperCase(), documented.value, `index.html ${mode} swatch --color-${short} prints ${hex}`);
    assert.equal(alias, documented.aliasRaw, `index.html ${mode} swatch --color-${short} prints "alias of ${alias}"`);
    semanticSeen[mode].add(short);
  }
  assert.equal(primitiveCount, 43, 'index.html must render all 43 §3.1 primitives as labelled swatches');
  assert.equal(semanticSeen.light.size, 28, 'index.html must render all 28 light semantic tokens as labelled swatches');
  assert.equal(semanticSeen.dark.size, 28, 'index.html must render all 28 dark semantic tokens as labelled swatches');
});

const CONTRAST_TABLE_RE =
  /<h4 class="contrast-table__title">(light|dark) · on <code>--color-([a-z0-9-]+)<\/code><\/h4>\s*<table class="contrast-table">([\s\S]*?)<\/table>/g;
const CONTRAST_ROW_RE =
  /<tr[^>]*><td><code>--color-([a-z0-9-]+)<\/code><\/td><td>([\d.]+):1<\/td><td>([^<]*)<\/td><td><span class="result-badge[^"]*">([A-Z]+)<\/span><\/td><\/tr>/g;

test('style reference — the rendered contrast matrix is the generated matrix, row for row (114 rows, no relabelling, no omissions)', () => {
  const tables = [...styleRefHtml.matchAll(CONTRAST_TABLE_RE)];
  if (tables.length === 0) {
    throw new Error(
      'FORMAT CONTRACT BROKEN in docs/design/style-reference/index.html: no contrast tables matched ' +
      '(expected <h4 class="contrast-table__title">MODE · on <code>--color-BG</code></h4> followed by ' +
      '<table class="contrast-table">). This is a hard failure, not a skip.'
    );
  }
  assert.equal(tables.length, 6, 'expected 6 rendered contrast tables (2 modes x 3 backgrounds)');

  const generatedByKey = new Map(generatedMatrix.map((r) => [`${r.mode}|${r.foreground}|${r.background}`, r]));
  const renderedKeys = new Set();
  let rowCount = 0;

  for (const [, mode, bg, body] of tables) {
    const rows = [...body.matchAll(CONTRAST_ROW_RE)];
    if (rows.length === 0) {
      throw new Error(
        `FORMAT CONTRACT BROKEN in docs/design/style-reference/index.html: the "${mode} · on --color-${bg}" ` +
        'contrast table parsed to zero rows. This is a hard failure, not a skip.'
      );
    }
    for (const [, fg, ratioText, floorText, resultText] of rows) {
      const key = `${mode}|color-${fg}|color-${bg}`;
      const generated = generatedByKey.get(key);
      assert.ok(generated, `index.html renders a contrast row for ${key} that the generated matrix does not contain`);
      assert.equal(Number(ratioText), generated.ratio, `index.html ${key}: prints ${ratioText}:1, generated matrix says ${generated.ratio}:1`);
      const printedFloor = floorText.trim() === '—' ? null : Number(floorText.replace(':1', ''));
      assert.equal(printedFloor, generated.threshold, `index.html ${key}: prints floor "${floorText.trim()}", generated matrix says ${generated.threshold}`);
      assert.equal(resultText, generated.result, `index.html ${key}: badged ${resultText}, generated matrix says ${generated.result}`);
      assert.ok(!renderedKeys.has(key), `index.html renders ${key} more than once`);
      renderedKeys.add(key);
      rowCount += 1;
    }
  }

  assert.equal(rowCount, 114, 'the page must render all 114 generated matrix rows');
  // Both directions: nothing rendered that was not generated (above), and
  // nothing generated that was not rendered — which is what catches a FAIL row
  // quietly deleted from the page.
  const missing = generatedMatrix
    .map((r) => `${r.mode}|${r.foreground}|${r.background}`)
    .filter((k) => !renderedKeys.has(k));
  assert.deepEqual(missing, [], `generated matrix rows absent from the page: ${JSON.stringify(missing)}`);
  // And the honesty claim itself (criterion 10): every generated FAIL is on the page, badged FAIL.
  const generatedFails = generatedMatrix.filter((r) => r.result === 'FAIL');
  assert.equal(generatedFails.length, 12, 'expected 12 generated FAILs (all dark mode) — see plan F2');
  for (const r of generatedFails) {
    assert.ok(renderedKeys.has(`${r.mode}|${r.foreground}|${r.background}`), `generated FAIL ${r.mode} ${r.foreground} on ${r.background} is not rendered on the page`);
  }
});

// ============================================================================
// §8.1.9 Format-contract guard — the guard mechanism itself, exercised
// in-memory (never mutates the real BRANDING.md).
// ============================================================================

test('format-contract guard — sliceBetween throws a distinct, named error when a marker is missing', () => {
  assert.throws(
    () => sliceBetween('# Some doc\nno relevant heading here', '### 3.1 Primitives', '### 3.2', 'fixture'),
    /FORMAT CONTRACT BROKEN in fixture.*### 3\.1 Primitives/s
  );
});

test('format-contract guard — extractTables throws when a section has no pipe tables at all', () => {
  assert.throws(
    () => extractTables('Just prose, no tables here.', 'fixture'),
    /FORMAT CONTRACT BROKEN in fixture/
  );
});

test('format-contract guard — parseResultCell throws on a decorated or reworded Result cell', () => {
  // The exact drift demonstrated in review cycle 1: each of the rejected
  // cells below used to parse to a junk first token, match no branch
  // downstream, and silently disable that row's threshold assertion.
  assert.equal(parseResultCell('PASS', 'x on y', 'fixture'), 'PASS');
  assert.equal(parseResultCell('EXEMPT — disabled content is out of scope', 'x on y', 'fixture'), 'EXEMPT');
  for (const bad of ['OK PASS', '✅ PASS', 'PASSES', 'pass', 'PASS (probably)', '']) {
    assert.throws(
      () => parseResultCell(bad, 'x on y', 'fixture'),
      /FORMAT CONTRACT BROKEN in fixture.*Result cell/s,
      `parseResultCell should reject ${JSON.stringify(bad)}`
    );
  }
});

test('format-contract guard — requireTable throws a distinct error when no table matches the predicate', () => {
  const tables = extractTables('| A | B |\n| 1 | 2 |\n', 'fixture');
  assert.throws(
    () => requireTable(tables, (t) => t[0][0] === 'NoSuchHeader', 'a table that does not exist', 'fixture'),
    /FORMAT CONTRACT BROKEN in fixture.*a table that does not exist/s
  );
});
