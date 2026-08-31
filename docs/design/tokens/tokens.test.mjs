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
  for (const [short, { value }] of Object.entries(brandingLight)) {
    const cssKey = `color-${short}`;
    assert.ok(Object.prototype.hasOwnProperty.call(cssBlock2, cssKey), `tokens.css block 2 missing --${cssKey}`);
    const cssResolved = resolveCssValue(cssBlock2[cssKey], cssBlock2, cssPrimitives);
    assert.equal(cssResolved, value, `tokens.css light --${cssKey} resolves to ${cssResolved}, BRANDING.md says ${value}`);

    assert.ok(tokensJson.semantic?.light?.[cssKey], `tokens.json semantic.light missing "${cssKey}"`);
    assert.equal(tokensJson.semantic.light[cssKey].value.toUpperCase(), value, `tokens.json semantic.light.${cssKey}.value mismatch`);
  }
});

test('§3.3 dark semantic tokens — value equality across BRANDING.md, tokens.css (both blocks), tokens.json', () => {
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
  }
});

test('dark-block duplication invariant — tokens.css block 3 and block 4 declare the same 28 tokens with identical resolved values', () => {
  const keys3 = Object.keys(cssBlock3).filter((k) => k.startsWith('color-')).sort();
  const keys4 = Object.keys(cssBlock4).filter((k) => k.startsWith('color-')).sort();
  assert.deepEqual(keys3, keys4, 'block 3 and block 4 declare a different set of color- tokens');
  assert.equal(keys3.length, 28, 'block 3/4 color token count');
  for (const key of keys3) {
    const r3 = resolveCssValue(cssBlock3[key], cssBlock3, cssPrimitives);
    const r4 = resolveCssValue(cssBlock4[key], cssBlock4, cssPrimitives);
    assert.equal(r3, r4, `--${key} differs between block 3 (${r3}) and block 4 (${r4})`);
  }
});

test('alias integrity — every semantic token resolves to the hex its "Alias of" column names (light + dark)', () => {
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
    }
  }
});

