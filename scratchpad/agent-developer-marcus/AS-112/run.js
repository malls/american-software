// Host runner: node run.js <cwd> [file...]  — runs `node --test` (spec reporter) from cwd,
// prints the summary counts, the ✖ (failing) test names, and any error message lines.
const { spawnSync } = require('node:child_process');
const [cwd, ...files] = process.argv.slice(2);
const r = spawnSync('node', ['--test', ...files], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = r.stdout + r.stderr;
const lines = out.split('\n');
const summary = lines.filter((l) => /^ℹ (tests|pass|fail|skipped|cancelled) /.test(l)).map((l) => l.replace('ℹ ', '')).join(' | ');
console.log('SUMMARY:', summary, '| exit', r.status, r.signal || '');
const reds = lines.filter((l) => /^\s*✖ /.test(l));
console.log('RED (' + reds.length + '):');
for (const l of reds) console.log('  ' + l.trim().replace(/\s*\([\d.]+ms\)$/, ''));
if (process.env.SHOW_ERR) {
  const idx = lines.findIndex((l) => /^\s*✖ /.test(l));
  if (idx !== -1) console.log(lines.slice(idx, idx + Number(process.env.SHOW_ERR)).join('\n'));
}
