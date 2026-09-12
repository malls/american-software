// AS-56 falsifier runner (developer-marcus). Scratch copies only — never the worktree.
// For each mutant: git archive the branch tip into a temp dir, apply ONE anchored
// mutation, assert it applied at the intended site (exact occurrence count), run
// the host token suite there, and print the exact set of failing test names.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-56';
const only = process.argv[2]; // optional mutant id

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'as56-falsify-'));
  const tar = execFileSync('git', ['-C', W, 'archive', 'HEAD'], { maxBuffer: 1 << 28 });
  const r = spawnSync('tar', ['-x', '-C', dir], { input: tar });
  if (r.status !== 0) throw new Error('tar failed: ' + r.stderr);
  return dir;
}

/** Replace `from` with `to` in file; assert exactly `expect` occurrences existed. */
function mutate(dir, rel, from, to, expect) {
  const p = join(dir, rel);
  const text = readFileSync(p, 'utf8');
  const n = text.split(from).length - 1;
  if (n !== expect) throw new Error(`MUTATION NOT APPLIED AT INTENDED SITE: ${rel} has ${n} occurrence(s) of ${JSON.stringify(from)}, expected ${expect}`);
  writeFileSync(p, text.split(from).join(to));
  const after = readFileSync(p, 'utf8');
  if (after.includes(from) || !after.includes(to)) throw new Error(`mutation verification failed in ${rel}`);
}

function runSuite(dir, suiteArgs, cwd) {
  const r = spawnSync('node', ['--test', '--test-reporter=tap', ...suiteArgs], { cwd: cwd ?? dir, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = r.stdout + r.stderr;
  const fails = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  const summary = out.match(/# tests (\d+)[\s\S]*?# pass (\d+)[\s\S]*?# fail (\d+)/);
  // first assertion message per failing test, for the record
  const msgs = [...out.matchAll(/^not ok \d+ - (.+)\n[\s\S]*?error: ['"|>]?\s*([^\n]{0,260})/gm)].map((m) => `${m[1]} :: ${m[2]}`);
  return { status: r.status, fails, summary: summary ? `${summary[1]}/${summary[2]}/${summary[3]}` : 'NO SUMMARY', msgs, raw: out };
}

const TOK = ["docs/design/tokens/*.test.mjs"];
const DARK_BLOCK3 = `    --color-danger-solid: var(--color-danger-400);\n    --color-danger-solid-hover: var(--color-danger-600);\n  }\n}`;
const DARK_BLOCK4 = `  --color-danger-solid: var(--color-danger-400);\n  --color-danger-solid-hover: var(--color-danger-600);\n}`;

const MUTANTS = {
  // AC1(a): tokens.css dark alias back to danger-500 in BOTH dark blocks (BRANDING unchanged).
  'AC1a-css-both-dark-blocks': (d) => {
    mutate(d, 'docs/design/tokens/tokens.css', DARK_BLOCK3, DARK_BLOCK3.replace('danger-400', 'danger-500'), 1);
    mutate(d, 'docs/design/tokens/tokens.css', DARK_BLOCK4, DARK_BLOCK4.replace('danger-400', 'danger-500'), 1);
  },
  // AC1(b): BRANDING §3.3 alias row back to danger-500/#CE2735 (the matrix is computed from BRANDING).
  'AC1b-branding-dark-alias': (d) => {
    mutate(d, 'BRANDING.md', '| `--color-danger-solid` | `#D62937` | `danger-400` |', '| `--color-danger-solid` | `#CE2735` | `danger-500` |', 1);
  },
  // AC1(c): only block 3 reverted — the duplication invariant must catch a half-applied retune.
  'AC1c-css-block3-only': (d) => {
    mutate(d, 'docs/design/tokens/tokens.css', DARK_BLOCK3, DARK_BLOCK3.replace('danger-400', 'danger-500'), 1);
  },
  // AC2: the new §3.4 row's ratio written wrong (3.99 instead of 3.17).
  'AC2-branding-row-3.99': (d) => {
    mutate(d, 'BRANDING.md', '| `danger-solid` boundary vs `bg-surface` (non-text) | 3.17:1 |', '| `danger-solid` boundary vs `bg-surface` (non-text) | 3.99:1 |', 1);
  },
  // AC3: the danger-400 step removed from BRANDING §3.1 — every pinned 44 must bite.
  'AC3-branding-drop-danger-400': (d) => {
    mutate(d, 'BRANDING.md', ' · `-400 #D62937`', '', 1);
  },
  // AC3': the new swatch removed from the style reference — the 44-swatch pin must bite.
  'AC3b-html-drop-swatch': (d) => {
    mutate(d, 'docs/design/style-reference/index.html', '          <div class="swatch"><span class="swatch__fill" style="background:var(--color-danger-400)"></span><code class="swatch__name">--color-danger-400</code><span class="swatch__hex">#D62937</span></div>\n', '', 1);
  },
  // AC5: a stale FAIL badge left on the fixed row in the style reference.
  'AC5-html-stale-fail-badge': (d) => {
    mutate(d, 'docs/design/style-reference/index.html',
      '<tr class="result--pass"><td><code>--color-danger-solid</code></td><td>3.17:1</td><td>3:1</td><td><span class="result-badge result--pass">PASS</span></td></tr>',
      '<tr class="result--fail"><td><code>--color-danger-solid</code></td><td>2.97:1</td><td>3:1</td><td><span class="result-badge result--fail">FAIL</span></td></tr>', 1);
  },
  // AC5': the callout count left at 12 is prose, not parsed — record that this one is NOT caught by the suite (grep-only criterion).
  'AC5b-html-callout-12': (d) => {
    mutate(d, 'docs/design/style-reference/index.html', '<strong>11 combinations fail', '<strong>12 combinations fail', 1);
  },
  // AC6: the 11-FAIL pin — flip generatedFails expectation back to 12 to show it is read.
  'AC6-test-fails-pin-12': (d) => {
    mutate(d, 'docs/design/tokens/tokens.test.mjs', 'assert.equal(generatedFails.length, 11,', 'assert.equal(generatedFails.length, 12,', 1);
  },
};

// Chat parity: the served copy drifts from the source by one alias.
const CHAT_MUTANT = {
  'CHAT-copy-drift': (d) => {
    mutate(d, 'apps/chat/public/tokens.css', DARK_BLOCK4, DARK_BLOCK4.replace('danger-400', 'danger-500'), 1);
  },
};

const results = {};
for (const [id, fn] of Object.entries({ ...MUTANTS, ...CHAT_MUTANT })) {
  if (only && id !== only) continue;
  const dir = scratch();
  try {
    fn(dir);
    const isChat = id.startsWith('CHAT');
    const res = isChat
      ? runSuite(dir, ['test/tokens-parity.test.js'], join(dir, 'apps/chat'))
      : runSuite(dir, TOK);
    results[id] = { summary: res.summary, fails: res.fails, msgs: res.msgs };
    console.log(`\n=== ${id} — ${res.summary} (exit ${res.status})`);
    for (const f of res.fails) console.log('  RED:', f);
    for (const m of res.msgs) console.log('  msg:', m);
    if (res.fails.length === 0) console.log('  *** SURVIVOR — no red ***');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
writeFileSync(join('/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/AS-56', 'falsify-results.json'), JSON.stringify(results, null, 2));