// ============================================================================
// §3.4 Contrast ratios — parity + generated matrix
// ============================================================================

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
    const result = resultCell.split(/\s|—/)[0]; // first word: PASS / EXEMPT / DECORATIVE
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
  for (const [mode, rows] of [['light', brandingContrastLight], ['dark', brandingContrastDark]]) {
    for (const { fg, bg, ratio, threshold, result } of rows) {
      const computed = round2(contrastRatio(hexForShortName(mode, fg), hexForShortName(mode, bg)));
      assert.equal(computed, ratio, `${mode} ${fg} on ${bg}: recomputed ${computed}, BRANDING.md documents ${ratio}`);
      if (result === 'PASS') {
        assert.ok(threshold !== null, `${mode} ${fg} on ${bg}: result PASS but no numeric threshold parsed`);
        assert.ok(computed >= threshold, `${mode} ${fg} on ${bg}: documented PASS at ${computed}:1 does not clear its own ${threshold}:1 floor`);
      }
    }
  }
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
  for (const [mode, rows] of [['light', brandingContrastLight], ['dark', brandingContrastDark]]) {
    for (const { fg, bg, result } of rows) {
      if (result !== 'PASS') continue;
      const key = `${mode}|color-${fg}|color-${bg}`;
      const matched = byKey.get(key);
      if (!matched) continue; // pairs outside the 3-background cross-product (e.g. *-on-subtle on *-bg-subtle) aren't in this matrix — already covered by the parity test above
      assert.equal(matched.result, 'PASS', `${key}: BRANDING.md §3.4 documents PASS, generated matrix says ${matched.result} (${matched.ratio}:1)`);
    }
  }
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
    ['docs/design/style-reference/index.html', readFileSync(STYLE_REF_HTML_PATH, 'utf8')],
    ['docs/design/style-reference/reference.css', readFileSync(STYLE_REF_CSS_PATH, 'utf8')],
  ];
  const bpValues = new Set(Object.values(brandingBreakpoints).map((v) => v.replace('px', '')));
  for (const [label, text] of files) {
    const mediaRe = /@media[^{]*\(min-width:\s*(\d+)px\)[^{]*\{/g;
    let m;
    while ((m = mediaRe.exec(text))) {
      if (!bpValues.has(m[1])) continue; // not one of our named breakpoints (e.g. a one-off), not required to carry a comment
      const context = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 40);
      assert.match(context, /\/\*\s*--breakpoint-\w+\s*\*\//, `${label}: @media (min-width: ${m[1]}px) missing a "/* --breakpoint-* */" naming comment nearby`);
    }
  }
});

// ============================================================================
// AS-29 additions allowlist
// ============================================================================

const ADDITIONS_ALLOWLIST = [
  { token: 'border-width-hairline', reason: 'F5: spacing scale starts at 4px; a 1px rule has no token.' },
  { token: 'focus-ring-width', reason: 'F5: WCAG 2.1 §2.4.7 requires a visible focus indicator; it needs a number.' },
  { token: 'focus-ring-offset', reason: "F5: separates ring from control so the fill doesn't swallow it." },
];

test('AS-29 additions — exactly the three allowlisted tokens, each present with a reason, in tokens.css and tokens.json', () => {
  assert.equal(ADDITIONS_ALLOWLIST.length, 3);
  for (const { token, reason } of ADDITIONS_ALLOWLIST) {
    assert.ok(Object.prototype.hasOwnProperty.call(cssBlock1, token), `tokens.css missing addition --${token}`);
    assert.ok(tokensJson.additions?.[token], `tokens.json missing additions.${token}`);
    assert.equal(tokensJson.additions[token].reason, reason, `tokens.json additions.${token}.reason mismatch`);
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
  for (const key of Object.keys(cssBlock1)) {
    if (!key.startsWith('color-')) continue;
    const short = key.replace(/^color-/, '');
    assert.ok(brandingPrimitives[short] !== undefined, `tokens.css primitive --${key} is not in BRANDING.md §3.1`);
  }
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
  for (const key of Object.keys(cssBlock1)) {
    if (key.startsWith('color-')) continue; // covered by the primitives test above
    const ok = known.has(key) || allowlisted.has(key);
    assert.ok(ok, `tokens.css token --${key} is neither a known BRANDING.md scale value nor in the AS-29 additions allowlist`);
  }
});

test('completeness — tokens.json has no top-level scale entries absent from tokens.css', () => {
  for (const category of Object.keys(tokensJson.scale)) {
    for (const short of Object.keys(tokensJson.scale[category])) {
      let cssKey;
      if (category === 'layout') cssKey = short;
      else if (category === 'font-family') cssKey = `font-family-${short}`;
      else cssKey = `${category}-${short}`;
      assert.ok(Object.prototype.hasOwnProperty.call(cssBlock1, cssKey), `tokens.json scale.${category}.${short} has no matching --${cssKey} in tokens.css`);
    }
  }
});

// ============================================================================
// §8.1.7 Magic-value scan (index.html + reference.css)
// ============================================================================

test('magic-value scan — zero raw hex/rgb/hsl colors, no bare px/rem/em literals outside the allowlist, font-family always via var()', () => {
  const files = [
    ['docs/design/style-reference/index.html', readFileSync(STYLE_REF_HTML_PATH, 'utf8'), 'html'],
    ['docs/design/style-reference/reference.css', readFileSync(STYLE_REF_CSS_PATH, 'utf8'), 'css'],
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

  for (const [label, fullText, kind] of files) {
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
    let cssLike;
    if (kind === 'css') {
      cssLike = text;
    } else {
      const styleBlocks = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
      const inlineStyles = [...text.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
      cssLike = styleBlocks.concat(inlineStyles).join('\n');
      assert.ok(cssLike.length > 0, `${label}: extracted zero bytes of CSS context (no <style> blocks or style="" attributes found) — the scan below would silently check nothing`);
    }

    // Raw hex colors.
    const hexMatches = cssLike.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
    assert.deepEqual(hexMatches, [], `${label}: raw hex color(s) found outside tokens.css: ${hexMatches.join(', ')}`);

    // Raw rgb()/hsl() (not inside a var() fallback, which we don't use anyway).
    const rgbMatches = cssLike.match(/\b(rgb|rgba|hsl|hsla)\s*\(/g) || [];
    assert.deepEqual(rgbMatches, [], `${label}: raw rgb()/hsl() color(s) found: ${rgbMatches.join(', ')}`);

    // Bare px/rem/em numeric literals in property values, outside the
    // allowlist: 0, breakpoint literals (checked separately above for their
    // required comment), and the one documented wordmark exception above.
    const declRe = /([a-zA-Z-]+)\s*:\s*([^;{}]+);/g;
    let m;
    const offenders = [];
    while ((m = declRe.exec(cssLike))) {
      const prop = m[1].trim();
      const value = m[2].trim();
      if (prop === '--' || prop.startsWith('--')) continue; // custom property definitions aren't scanned (there shouldn't be any here anyway)
      if (/^@media/.test(prop)) continue;
      const numRe = /(-?\d*\.?\d+)(px|rem|em)/g;
      let nm;
      while ((nm = numRe.exec(value))) {
        const num = nm[1];
        const unit = nm[2];
        if (num === '0') continue;
        if (unit === 'px' && bpValues.has(num)) continue; // breakpoint literal, allowed (checked for its comment elsewhere)
        if (unit === 'px' && PX_ALLOWLIST.has(num)) continue; // 343px worked example, named above
        if (unit === 'em' && EM_ALLOWLIST.has(num)) continue; // wordmark exceptions, named above
        offenders.push(`${prop}: ${value}`);
      }
    }
    assert.deepEqual(offenders, [], `${label}: bare px/rem/em literal(s) outside the allowlist: ${JSON.stringify(offenders)}`);

    // font-family must always resolve through var(--font-family-*).
    const ffMatches = [...cssLike.matchAll(/font-family\s*:\s*([^;]+);/g)];
    for (const [, value] of ffMatches) {
      assert.match(value.trim(), /^var\(--font-family-(sans|mono)\)$/, `${label}: font-family not resolved through var(--font-family-*): "${value.trim()}"`);
    }
  }
});

// ============================================================================
// §8.1.8 Mobile-first scan
// ============================================================================

test('mobile-first scan — no max-width media query; no fixed width in px exceeding 343 outside a media query', () => {
  const files = [
    ['docs/design/style-reference/index.html', readFileSync(STYLE_REF_HTML_PATH, 'utf8')],
    ['docs/design/style-reference/reference.css', readFileSync(STYLE_REF_CSS_PATH, 'utf8')],
    ['docs/design/tokens/tokens.css', tokensCss],
  ];
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
  const html = readFileSync(STYLE_REF_HTML_PATH, 'utf8');
  const css = readFileSync(STYLE_REF_CSS_PATH, 'utf8');
  for (const [label, text] of [['index.html', html], ['reference.css', css]]) {
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
    const widthMatches = [...outsideMedia.matchAll(/\bwidth\s*:\s*(\d+)px/g)];
    for (const [, num] of widthMatches) {
      const n = Number(num);
      if (WORKED_EXAMPLE_ALLOWLIST.has(n)) continue;
      assert.ok(n <= 343, `${label}: fixed width ${num}px outside any @media block exceeds the 343px mobile floor (BRANDING.md §6.4 worked example)`);
    }
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

test('format-contract guard — requireTable throws a distinct error when no table matches the predicate', () => {
  const tables = extractTables('| A | B |\n| 1 | 2 |\n', 'fixture');
  assert.throws(
    () => requireTable(tables, (t) => t[0][0] === 'NoSuchHeader', 'a table that does not exist', 'fixture'),
    /FORMAT CONTRACT BROKEN in fixture.*a table that does not exist/s
  );
});
