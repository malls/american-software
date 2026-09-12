// AS-35 falsifiers. Mutates tokens.css (M1–M7) or tokens.test.mjs (M8) IN
// PLACE inside the worktree, with a byte backup and a finally-restore, runs
// the token suite, records the exact set of failing tests, restores, and
// proves restoration with `git diff --exit-code`. Every mutation is asserted
// applied at the intended site by occurrence count before the run.
//
// Run from anywhere: node scratchpad/agent-developer-marcus/AS-35/falsify.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-35';
const CSS = join(WT, 'docs/design/tokens/tokens.css');
const TEST = join(WT, 'docs/design/tokens/tokens.test.mjs');

const T = {
  A: 'tokens.css cascade structure',
  B: 'tokens.css block selectors',
  C: 'tokens.css block 3',
  D: 'format-contract guard — parseTopLevelRules',
};

function count(hay, needle) {
  let n = 0; let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n += 1; i += needle.length; }
  return n;
}

const MEDIA_RULE_START = '@media (prefers-color-scheme: dark) {';
const DARK_RULE_START = '[data-theme="dark"] {';

const mutants = [
  {
    id: 'M1', ac: 2, file: CSS, desc: 'block-4 selector [data-theme="dark"] -> [data-theme="drak"] (Priya R1)',
    apply: (s) => { if (count(s, DARK_RULE_START) !== 1) throw new Error('site'); return s.replace(DARK_RULE_START, '[data-theme="drak"] {'); },
    expect: [T.B],
  },
  {
    id: 'M2', ac: 3, file: CSS, desc: 'block-2 selector `:root,\\n[data-theme="light"]` -> bare `:root`',
    apply: (s) => { const site = ':root,\n[data-theme="light"] {'; if (count(s, site) !== 1) throw new Error('site'); return s.replace(site, ':root {'); },
    expect: [T.B],
  },
  {
    id: 'M3', ac: 4, file: CSS, desc: 'block-3 media query prefers-color-scheme: dark -> light',
    apply: (s) => { if (count(s, MEDIA_RULE_START) !== 1) throw new Error('site'); return s.replace(MEDIA_RULE_START, '@media (prefers-color-scheme: light) {'); },
    expect: [T.C],
  },
  {
    id: 'M4', ac: 5, file: CSS, desc: 'block-3 guard :root:not([data-theme="light"]) -> :root',
    apply: (s) => { const site = '  :root:not([data-theme="light"]) {'; if (count(s, site) !== 1) throw new Error('site'); return s.replace(site, '  :root {'); },
    expect: [T.C],
  },
  {
    id: 'M5', ac: 6, file: CSS, desc: 'swap the rule text of blocks 3 and 4 (comment markers stay where they are)',
    apply: (s) => {
      // Rule 3: from "@media" through the "}\n}" that closes it. Rule 4: from "[data-theme=\"dark\"] {" to the final "}".
      const r3s = s.indexOf(MEDIA_RULE_START); const r3e = s.indexOf('}\n}\n', r3s) + 4;
      const r4s = s.indexOf(DARK_RULE_START); const r4e = s.lastIndexOf('}') + 1;
      if (r3s === -1 || r3e < 4 || r4s === -1 || r4s < r3e) throw new Error('site');
      const rule3 = s.slice(r3s, r3e); const rule4 = s.slice(r4s, r4e);
      const out = s.slice(0, r3s) + rule4 + '\n' + s.slice(r3e, r4s) + rule3.trimEnd() + s.slice(r4e);
      if (count(out, MEDIA_RULE_START) !== 1 || count(out, DARK_RULE_START) !== 1 || out.indexOf(DARK_RULE_START) > out.indexOf(MEDIA_RULE_START)) throw new Error('site');
      return out;
    },
    // First run predicted {B, C}; observed {A, B, C}: T-A parses rule 3's body
    // for its nested rule, and a bare [data-theme="dark"] body has none, so the
    // fail-loud parser throws inside T-A. Plan criterion 6 amended to match.
    expect: [T.A, T.B, T.C],
  },
  {
    id: 'M6', ac: 7, file: CSS, desc: 'append a fifth top-level rule `html { }` after block 4',
    apply: (s) => s.trimEnd() + '\n\nhtml { }\n',
    expect: [T.A],
  },
  {
    id: 'M7', ac: '(extra)', file: CSS, desc: 'move the [data-theme="dark"] rule above the BLOCK 4 comment header (marker join)',
    apply: (s) => {
      const hdr = s.indexOf('/*\n * ============================================================================\n * BLOCK 4');
      const r4s = s.indexOf(DARK_RULE_START); const r4e = s.lastIndexOf('}') + 1;
      if (hdr === -1 || r4s < hdr) throw new Error('site');
      const rule4 = s.slice(r4s, r4e);
      return s.slice(0, hdr) + rule4 + '\n\n' + s.slice(hdr, r4s).trimEnd() + '\n';
    },
    // Existing module-level floor "block 4 parsed to zero declarations" throws before any test runs — whole file red. Recorded as observed.
    expect: null,
  },
  {
    id: 'M8', ac: 8, file: TEST, desc: 'parseTopLevelRules returns [] instead of throwing on zero rules',
    apply: (s) => {
      const site = "  if (rules.length === 0) {\n    throw new Error(`FORMAT CONTRACT BROKEN in ${sourceLabel}: no rules found at all";
      if (count(s, site) !== 1) throw new Error('site');
      return s.replace(site, "  if (rules.length === 0) {\n    return { rules, trailing: outside }; // MUTANT M8\n    throw new Error(`FORMAT CONTRACT BROKEN in ${sourceLabel}: no rules found at all");
    },
    expect: [T.D],
  },
];

