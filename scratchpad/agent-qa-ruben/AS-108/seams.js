const { spawnSync } = require('child_process');
const M = '/Users/forrest/Code/american-software-company';
const g = (args, cwd = M) => spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const B = 'feat/AS-108-lanes-realpath-root';
for (const b of ['master', 'feat/AS-106-compose-run-teardown', 'feat/AS-120-href-assignment-operators', 'feat/AS-115-copy-refs']) {
  if (g(['rev-parse', '-q', '--verify', b]).status !== 0) { console.log(`vs ${b}: branch absent`); continue; }
  const r = g(['merge-tree', '--write-tree', b, B]);
  const conflicts = (r.stdout + r.stderr).split('\n').filter((l) => /CONFLICT/.test(l));
  console.log(`vs ${b} (${g(['rev-parse', '--short', b]).stdout.trim()}): rc=${r.status}, ${conflicts.length} conflicts ${conflicts.slice(0, 3).join(' | ')}`);
}
console.log('.lattice files on branch:', g(['diff', '--name-only', `master...${B}`]).stdout.split('\n').filter((l) => l.startsWith('.lattice')).length);
console.log('worktree status:', JSON.stringify(g(['status', '--short'], M + '/.worktrees/AS-108').stdout));
console.log('authors:', g(['log', '--format=%an <%ae>', `master..${B}`]).stdout.trim().split('\n').join(' ; '));
console.log('branch-link:', spawnSync('lattice', ['show', 'AS-108'], { cwd: M, encoding: 'utf8' }).stdout.split('\n').filter((l) => /branch|status/i.test(l)).slice(0, 4).join(' | '));
