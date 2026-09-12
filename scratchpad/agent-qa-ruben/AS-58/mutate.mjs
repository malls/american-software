// mutate.mjs — one indivisible mutant step: back up OUTSIDE the scanned tree,
// apply, ASSERT THE MUTATION APPLIED at the intended site (re-read from disk and
// print the mutated hunk), run the suite with --build, record the red set,
// restore under a trap, prove the tree clean, and leave the rebuild to the
// caller's final run.
//
// Usage: node mutate.mjs <F1|F2|F3|F4>
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-58';
const COMPOSE = `${WT}/apps/invoicing/compose.yaml`;
const BACKUP = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-58/backup';
const PROJ = 'asc-ruben-as58';

const MUTANTS = {
  F1: {
    file: 'apps/invoicing/lib/stripe/client.js',
    what: "buildUnsigned sets a user-agent of its own",
    from: "function buildUnsigned({ base, apiVersion }, call) {\n  const url = new URL(call.path, base);\n  const headers = { accept: 'application/json', 'stripe-version': apiVersion };",
    to: "function buildUnsigned({ base, apiVersion }, call) {\n  const url = new URL(call.path, base);\n  const headers = { accept: 'application/json', 'stripe-version': apiVersion, 'user-agent': 'asc' };",
    expect: "'user-agent': 'asc'",
  },
  F2: {
    file: 'apps/invoicing/lib/config.js',
    what: "redacted() emits [redacted] even for an UNSET secret",
    from: "for (const row of schema) out[row.key] = row.secret && resolved[row.key] !== null ? '[redacted]' : resolved[row.key];",
    to: "for (const row of schema) out[row.key] = row.secret ? '[redacted]' : resolved[row.key];",
    expect: "out[row.key] = row.secret ? '[redacted]'",
  },
  F3: {
    file: 'apps/invoicing/lib/stripe/custody.js',
    what: "the guard's separator set reverted to & only",
    from: 'const PAIR_SEPARATOR = /[&;]/g;',
    to: 'const PAIR_SEPARATOR = /[&]/g;',
    expect: 'const PAIR_SEPARATOR = /[&]/g;',
  },
  F4: {
    file: 'apps/invoicing/routes/health.js',
    what: "the dropped config object restored to the /healthz body",
    from: 'res.status(result.ok ? 200 : 503).json({ ok: result.ok, checks: result.checks });',
    to: 'res.status(result.ok ? 200 : 503).json({ ok: result.ok, checks: result.checks, config: config.redacted?.() ?? null });',
    expect: 'config: config.redacted?.() ?? null',
  },
};

const id = process.argv[2];
const m = MUTANTS[id];
if (!m) throw new Error(`unknown mutant ${id}`);

const path = `${WT}/${m.file}`;
const backup = `${BACKUP}/${id}-${m.file.replaceAll('/', '_')}.bak`;
copyFileSync(path, backup);

function restore() {
  copyFileSync(backup, path);
  const d = spawnSync('/usr/bin/git', ['-C', WT, 'diff', '--exit-code'], { encoding: 'utf8' });
  console.log(`[${id}] restored; git diff --exit-code => ${d.status === 0 ? 'CLEAN' : 'DIRTY\n' + d.stdout}`);
  const s = spawnSync('/usr/bin/git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' });
  console.log(`[${id}] git status --porcelain => ${JSON.stringify(s.stdout)}`);
}
process.on('exit', restore);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const before = readFileSync(path, 'utf8');
const hits = before.split(m.from).length - 1;
console.log(`[${id}] ${m.file}: anchor occurrences = ${hits}`);
if (hits !== 1) throw new Error(`anchor is not unique (${hits}) — refusing to mutate`);
writeFileSync(path, before.replace(m.from, m.to), 'utf8');

// ASSERT THE MUTATION APPLIED, by re-reading from disk and showing the site.
const after = readFileSync(path, 'utf8');
if (!after.includes(m.expect)) throw new Error(`mutation did NOT apply: ${m.expect} absent after write`);
const diff = spawnSync('/usr/bin/git', ['-C', WT, 'diff', '--', m.file], { encoding: 'utf8' });
console.log(`[${id}] MUTATION APPLIED — ${m.what}\n${diff.stdout}`);
if (diff.stdout.trim() === '') throw new Error('git sees no change — mutation did not reach the intended site');

const r = spawnSync(DOCKER, ['compose', '-p', PROJ, '-f', COMPOSE, 'run', '--rm', '--build', 'test'], {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
  env: { ...process.env, DOCKER_BUILDKIT: '0', COMPOSE_DOCKER_CLI_BUILD: '0' },
});
const out = (r.stdout || '') + (r.stderr || '');
writeFileSync(`${BACKUP}/../${id}-suite.log`, out, 'utf8');

const receipts = out.split('\n').filter((l) => /Image .* Built/.test(l));
const failLines = out.split('\n').filter((l) => /^✖/.test(l));
const counts = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped|cancelled)/.test(l));
console.log(`[${id}] build receipts: ${receipts.length} -> ${JSON.stringify(receipts.map((s) => s.trim()))}`);
console.log(`[${id}] counts:\n${counts.join('\n')}`);
console.log(`[${id}] RED SET (${failLines.length}):`);
for (const l of failLines) console.log('   ' + l.replace(/\s*\([\d.]+ms\)\s*$/, '').trim());
console.log(`[${id}] suite exit=${r.status}`);
