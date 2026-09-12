// Mutant battery for AS-115 on a SCRATCH copy (never the task worktree).
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-115/apps/chat';
const DOCS = '/Users/forrest/Code/american-software-company/docs';
const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-115/mut';
const APP = path.join(ROOT, 'apps/chat');
rmSync(ROOT, { recursive: true, force: true });
cpSync(SRC, APP, { recursive: true, filter: (p) => !p.includes('node_modules') && !p.includes('/data/') });
// tokens-parity test resolves docs/ relative to repo root — mirror it.
cpSync(DOCS + '/design/tokens', path.join(ROOT, 'docs/design/tokens'), { recursive: true });

const TESTS = ['test/copy-refs.test.js', 'test/leaf-refs.test.js', 'test/tokens-parity.test.js'];
function run() {
  const r = spawnSync('node', ['--test', '--test-reporter=tap', ...TESTS], { cwd: APP, encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = r.stdout + r.stderr;
  const failing = [...out.matchAll(/^not ok \d+ - (T\d+)/gm)].map((m) => m[1]);
  const total = (out.match(/^# tests (\d+)/m) || [])[1];
  const pass = (out.match(/^# pass (\d+)/m) || [])[1];
  return { failing: [...new Set(failing)].sort(), total, pass };
}
const baseline = run();
console.log('BASELINE', JSON.stringify(baseline));

function mutate(name, file, from, to, predicted) {
  const f = path.join(APP, file);
  const orig = readFileSync(f, 'utf8');
  const count = orig.split(from).length - 1;
  if (count !== 1) { console.log(`${name}: ANCHOR count=${count} (expected 1) — NOT APPLIED`); return; }
  const mutated = orig.replace(from, to);
  if (mutated === orig) { console.log(`${name}: mutation did not change file — NOT APPLIED`); return; }
  writeFileSync(f, mutated);
  // assert applied at site
  const applied = readFileSync(f, 'utf8') === mutated;
  let res;
  try { res = run(); } finally { writeFileSync(f, orig); }
  const restored = readFileSync(f, 'utf8') === orig;
  console.log(`${name}: applied=${applied} restored=${restored} red=${JSON.stringify(res.failing)} predicted=${JSON.stringify(predicted)} match=${JSON.stringify(res.failing) === JSON.stringify(predicted.sort())}`);
}

// M1: {7,40} -> {8,40} in HASH_RE
mutate('M1', 'public/copy-refs.js', '[0-9a-f]{7,40}(?!', '[0-9a-f]{8,40}(?!', ['T1', 'T13']);
// M8: url tokens stop being terminal (refine feeds url token text down)
mutate('M8', 'public/leaf-refs.js', "if (tok.type !== 'text') out.push(tok);", "if (tok.type !== 'text' && tok.type !== 'url') out.push(tok);", ['T8', 'T11', 'T13']);
// M9a: swap branch and AS-ref passes
mutate('M9a', 'public/leaf-refs.js',
  "  if (autolink) tokens = refine(tokens, tokenizeBranches);\n  tokens = refine(tokens, (t) => tokenizeAsRefs(t, refs));",
  "  tokens = refine(tokens, (t) => tokenizeAsRefs(t, refs));\n  if (autolink) tokens = refine(tokens, tokenizeBranches);", ['T9']);
// M10: hash pass ahead of msg-refs
mutate('M10', 'public/leaf-refs.js',
  "  tokens = refine(tokens, tokenizeMsgRefs);\n  tokens = refine(tokens, tokenizeFileRefs);\n  if (autolink) tokens = refine(tokens, tokenizeHashes);",
  "  if (autolink) tokens = refine(tokens, tokenizeHashes);\n  tokens = refine(tokens, tokenizeMsgRefs);\n  tokens = refine(tokens, tokenizeFileRefs);", ['T10']);
// M11: autolink gates only the URL pass
mutate('M11', 'public/leaf-refs.js',
  "  if (autolink) tokens = refine(tokens, tokenizeBranches);",
  "  tokens = refine(tokens, tokenizeBranches);", ['T12']);
// M13: node.href = '' inside copyRefNode (anchor: the dataset.kind line, unique to copyRefNode)
mutate('M13', 'public/app.js', "  node.dataset.kind = tok.type;\n", "  node.dataset.kind = tok.type;\n  node.href = '';\n", ['T17']);
// M13b: setAttribute spelling
mutate('M13b', 'public/app.js', "  node.dataset.kind = tok.type;\n", "  node.dataset.kind = tok.type;\n  node.setAttribute('href', '');\n", ['T17']);
// M12: flip a byte in public/tokens.css
mutate('M12', 'public/tokens.css', '--font-family-mono:', '--font-family-mono :', ['T16']);
// M14: delete data-theme
mutate('M14', 'public/index.html', ' data-theme="light"', '', ['T18']);
// M15: raw hex in .copy-ref
mutate('M15', 'public/style.css', 'background: var(--color-accent-bg-subtle);', 'background: #EFF2FD;', ['T19']);
// M3: admitHash returns true
mutate('M3', 'public/copy-refs.js', '  if (HEX_WORDS.has(s)) return false;', '  return true;\n  if (HEX_WORDS.has(s)) return false;', ['T2', 'T3']);
console.log('DONE; scratch at', ROOT);
