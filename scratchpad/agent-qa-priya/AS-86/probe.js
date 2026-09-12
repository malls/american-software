const { spawnSync } = require('child_process');
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-86';
const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts }); return (r.stdout || '') + (r.stderr || ''); };
const fs = require('fs');
console.log('--- ls-tree (criterion 2) ---');
console.log(sh('git', ['-C', W, 'ls-tree', 'HEAD', '--', 'apps/chat/lib', 'apps/chat/bin', 'apps/chat/public', 'apps/chat/server.js', 'apps/chat/package.json', 'apps/chat/test', 'apps/chat/compose.yaml', 'apps/chat/Dockerfile', 'apps/chat/.dockerignore', 'apps/chat/watch']));
console.log('--- IMAGE_INPUTS as written ---');
const src = fs.readFileSync(W + '/apps/chat/watch/advance-watcher.mjs', 'utf8');
const m = src.match(/export const IMAGE_INPUTS = Object\.freeze\(\[[\s\S]*?\]\);/);
console.log(m ? m[0] : 'NOT FOUND');
console.log('--- ls-files apps/chat (non-export) ---');
const ls = sh('git', ['-C', W, 'ls-files', 'apps/chat']).split('\n').filter(Boolean);
console.log('total tracked:', ls.length);
console.log(ls.filter((p) => !p.startsWith('apps/chat/data/export/')).join('\n'));
console.log('--- stale strings ---');
for (const f of ['watch/advance-watcher.mjs', 'watch/README.md', 'README.md', 'Dockerfile', 'compose.yaml']) {
  const t = fs.readFileSync(W + '/apps/chat/' + f, 'utf8').split('\n');
  t.forEach((l, i) => { if (/8 of 9|nine image|9 image inputs|nine paths|9 paths|nine inputs/.test(l)) console.log(f + ':' + (i + 1) + ': ' + l); });
}
console.log('--- test service ---');
const comp = fs.readFileSync(W + '/apps/chat/compose.yaml', 'utf8').split('\n');
const ti = comp.findIndex((l) => /^  test:/.test(l));
console.log(comp.slice(ti, ti + 16).join('\n'));
console.log('--- worktree status ---');
console.log(sh('git', ['-C', W, 'status', '--short']));
console.log('--- master .dockerignore vs branch ---');
console.log(sh('git', ['-C', W, 'show', 'master:apps/chat/.dockerignore']));
