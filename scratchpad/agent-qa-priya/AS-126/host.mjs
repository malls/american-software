import { spawnSync } from 'node:child_process';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-126/apps/chat';
for (const [label, args] of [
  ['FULL host suite', ['--test']],
  ['favicon subset', ['--test', '--test-name-pattern', 'favicon', 'test/api.test.js']],
]) {
  const r = spawnSync('node', args, { cwd: W, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  const sum = ['tests', 'pass', 'fail', 'skipped'].map(k => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1]).join('/');
  const fails = [...out.slice(out.indexOf('✖ failing tests:')).matchAll(/^\s*✖ (.+?) \([\d.]+ms\)$/gm)].map(m => m[1]);
  console.log(`${label}: exit=${r.status} tests/pass/fail/skipped=${sum}${fails.length ? '\n  red: ' + fails.join('\n  red: ') : ''}`);
  if (label === 'favicon subset') console.log(out.split('\n').filter(l => /^✔|^✖/.test(l)).join('\n'));
}
console.log('porcelain:', JSON.stringify(spawnSync('git', ['-C', W, 'status', '--porcelain'], { encoding: 'utf8' }).stdout));
