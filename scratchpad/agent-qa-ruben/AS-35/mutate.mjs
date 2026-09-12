// AS-35 mutant battery (qa-ruben). Usage: node mutate.mjs [mutant-name ...]   (no args = all)
//
// Method: a pristine scratch tree is copied from the AS-35 worktree into this
// scratchpad (BRANDING.md, docs/design/tokens/*, docs/design/style-reference/*)
// — tokens.test.mjs resolves every input relative to its own location, so a
// scratch tree three levels deep is a faithful stand-in and the worktree is
// never written. Each mutant: copy pristine → tree/<name>, assert the target
// string's occurrence count in the pristine file, apply, assert the file
// changed, print the applied diff, run the suite, record the exact failing set,
// compare to the prediction, and prove the worktree clean.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-35';
const SP = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-35';
const TREES = join(SP, 'mutants');
const PRISTINE = join(TREES, 'pristine');

const FILES = ['BRANDING.md', 'docs/design/tokens/tokens.css', 'docs/design/tokens/tokens.json', 'docs/design/tokens/tokens.test.mjs',
  'docs/design/style-reference/index.html', 'docs/design/style-reference/reference.css'];

const T = {
  A: 'tokens.css cascade structure — exactly four top-level rules, one per BLOCK marker, in order, each carrying that block\'s declarations',
  B: 'tokens.css block selectors — blocks 1, 2 and 4 are literally `:root`, `:root, [data-theme="light"]` and `[data-theme="dark"]`, in that order',
  C: 'tokens.css block 3 — `@media (prefers-color-scheme: dark)` wraps exactly one rule, `:root:not([data-theme="light"])`, and nothing else',
  D: 'format-contract guard — parseTopLevelRules throws on unbalanced braces and on a stylesheet with zero rules (AS-35)',
};
const short = (name) => Object.entries(T).find(([, v]) => v === name)?.[0] ? `T-${Object.entries(T).find(([, v]) => v === name)[0]}` : name;

const CSS = 'docs/design/tokens/tokens.css';
const TEST = 'docs/design/tokens/tokens.test.mjs';

// Rule texts as they appear in tokens.css on the tip (used by the swap mutant).
const BLOCK3_RULE_START = '@media (prefers-color-scheme: dark) {';
const BLOCK4_RULE_START = '[data-theme="dark"] {';

