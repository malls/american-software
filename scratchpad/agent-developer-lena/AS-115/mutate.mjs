// AS-115 mutation battery. Each mutant runs in a fresh scratch copy of
// apps/chat (+ docs/design/tokens for the parity test) — the worktree is never
// mutated. Each mutation is anchored to its site and asserted applied there.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-115';
const only = process.argv.slice(2);

function anchored(file, site, from, to) {
  return (root) => {
    const p = path.join(root, 'apps/chat', file);
    const src = readFileSync(p, 'utf8');
    const at = src.indexOf(site);
    if (at < 0) throw new Error(`site not found: ${site}`);
    const end = src.indexOf('\n}\n', at) === -1 ? src.length : Math.min(src.length, src.indexOf('\n}\n', at) + 3);
    const region = src.slice(at, Math.max(end, at + site.length + from.length + 400));
    if (!region.includes(from)) throw new Error(`mutation text not inside site region: ${from}`);
    const mutated = src.slice(0, at) + region.replace(from, to) + src.slice(at + region.length);
    if (mutated === src) throw new Error('mutation produced no change');
    writeFileSync(p, mutated);
    const check = readFileSync(p, 'utf8');
    const siteAt = check.indexOf(site);
    const toAt = check.indexOf(to, siteAt);
    if (toAt < 0 || toAt - siteAt > region.length) throw new Error('mutation did not land at the intended site');
    return `${file}: ${JSON.stringify(from).slice(0, 60)} -> ${JSON.stringify(to).slice(0, 60)} @ offset ${toAt}`;
  };
}

const MUTANTS = {
  M1: anchored('public/copy-refs.js', 'const HASH_RE =', '[0-9a-f]{7,40}', '[0-9a-f]{8,40}'),
  M2: anchored('public/copy-refs.js', 'const HASH_RE =', '(?<![A-Za-z0-9_/#-])', '(?<![A-Za-z0-9_/-])'),
  M3: anchored('public/copy-refs.js', 'function admitHash(s) {', "  if (HEX_WORDS.has(s)) return false;\n  if (/^\\d+$/.test(s)) return s.length === 7;\n  return true;", '  return true;'),
  M5: anchored('public/copy-refs.js', 'const BRANCH_RE =', '(?:-[A-Za-z0-9_]+)+', '(?:-[A-Za-z0-9_]+)*'),
  M6: anchored('public/copy-refs.js', 'const BRANCH_RE =', '(?![A-Za-z0-9_/-])', '(?![A-Za-z0-9_-])'),
  M7: anchored('public/copy-refs.js', 'const HASH_RE =', '(?!\\.?[A-Za-z0-9_-])', '(?![A-Za-z0-9_-])'),
  M8: anchored('public/leaf-refs.js', 'function refine(tokens, pass) {', "if (tok.type !== 'text') out.push(tok);", "if (tok.type !== 'text' && tok.type !== 'url') out.push(tok);"),
  M9a: anchored('public/leaf-refs.js', 'export function tokenizeLeaf(', "  if (autolink) tokens = refine(tokens, tokenizeBranches);\n  tokens = refine(tokens, (t) => tokenizeAsRefs(t, refs));", "  tokens = refine(tokens, (t) => tokenizeAsRefs(t, refs));\n  if (autolink) tokens = refine(tokens, tokenizeBranches);"),
  M10: anchored('public/leaf-refs.js', 'export function tokenizeLeaf(', "  tokens = refine(tokens, tokenizeMsgRefs);\n  tokens = refine(tokens, tokenizeFileRefs);\n  if (autolink) tokens = refine(tokens, tokenizeHashes);", "  if (autolink) tokens = refine(tokens, tokenizeHashes);\n  tokens = refine(tokens, tokenizeMsgRefs);\n  tokens = refine(tokens, tokenizeFileRefs);"),
  M11: (root) => {
    const a = anchored('public/leaf-refs.js', 'export function tokenizeLeaf(', '  if (autolink) tokens = refine(tokens, tokenizeBranches);', '  tokens = refine(tokens, tokenizeBranches);')(root);
    const b = anchored('public/leaf-refs.js', 'export function tokenizeLeaf(', '  if (autolink) tokens = refine(tokens, tokenizeHashes);', '  tokens = refine(tokens, tokenizeHashes);')(root);
    return a + ' ; ' + b;
  },
  M12: (root) => {
    const p = path.join(root, 'apps/chat/public/tokens.css');
    const buf = readFileSync(p);
    const i = buf.indexOf(Buffer.from('--radius-sm:'));
    if (i < 0) throw new Error('site not found');
    buf[i + 12] = buf[i + 12] === 0x20 ? 0x21 : 0x20;
    writeFileSync(p, buf);
    const check = readFileSync(p);
    if (check.equals(readFileSync(path.join(root, 'docs/design/tokens/tokens.css')))) throw new Error('flip did not apply');
    return `tokens.css: one byte flipped at offset ${i + 12}`;
  },
  M13: anchored('public/app.js', 'function copyRefNode(tok) {', "  const node = el('span', 'copy-ref', tok.text);", "  const node = el('span', 'copy-ref', tok.text);\n  node.href = '';"),
  M14: (root) => {
    const p = path.join(root, 'apps/chat/public/index.html');
    const s = readFileSync(p, 'utf8');
    if (!s.includes('<html lang="en" data-theme="light">')) throw new Error('site not found');
    writeFileSync(p, s.replace('<html lang="en" data-theme="light">', '<html lang="en">'));
    if (readFileSync(p, 'utf8').includes('data-theme')) throw new Error('did not apply');
    return 'index.html: data-theme="light" removed';
  },
  M15: anchored('public/style.css', '.copy-ref {', 'background: var(--color-accent-bg-subtle);', 'background: #EFF2FD;'),
};

function runSuite(root) {
  const r = spawnSync('node', ['--test'], { cwd: path.join(root, 'apps/chat'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  const m = out.match(/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);
  const idx = out.indexOf('✖ failing tests:');
  const failing = idx < 0 ? [] : [...new Set(out.slice(idx).split('\n').filter((l) => l.startsWith('✖ ') && !l.includes('failing tests:') && !/^✖ test\//.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '')))];
  return { counts: m ? `${m[1]}/${m[2]}/${m[3]}` : 'unparsed', failing, exit: r.status };
}

for (const [name, apply] of Object.entries(MUTANTS)) {
  if (only.length && !only.includes(name)) continue;
  const root = mkdtempSync(path.join(tmpdir(), `as115-${name}-`));
  cpSync(path.join(WT, 'apps/chat'), path.join(root, 'apps/chat'), { recursive: true, filter: (s) => !s.includes('/node_modules') && !s.includes('/data/') });
  cpSync(path.join(WT, 'docs/design/tokens'), path.join(root, 'docs/design/tokens'), { recursive: true });
  let applied;
  try { applied = apply(root); } catch (e) { console.log(`${name}: MUTATION FAILED TO APPLY — ${e.message}`); rmSync(root, { recursive: true, force: true }); continue; }
  const r = runSuite(root);
  console.log(`${name}: applied [${applied}] -> ${r.counts} exit ${r.exit}; red set (${r.failing.length}): ${r.failing.map((f) => f.split(':')[0].split(' ').slice(0, 3).join(' ')).join(' | ')}`);
  for (const f of r.failing) console.log(`    - ${f}`);
  rmSync(root, { recursive: true, force: true });
}
