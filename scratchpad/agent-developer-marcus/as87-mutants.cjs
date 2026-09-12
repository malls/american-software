// AS-87 mutant battery. Each mutant: exact-string replacement anchored to its
// site (must be unique in the file), assert applied, run the named test files,
// collect the failing test names, restore with git checkout, prove clean.
const fs = require('fs');
const { spawnSync } = require('child_process');
const wt = '/Users/forrest/Code/american-software-company/.worktrees/AS-87';
const W = 'apps/chat/watch/advance-watcher.mjs';
const S = 'apps/chat/server.js';
const L = 'apps/chat/public/loop-status.js';
const T = {
  watcher: 'apps/chat/test/watcher.test.js',
  loop: 'apps/chat/test/watcher-loop.test.js',
  api: 'apps/chat/test/api.test.js',
  label: 'apps/chat/test/loop-label.test.js',
};
const mutants = [
  { id: 'M1', file: W, from: "      persist({ ...inflight, reason: 'deploying' });\n      return { action: 'noop', reason: 'busy' };", to: "      return { action: 'noop', reason: 'busy' };", tests: [T.watcher], predicted: ['AS-87 evaluate heartbeats'] },
  { id: 'M2', file: W, from: "      persist({ ...inflight, reason: 'deploying' });", to: "      persist({ reason: 'deploying' });", tests: [T.watcher], predicted: ['AS-87 evaluate heartbeats'] },
  { id: 'M3', file: W, from: "      persist({ ...inflight, reason: 'deploying' });\n      return { action: 'noop', reason: 'busy' };", to: "      persist({ ...inflight, reason: 'deploying' });\n      return { action: 'noop', reason: 'deploying' };", tests: [T.watcher, T.loop], predicted: ['AS-87 evaluate heartbeats', 'c-single-fire-deploy-yield and/or f2-poll-order (plan names these; zero from loop is a finding)'] },
  { id: 'M4', file: S, from: "  const reason = typeof deployState.reason === 'string' ? deployState.reason : 'unreadable-state';", to: "  const reason = typeof deployState.reason === 'string' && deployState.reason !== 'deploying' ? deployState.reason : 'unreadable-state';", tests: [T.api], predicted: ['api: AS-87 — composeBuild passes'] },
  { id: 'M5', file: L, from: "  deploying: 'the watcher is rebuilding it now — see apps/chat/data/logs/deploy-*.log',\n", to: "", tests: [T.label], predicted: ['AS-75 label: every build reason has prose', 'AS-87 label: "deploying"'] },
  { id: 'M6', file: W, from: "['compose', '--progress', 'plain', 'up', '-d', '--build']", to: "['compose', '--progress', 'quiet', 'up', '-d', '--build']", tests: [T.watcher], predicted: ['AS-87 runDockerCompose argv'] },
];
const only = process.argv.slice(2);
for (const m of mutants) {
  if (only.length && !only.includes(m.id)) continue;
  const p = `${wt}/${m.file}`;
  const orig = fs.readFileSync(p, 'utf8');
  const n = orig.split(m.from).length - 1;
  if (n !== 1) { console.log(`${m.id}: ANCHOR NOT UNIQUE (${n} hits) — not applied`); continue; }
  const mutated = orig.replace(m.from, m.to);
  fs.writeFileSync(p, mutated);
  // assert applied at the site: git diff shows exactly this file, and the new text is present / old absent
  const d = spawnSync('git', ['-C', wt, 'diff', '--stat', '--', m.file], { encoding: 'utf8' }).stdout.trim();
  const applied = fs.readFileSync(p, 'utf8').includes(m.to) && (m.to === '' || !fs.readFileSync(p, 'utf8').includes(m.from)) && d.includes(m.file.split('/').pop());
  let failing = [];
  if (applied) {
    const r = spawnSync('node', ['--test', ...m.tests], { cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = r.stdout + r.stderr;
    failing = out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \(\d+.*$/, ''));
    const m2 = out.match(/ℹ tests (\d+)[\s\S]*?ℹ fail (\d+)/);
    console.log(`${m.id} [${m.file.split('/').pop()}] applied=yes tests=${m2 ? m2[1] : '?'} fail=${m2 ? m2[2] : '?'}`);
  } else {
    console.log(`${m.id} applied=NO`);
  }
  fs.writeFileSync(p, orig);
  spawnSync('git', ['-C', wt, 'checkout', '--', m.file]);
  const clean = spawnSync('git', ['-C', wt, 'diff', '--exit-code', '--', m.file]).status === 0;
  console.log(`  predicted: ${m.predicted.join(' ; ')}`);
  console.log(`  observed red (${failing.length}): ${failing.join(' ; ') || '(none — SURVIVED)'}`);
  console.log(`  restored clean: ${clean}`);
}
