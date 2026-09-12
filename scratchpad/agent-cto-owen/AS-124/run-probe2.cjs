const { spawnSync, spawn } = require('node:child_process');
const { writeFileSync, renameSync, statSync } = require('node:fs');
const sp = '/Users/forrest/Code/american-software-company/scratchpad/agent-cto-owen/AS-124';
const mnt = sp + '/mnt';
const base = ['run', '--rm', '--platform', 'linux/amd64', '-v', sp + ':/probe', 'node:24-slim', 'node', '/probe/ino-probe2.mjs', '/probe/mnt'];

// 1. inside-container variants
const r = spawnSync('/usr/local/bin/docker', [...base, 'inside'], { encoding: 'utf8', timeout: 120000 });
console.log('inside exit', r.status, '\n' + r.stdout, r.stderr.slice(0, 500));

// 2. container watches while the HOST renames (twice, 1.5 s apart)
writeFileSync(mnt + '/company.jsonl', 'h\n'.repeat(10));
console.log('host ino before', statSync(mnt + '/company.jsonl').ino);
const w = spawn('/usr/local/bin/docker', [...base, 'watch', '6000'], { encoding: 'utf8' });
let out = '';
w.stdout.on('data', (d) => (out += d));
w.stderr.on('data', (d) => (out += '[err] ' + d));
setTimeout(() => {
  writeFileSync(mnt + '/company.jsonl.next', 'x\n'.repeat(12));
  renameSync(mnt + '/company.jsonl.next', mnt + '/company.jsonl');
  console.log('host renamed #1, host ino now', statSync(mnt + '/company.jsonl').ino);
}, 2500);
setTimeout(() => {
  writeFileSync(mnt + '/company.jsonl.next', 'y\n'.repeat(14));
  renameSync(mnt + '/company.jsonl.next', mnt + '/company.jsonl');
  console.log('host renamed #2, host ino now', statSync(mnt + '/company.jsonl').ino);
}, 4500);
w.on('close', (code) => {
  console.log('watch exit', code, '\n' + out);
});
