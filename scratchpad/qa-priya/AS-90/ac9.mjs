// AC-9 reds: (a) Dockerfile without the demo COPY → deploy-shape red;
// (b) lib/health.js importing from demo/ → dependency-policy import guard red.
// Scratch copies bind-mounted over the image's files; worktree untouched.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-90/apps/invoicing';
const DIR = '/Users/forrest/Code/american-software-company/scratchpad/qa-priya/AS-90/mut';
mkdirSync(DIR, { recursive: true });

function run(label, mounts, testFile) {
  const args = ['compose', '-p', 'asc-rev-as90-mut', 'run', '--rm', '--build'];
  for (const [host, cont] of mounts) args.push('-v', `${host}:${cont}:ro`);
  args.push('test', 'node', '--test', testFile);
  const r = spawnSync('/usr/local/bin/docker', args, { cwd: WT, env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(`${DIR}/${label}.log`, `${r.stdout}\n--- stderr ---\n${r.stderr}\nexit=${r.status}\n`);
  const built = /Image \S+ Built/.exec(r.stderr)?.[0] ?? '(no Built line)';
  const summary = r.stdout.split('\n').filter((l) => /^ℹ (tests|pass|fail)/.test(l)).join(' ');
  const failing = r.stdout.split('\n').filter((l) => /^not ok/.test(l));
  const reasons = r.stdout.split('\n').filter((l) => /^\s+(error|expected|actual):|AssertionError|app source imports from demo/.test(l)).slice(0, 6);
  console.log(`===== ${label}: exit=${r.status}; ${built}; ${summary}\n  failing: ${failing.length ? failing.join(' | ') : '(none)'}\n${reasons.map((l) => `  ${l.trim()}`).join('\n')}`);
}

// (a) Dockerfile minus the demo COPY line
const dockerfile = readFileSync(`${WT}/Dockerfile`, 'utf8');
const copyLine = 'COPY apps/invoicing/demo ./demo\n';
if (dockerfile.split(copyLine).length !== 2) throw new Error('COPY demo line not found exactly once');
const dfMut = dockerfile.replace(copyLine, '');
if (dfMut === dockerfile) throw new Error('Dockerfile mutation did not apply');
writeFileSync(`${DIR}/Dockerfile.no-demo-copy`, dfMut);
console.log(`Dockerfile mutant: ${dockerfile.split('\n').length} → ${dfMut.split('\n').length} lines; COPY count ${(dfMut.match(/^COPY /gm) ?? []).length} (shipped: ${(dockerfile.match(/^COPY /gm) ?? []).length})`);
run('ac9a-no-demo-copy', [[`${DIR}/Dockerfile.no-demo-copy`, '/app/Dockerfile']], 'test/deploy-shape.test.js');

// (b) lib/health.js importing from demo/
const health = readFileSync(`${WT}/lib/health.js`, 'utf8');
// A static import would EXECUTE run.mjs's BOOT region at load (helpers/server.js →
// app.js → lib/health.js) and process.exit(2) before the guard runs — observed in
// the first attempt (mut/ac9b-demo-import.log). A never-evaluated dynamic import
// is the same specifier shape the guard matches, without the side effect.
const healthMut = `${health}\nexport const __reviewerMutant = () => import('../demo/run.mjs');\n`;
writeFileSync(`${DIR}/health.demo-import.js`, healthMut);
console.log(`health.js mutant: last line now ${JSON.stringify(healthMut.trimEnd().split('\n').pop())}`);
run('ac9b-demo-import-dynamic', [[`${DIR}/health.demo-import.js`, '/app/lib/health.js']], 'test/dependency-policy.test.js');
