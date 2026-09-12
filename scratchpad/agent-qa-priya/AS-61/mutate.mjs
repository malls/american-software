// AS-61 mutation battery (agent:qa-priya). In-place, restore-on-exit, site-asserted.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-61';
const SRV = `${W}/apps/chat/server.js`;
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-61';
const MUT = {
  'M-A': { pat: "  if (st.nlink !== 1) throw fail(); // 4b (AS-61): a served file has exactly one name\n", rep: '' },
  'M-B': { pat: 'st.nlink !== 1', rep: 'st.nlink === 1' },
  'M-C': { pat: "!(i === 0 && s === '.lattice')", rep: "!(i === 0 && (s === '.lattice' || s === '.claude'))" },
  'M-D': { pat: 'if (st.nlink !== 1) throw fail();', rep: "if (st.nlink !== 1) throw new StoreError('hard link', 'not_found');" },
};
const orig = readFileSync(SRV, 'utf8');
copyFileSync(SRV, `${OUT}/server.js.bak`);
const restore = () => writeFileSync(SRV, orig);
process.on('exit', restore);
const results = {};
for (const [name, { pat, rep }] of Object.entries(MUT)) {
  const fnStart = orig.indexOf('\nfunction readRepoMarkdown(');
  const fnEnd = orig.indexOf('\n}\n', fnStart);
  const body = orig.slice(fnStart, fnEnd);
  const occurrences = body.split(pat).length - 1;
  const lineNo = orig.slice(0, fnStart + body.indexOf(pat)).split('\n').length;
  console.log(`\n=== ${name}: pattern occurs ${occurrences}x inside readRepoMarkdown (L${orig.slice(0, fnStart).split('\n').length}-L${orig.slice(0, fnEnd).split('\n').length + 1}); site L${lineNo}`);
  if (occurrences !== 1) { console.log('ABORT: not unique inside function'); results[name] = 'ABORT'; continue; }
  const mutated = orig.slice(0, fnStart) + body.replace(pat, rep) + orig.slice(fnEnd);
  if (mutated === orig) { console.log('ABORT: mutation did not change file'); results[name] = 'ABORT'; continue; }
  writeFileSync(SRV, mutated);
  const d = execSync(`git -C ${W} diff -U0 -- apps/chat/server.js`, { encoding: 'utf8' });
  const changed = d.split('\n').filter((l) => /^[-+][^-+]/.test(l));
  console.log('mutated diff lines:\n' + changed.map((l) => '  ' + l).join('\n'));
  console.log('diff --stat: ' + execSync(`git -C ${W} diff --stat -- apps/chat/server.js`, { encoding: 'utf8' }).trim().split('\n').pop());
  const r = spawnSync('node', ['--test', `${W}/apps/chat/test/*.test.js`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  writeFileSync(`${OUT}/${name}.log`, out);
  const counts = out.split('\n').filter((l) => /^ℹ (tests|pass|fail) /.test(l)).join(' | ');
  const red = [...new Set(out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/ \([0-9.]+ms\)$/, '').slice(2)))];
  console.log('counts: ' + counts);
  console.log('RED SET (' + red.length + '): ' + JSON.stringify(red));
  results[name] = red;
  restore();
  const clean = spawnSync('git', ['-C', W, 'diff', '--exit-code', '--', 'apps/chat/server.js']);
  console.log('restored, git diff --exit-code status: ' + clean.status);
}
console.log('\nSUMMARY: ' + JSON.stringify(results, null, 1));
