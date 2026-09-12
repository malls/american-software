const { spawnSync } = require('child_process');
const fs = require('fs');
const M = '/Users/forrest/Code/american-software-company';
const text = fs.readFileSync(M + '/scratchpad/agent-qa-ruben/AS-108/review-comment.txt', 'utf8').trim();
const r = spawnSync('lattice', ['comment', 'AS-108', text, '--role', 'review', '--actor', 'agent:qa-ruben'], { cwd: M, encoding: 'utf8' });
console.log(r.stdout, r.stderr, 'exit', r.status);
const s = spawnSync('lattice', ['show', 'AS-108'], { cwd: M, encoding: 'utf8' });
console.log(s.stdout.split('\n').filter((l) => /qa-ruben|^Status/.test(l)).join('\n'));