function sliceRule(css, startMarker) {
  const s = css.indexOf(startMarker);
  if (s === -1) throw new Error(`rule start not found: ${startMarker}`);
  // walk braces from the first '{' after s
  let depth = 0; let i = css.indexOf('{', s);
  for (; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return { start: s, end: i + 1, text: css.slice(s, i + 1) };
}

// Each mutant: { file, target, count (expected occurrences in pristine), replacement | fn, predicted: [...test short names] | 'LOAD' }
const MUTANTS = {
  // ---- plan criteria 2–8 ----
  'c2-block4-drak':     { file: CSS, target: '[data-theme="dark"] {', count: 1, replacement: '[data-theme="drak"] {', predicted: ['T-B'], criterion: 2 },
  'c3-block2-root-only':{ file: CSS, target: ':root,\n[data-theme="light"] {', count: 1, replacement: ':root {', predicted: ['T-B'], criterion: 3 },
  'c4-media-light':     { file: CSS, target: 'prefers-color-scheme: dark', count: 1, replacement: 'prefers-color-scheme: light', predicted: ['T-C'], criterion: 4 },
  'c5-block3-bare-root':{ file: CSS, target: ':root:not([data-theme="light"]) {', count: 1, replacement: ':root {', predicted: ['T-C'], criterion: 5 },
  'c6-swap-rules-3-4':  { file: CSS, fn: (css) => {
      const r3 = sliceRule(css, BLOCK3_RULE_START); const r4 = sliceRule(css, BLOCK4_RULE_START);
      if (!(r3.end < r4.start)) throw new Error('rule 3 must precede rule 4');
      return css.slice(0, r3.start) + r4.text + css.slice(r3.end, r4.start) + r3.text + css.slice(r4.end);
    }, predicted: ['T-A', 'T-B', 'T-C'], criterion: 6 },
  'c7-fifth-rule-appended': { file: CSS, fn: (css) => css.replace(/\}\s*$/, '}\n\nhtml { }\n'), predicted: ['T-A'], criterion: 7 },
  'c8-parser-no-throw-zero-rules': { file: TEST, target: "  if (rules.length === 0) {\n    throw new Error(`FORMAT CONTRACT BROKEN in ${sourceLabel}: no rules found at all", count: 1,
      fn: (src) => src.replace(/  if \(rules\.length === 0\) \{\n    throw new Error\(`FORMAT CONTRACT BROKEN in \$\{sourceLabel\}: no rules found at all[^\n]*\n  \}\n/, ''),
      predicted: ['T-D'], criterion: 8 },
  // ---- M6 probes past the list ----
  'p1-fifth-rule-between-2-and-3': { file: CSS, target: '/*\n * ============================================================================\n * BLOCK 3', count: 1,
      replacement: 'html { }\n\n/*\n * ============================================================================\n * BLOCK 3', predicted: ['T-A', 'T-B', 'T-C'] },
  'p2a-block2-one-line':   { file: CSS, target: ':root,\n[data-theme="light"] {', count: 1, replacement: ':root, [data-theme="light"] {', predicted: [] },
  'p2b-block2-odd-spacing':{ file: CSS, target: ':root,\n[data-theme="light"] {', count: 1, replacement: ':root ,\n\n\t[data-theme="light"]   {', predicted: [] },
  'p2c-block4-unquoted':   { file: CSS, target: '[data-theme="dark"] {', count: 1, replacement: '[data-theme=dark] {', predicted: ['T-B'] },
  'p2d-block4-space-around-eq': { file: CSS, target: '[data-theme="dark"] {', count: 1, replacement: '[data-theme = "dark"] {', predicted: ['T-B'] },
  'p3-comment-inside-selector': { file: CSS, target: ':root,\n[data-theme="light"] {', count: 1, replacement: ':root, /* light scope */ [data-theme="light"] {', predicted: [] },
  'p3b-comment-with-brace':     { file: CSS, target: ':root,\n[data-theme="light"] {', count: 1, replacement: ':root, /* { } */ [data-theme="light"] {', predicted: [] },
  'p4-media-two-rules':    { file: CSS, target: '    --color-danger-solid-hover: var(--color-danger-600);\n  }\n}', count: 1,
      replacement: '    --color-danger-solid-hover: var(--color-danger-600);\n  }\n  html { }\n}', predicted: ['T-C'] },
  'p4b-media-two-rules-bare-root-with-decl': { file: CSS, target: '    --color-danger-solid-hover: var(--color-danger-600);\n  }\n}', count: 1,
      replacement: '    --color-danger-solid-hover: var(--color-danger-600);\n  }\n  :root { --color-bg-canvas: var(--color-ink-950); }\n}', predicted: ['T-C'] },
  'p5-layer-wraps-block4': { file: CSS, fn: (css) => { const r4 = sliceRule(css, BLOCK4_RULE_START); return css.slice(0, r4.start) + '@layer theme {\n' + r4.text + '\n}' + css.slice(r4.end); }, predicted: ['T-B'] },
  'p5b-supports-wraps-block1': { file: CSS, target: ':root {\n  color-scheme: light dark;', count: 1, fn: (css) => { const r1 = sliceRule(css, ':root {\n  color-scheme: light dark;'); return css.slice(0, r1.start) + '@supports (color: red) {\n' + r1.text + '\n}' + css.slice(r1.end); }, predicted: ['T-B'] },
  'p6a-brace-in-string-close': { file: CSS, target: '  --focus-ring-offset: 2px;', count: 1, replacement: '  --focus-ring-offset: 2px;\n  --x-probe: "}";', predicted: 'LOAD' },
  'p6b-brace-in-string-open':  { file: CSS, target: '  --focus-ring-offset: 2px;', count: 1, replacement: '  --focus-ring-offset: 2px;\n  --x-probe: "{";', predicted: 'LOAD' },
  'p6c-brace-in-url-balanced': { file: CSS, target: '  --focus-ring-offset: 2px;', count: 1, replacement: '  --focus-ring-offset: 2px;\n  --x-probe: url("data:x,{}");', predicted: 'OTHER' },
  'p7-empty-block4':       { file: CSS, fn: (css) => { const r4 = sliceRule(css, BLOCK4_RULE_START); return css.slice(0, r4.start) + '[data-theme="dark"] {\n}' + css.slice(r4.end); }, predicted: 'LOAD' },
  'p7b-block4-rule-deleted-bare-decl-left': { file: CSS, fn: (css) => { const r4 = sliceRule(css, BLOCK4_RULE_START); return css.slice(0, r4.start) + '--color-bg-canvas: var(--color-ink-950);\n' + css.slice(r4.end); }, predicted: 'OTHER' },
  'p8a-import-before-block1': { file: CSS, target: ':root {\n  color-scheme: light dark;', count: 1, replacement: '@import url("x.css");\n:root {\n  color-scheme: light dark;', predicted: ['T-B'] },
  'p8b-empty-prelude-block4': { file: CSS, target: '[data-theme="dark"] {', count: 1, replacement: '{', predicted: ['T-B'] },
  'p8c-media-extra-condition': { file: CSS, target: '@media (prefers-color-scheme: dark) {', count: 1, replacement: '@media (prefers-color-scheme: dark) and (min-width: 0px) {', predicted: ['T-C'] },
  'p8d-block4-marker-moved-after-rule': { file: CSS, fn: (css) => {
      const m = css.indexOf('/*\n * ============================================================================\n * BLOCK 4');
      const r4 = sliceRule(css, BLOCK4_RULE_START);
      const marker = css.slice(m, r4.start);
      return css.slice(0, m) + r4.text + '\n\n' + marker.trimEnd() + '\n' + css.slice(r4.end);
    }, predicted: 'OTHER' },
  'p10-block4-marker-inside-media-body': { file: CSS, fn: (css) => {
      // Move the BLOCK 4 comment header into block 3's @media body, after the inner rule's closing brace.
      const m = css.indexOf('/*\n * ============================================================================\n * BLOCK 4');
      const mEnd = css.indexOf('*/\n', m) + 3;
      const marker = css.slice(m, mEnd);
      const without = css.slice(0, m) + css.slice(mEnd);
      const anchor = '    --color-danger-solid-hover: var(--color-danger-600);\n  }\n}';
      if (without.split(anchor).length - 1 !== 1) throw new Error('anchor count != 1');
      return without.replace(anchor, '    --color-danger-solid-hover: var(--color-danger-600);\n  }\n  ' + marker.replace(/\n/g, '\n  ').trimEnd() + '\n}');
    }, predicted: 'OTHER' },
  'p9-block4-selector-duplicated-rule': { file: CSS, fn: (css) => { const r4 = sliceRule(css, BLOCK4_RULE_START); return css.slice(0, r4.end) + '\n\n[data-theme="dark"] {\n  --color-bg-canvas: var(--color-ink-50);\n}\n' + css.slice(r4.end); }, predicted: ['T-A'] },
};

function ensurePristine() {
  if (existsSync(PRISTINE)) rmSync(PRISTINE, { recursive: true });
  for (const f of FILES) { mkdirSync(join(PRISTINE, f, '..'), { recursive: true }); cpSync(join(WT, f), join(PRISTINE, f)); }
}

function runSuite(tree) {
  const r = spawnSync(process.execPath, ['--test', join(tree, TEST)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const counts = out.split('\n').filter((l) => /^ℹ (tests|pass|fail) /.test(l)).map((l) => l.replace(/^ℹ /, '')).join('  ');
  // Spec reporter prints each failure inline and again under a trailing "✖ failing tests:" header — dedupe.
  const failing = [...new Set(out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '')).filter((l) => l !== 'failing tests:'))];
  const failCount = Number((out.match(/^ℹ fail (\d+)/m) || [])[1] ?? -1);
  if (failCount !== -1 && failCount !== failing.length) throw new Error(`parser disagreement: reporter says fail ${failCount}, parsed ${failing.length} names`);
  const loadError = /^ℹ tests 0\b/m.test(out) || !/^ℹ tests /m.test(out);
  const firstErr = out.split('\n').find((l) => /FORMAT CONTRACT BROKEN|AssertionError|Error:/.test(l)) || '';
  return { out, counts, failing, loadError, firstErr: firstErr.trim().slice(0, 240), exit: r.status };
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTANTS);
ensurePristine();
const table = [];
for (const name of names) {
  const m = MUTANTS[name];
  if (!m) { console.log(`unknown mutant ${name}`); continue; }
  const tree = join(TREES, name);
  if (existsSync(tree)) rmSync(tree, { recursive: true });
  cpSync(PRISTINE, tree, { recursive: true });
  const path = join(tree, m.file);
  const before = readFileSync(path, 'utf8');
  if (m.target !== undefined) {
    const n = before.split(m.target).length - 1;
    if (n !== m.count) throw new Error(`${name}: target occurs ${n} times in pristine ${m.file}, expected ${m.count} — NOT applied`);
  }
  const after = m.fn ? m.fn(before) : before.split(m.target).join(m.replacement);
  if (after === before) throw new Error(`${name}: mutation produced no change — NOT applied`);
  writeFileSync(path, after);
  const d = spawnSync('diff', ['-u', join(PRISTINE, m.file), path], { encoding: 'utf8' });
  writeFileSync(join(SP, `mut-${name}.diff`), d.stdout);
  const res = runSuite(tree);
  writeFileSync(join(SP, `mut-${name}.log`), res.out);
  const observed = res.loadError ? 'LOAD' : res.failing.map(short).sort();
  const predicted = Array.isArray(m.predicted) ? [...m.predicted].sort() : m.predicted;
  const match = predicted === 'OTHER' ? 'n/a (probe)' : JSON.stringify(observed) === JSON.stringify(predicted) ? 'MATCH' : 'MISMATCH';
  const row = { name, criterion: m.criterion ?? 'probe', file: m.file, diffLines: d.stdout.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length, counts: res.counts || '(no summary — load error)', predicted, observed, match, firstErr: res.firstErr };
  table.push(row);
  console.log(`\n### ${name}  [criterion ${row.criterion}]  ${m.file}`);
  console.log(`applied diff (${row.diffLines} changed lines):\n${d.stdout.split('\n').filter((l) => /^[+-][^+-]/.test(l)).slice(0, 12).join('\n')}`);
  console.log(`suite: ${row.counts}`);
  console.log(`predicted: ${JSON.stringify(predicted)}   observed: ${JSON.stringify(observed)}   => ${match}`);
  if (res.firstErr) console.log(`first error: ${res.firstErr}`);
  const clean = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--stat'], { encoding: 'utf8' });
  const untracked = spawnSync('git', ['-C', WT, 'status', '--porcelain', '--', 'docs'], { encoding: 'utf8' });
  console.log(`worktree: ${clean.status === 0 && untracked.stdout.trim() === '' ? 'CLEAN' : 'DIRTY'}`);
}
writeFileSync(join(SP, 'mutant-table.json'), JSON.stringify(table, null, 2));
console.log('\n=== SUMMARY ===');
for (const r of table) console.log(`${r.match.padEnd(11)} ${r.name.padEnd(42)} crit=${String(r.criterion).padEnd(5)} predicted=${JSON.stringify(r.predicted).padEnd(22)} observed=${JSON.stringify(r.observed)}`);
