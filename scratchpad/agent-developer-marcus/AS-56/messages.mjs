// Pull the exact failing assertion messages for four mutants (scratch copies).
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-56';
const cases = {
  AC1a: ['docs/design/tokens/tokens.css', /var\(--color-danger-400\)/g, 'var(--color-danger-500)', 2],
  AC2: ['BRANDING.md', /\(non-text\) \| 3\.17:1 \|/g, '(non-text) | 3.99:1 |', 1],
  AC5: ['docs/design/style-reference/index.html', /<tr class="result--pass"><td><code>--color-danger-solid<\/code><\/td><td>3\.17:1<\/td><td>3:1<\/td><td><span class="result-badge result--pass">PASS<\/span>/g, '<tr class="result--fail"><td><code>--color-danger-solid</code></td><td>2.97:1</td><td>3:1</td><td><span class="result-badge result--fail">FAIL</span>', 1],
  AC6: ['docs/design/tokens/tokens.test.mjs', /generatedFails\.length, 11,/g, 'generatedFails.length, 12,', 1],
};
for (const [id, [rel, re, to, expect]] of Object.entries(cases)) {
  const dir = mkdtempSync(join(tmpdir(), 'as56-msg-'));
  spawnSync('tar', ['-x', '-C', dir], { input: execFileSync('git', ['-C', W, 'archive', 'HEAD'], { maxBuffer: 1 << 28 }) });
  const p = join(dir, rel);
  const t = readFileSync(p, 'utf8');
  const n = (t.match(re) || []).length;
  if (n !== expect) throw new Error(`${id}: ${n} matches, expected ${expect}`);
  writeFileSync(p, t.replace(re, to));
  const out = spawnSync('node', ['--test', '--test-reporter=tap', 'docs/design/tokens/*.test.mjs'], { cwd: dir, encoding: 'utf8' });
  const all = out.stdout + out.stderr;
  const msgs = [...all.matchAll(/error: \|-\n((?:\s{2,}.*\n)+)/g)].map((m) => m[1].split('\n').filter(Boolean).slice(0, 3).map((s) => s.trim()).join(' / '));
  console.log(`=== ${id}: ${msgs.length} failing assertion(s)`);
  for (const m of msgs) console.log('   ', m.slice(0, 300));
  rmSync(dir, { recursive: true, force: true });
}
