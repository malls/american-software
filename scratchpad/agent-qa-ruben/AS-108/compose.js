// AS-108 review: counted compose run with --build, own project, always torn down.
const { spawnSync } = require('child_process');
const fs = require('fs');
const M = '/Users/forrest/Code/american-software-company';
const cwd = M + '/.worktrees/AS-108/apps/chat';
const P = 'asc-review-as108';
const D = '/usr/local/bin/docker';
const log = M + '/scratchpad/agent-qa-ruben/AS-108/compose-run.log';
let text = '';
function run(args) {
  const r = spawnSync(D, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  text += `\n$ docker ${args.join(' ')}\n` + r.stdout + r.stderr + `\n[exit ${r.status}]\n`;
  return r;
}
const r = run(['compose', '-p', P, 'run', '--rm', '--build', 'test']);
const all = r.stdout + r.stderr;
const built = all.split('\n').filter((l) => /Built/.test(l));
const summary = all.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l));
const failing = all.split('\n').filter((l) => /^✖ /.test(l));
run(['compose', '-p', P, 'down', '-v', '--rmi', 'local', '--remove-orphans']);
const net = run(['network', 'ls']);
fs.writeFileSync(log, text);
console.log('BUILT lines:', built.join(' | ') || '(none — run is VOID)');
console.log('summary:', summary.join(' '), 'exit', r.status);
if (failing.length) console.log('failing:\n' + failing.join('\n'));
console.log('network after:\n' + net.stdout);