function runSuite() {
  // The only *.test.mjs in the directory; no shell glob needed.
  const r = spawnSync('node', ['--test', 'docs/design/tokens/tokens.test.mjs'], { cwd: WT, encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  // The spec reporter prints each failing test twice (inline and in the summary) — dedupe.
  const failing = [...new Set([...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))];
  const summary = { tests: +(/ℹ tests (\d+)/.exec(out)?.[1] ?? -1), pass: +(/ℹ pass (\d+)/.exec(out)?.[1] ?? -1), fail: +(/ℹ fail (\d+)/.exec(out)?.[1] ?? -1) };
  const loadError = /FORMAT CONTRACT BROKEN in tokens\.css: block \d parsed to zero declarations|SyntaxError|Cannot find/.exec(out)?.[0] ?? null;
  return { failing, summary, loadError, out };
}

function gitClean() {
  return spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--quiet'], { encoding: 'utf8' }).status === 0;
}

const rows = [];
for (const m of mutants) {
  const original = readFileSync(m.file);
  let result;
  try {
    const mutated = m.apply(original.toString('utf8'));
    if (mutated === original.toString('utf8')) throw new Error(`${m.id}: mutation did not change the file`);
    writeFileSync(m.file, mutated);
    // Assert applied: the file on disk differs from git at exactly this path.
    if (gitClean()) throw new Error(`${m.id}: mutation not applied on disk`);
    result = runSuite();
  } finally {
    writeFileSync(m.file, original);
  }
  const restored = gitClean();
  const red = result.failing.map((name) => Object.entries(T).find(([, p]) => name.startsWith(p))?.[0] ?? `OTHER:${name}`);
  const expectedKeys = m.expect === null ? null : m.expect.map((p) => Object.entries(T).find(([, q]) => q === p)[0]);
  const exact = expectedKeys === null ? (result.loadError !== null) : JSON.stringify([...red].sort()) === JSON.stringify([...expectedKeys].sort());
  rows.push({ id: m.id, ac: m.ac, desc: m.desc, summary: result.summary, red, loadError: result.loadError, expected: expectedKeys, exact, restored });
  console.log(`${m.id} AC${m.ac} ${m.desc}\n   run ${result.summary.tests}/${result.summary.pass}/${result.summary.fail}  red=${JSON.stringify(red)}  loadError=${result.loadError}  expected=${JSON.stringify(expectedKeys)}  exact=${exact}  restored(git diff --exit-code clean)=${restored}`);
  if (process.env.VERBOSE) console.log(result.out);
}

const final = runSuite();
console.log(`\nfinal (restored) run: ${final.summary.tests}/${final.summary.pass}/${final.summary.fail}; git clean=${gitClean()}`);
writeFileSync(new URL('./mutant-table.json', import.meta.url), JSON.stringify({ rows, final: final.summary }, null, 2) + '\n');
