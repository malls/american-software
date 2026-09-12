// AS-108 review: host suites on branch and master, cardinality first.
const { spawnSync } = require('child_process');
const fs = require('fs');
const M = '/Users/forrest/Code/american-software-company';
const out = [];
for (const [name, cwd] of [['branch', M + '/.worktrees/AS-108/apps/chat'], ['master', M + '/apps/chat']]) {
  const r = spawnSync('node', ['--test'], { cwd, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l));
  const failing = (r.stdout + r.stderr).split('\n').filter((l) => /^✖ /.test(l));
  out.push(`${name}: ${lines.join(' ')} exit=${r.status}${failing.length ? '\n  ' + failing.join('\n  ') : ''}`);
}
for (const [name, args, cwd] of [
  ['branch-head', ['-C', M + '/.worktrees/AS-108', 'rev-parse', '--short', 'HEAD']],
  ['master', ['-C', M, 'rev-parse', '--short', 'master']],
]) out.push(`${name}: ${spawnSync('git', args, { encoding: 'utf8' }).stdout.trim()}`);
const net = spawnSync('/usr/local/bin/docker', ['network', 'ls'], { encoding: 'utf8' });
out.push('docker network ls (before):\n' + net.stdout + net.stderr);
const text = out.join('\n') + '\n';
fs.writeFileSync(M + '/scratchpad/agent-qa-ruben/AS-108/host-runs.txt', text);
console.log(text);
