// Runs the opt-in real-build test from the worktree with docker by absolute path.
const { spawnSync } = require('child_process');
const wt = '/Users/forrest/Code/american-software-company/.worktrees/AS-87';
const r = spawnSync('node', ['--test', 'apps/chat/test/watcher-deploy-real.test.js'], {
  cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, AS87_REAL_BUILD: '1', ADVANCE_DOCKER_BIN: '/usr/local/bin/docker' },
});
const out = (r.stdout + r.stderr).split('\n').filter((l) => !/^\s+at /.test(l));
console.log(out.slice(-30).join('\n'));
console.log('exit', r.status, new Date().toISOString());
