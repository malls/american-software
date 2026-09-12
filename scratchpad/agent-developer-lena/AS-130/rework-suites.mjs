// AS-130 rework cycle 1 — counted `test` + `contract` runs with --build receipts
// (AC-7), the AC-7 surface diff, and AC-1 (build.mjs on the committed record +
// cmp against the committed index.html). Logs: rework-suite-{test,contract}.log,
// rework-build.log; summary: rework-suites.out
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company';
const W = `${ROOT}/.worktrees/AS-130`;
const S = `${ROOT}/scratchpad/agent-developer-lena/AS-130`;
const DK = `${S}/dk.mjs`;
const P = 'asc-rework-as130-suite';
const lines = [];
const say = (t) => { lines.push(t); console.log(t); };

const compose = (name, ...args) => {
  const r = spawnSync('node', [DK, '--log', `${S}/${name}.log`, '--cwd', `${W}/apps/invoicing`, '--env', 'DOCKER_BUILDKIT=1', '--env', 'COMPOSE_DOCKER_CLI_BUILD=1', '--',
    'compose', '-p', P, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout;
  const built = (out.match(/Image (\S+) +Built/) ?? [null, null])[1];
  const n = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) ?? [0, NaN])[1]);
  const failing = [...out.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  say(`${name}: exit ${r.status}; Image ${built} Built; tests ${n('tests')} pass ${n('pass')} fail ${n('fail')} skipped ${n('skipped')}${failing.length ? `\n  not ok: ${failing.join(' | ')}` : ''}`);
};

compose('rework-suite-test', 'run', '--rm', '--build', 'test');
compose('rework-suite-contract', 'run', '--rm', '--build', 'contract');
spawnSync('node', [DK, '--log', `${S}/rework-suite-teardown.log`, '--cwd', `${W}/apps/invoicing`, '--', 'compose', '--profile', 'tools', '-p', P, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { encoding: 'utf8' });
const left = spawnSync('node', [DK, '--', 'ps', '-a', '--filter', `name=${P}`, '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l && !l.startsWith('$') && !l.startsWith('[exit'));
say(`suite project torn down; containers left: ${left.length}`);

// AC-7 surface diff
const surfaces = ['apps/invoicing/test', 'apps/invoicing/lib', 'apps/invoicing/routes', 'apps/invoicing/views', 'apps/invoicing/public', 'apps/invoicing/compose.yaml', 'apps/invoicing/Dockerfile', 'apps/invoicing/package.json', 'apps/invoicing/package-lock.json'];
const d = spawnSync('git', ['-C', W, 'diff', 'master', '--stat', '--', ...surfaces], { encoding: 'utf8' });
say(`AC-7 git diff master --stat on the protected surfaces: ${d.stdout.trim() === '' ? 'empty' : 'NOT EMPTY\n' + d.stdout}`);

// AC-1 build on the committed record
const out = `${S}/rework-build`;
mkdirSync(out, { recursive: true });
const b = spawnSync('node', [`${W}/.claude/skills/d1-demo-artifact/build.mjs`, W, `${out}/d1-demo.html`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
writeFileSync(`${S}/rework-build.log`, b.stdout + b.stderr);
say(`AC-1 build.mjs exit ${b.status}: ${b.stdout.trim().split('\n').filter((l) => /digest|headers|of 34|screen headings|screens/.test(l)).join(' | ')}`);
const c = spawnSync('cmp', [`${out}/d1-demo.html`, `${W}/docs/demo/d1/index.html`], { encoding: 'utf8' });
say(`AC-1 cmp fresh build vs committed index.html: ${c.status === 0 ? 'byte-identical' : 'DIFFERS ' + c.stdout + c.stderr}`);

writeFileSync(`${S}/rework-suites.out`, lines.join('\n') + '\n');
