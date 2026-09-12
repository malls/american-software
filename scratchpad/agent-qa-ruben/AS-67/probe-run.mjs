// Run the route probe (zz-ruben-probe.test.js) inside a scratch copy of the
// worktree, in the compose image. The worktree is not touched.
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DOCKER = '/usr/local/bin/docker';
const ROOT = '/Users/forrest/Code/american-software-company';
const WT = join(ROOT, '.worktrees/AS-67');
const HERE = join(ROOT, 'scratchpad/agent-qa-ruben/AS-67');
const SCRATCH = join(HERE, 'scratch-root');
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
cpSync(join(WT, 'apps/invoicing'), join(SCRATCH, 'apps/invoicing'), { recursive: true });
cpSync(join(WT, 'docs/design/tokens'), join(SCRATCH, 'docs/design/tokens'), { recursive: true });
cpSync(join(WT, '.dockerignore'), join(SCRATCH, '.dockerignore'));
cpSync(join(HERE, 'zz-ruben-probe.test.js'), join(SCRATCH, 'apps/invoicing/test/zz-ruben-probe.test.js'));

const r = spawnSync(DOCKER, ['compose', '-p', 'asc-review-as67', 'run', '--rm', '--build', 'test', 'node', '--test', 'test/zz-ruben-probe.test.js'],
  { cwd: join(SCRATCH, 'apps/invoicing'), env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n--- exit ${r.status} ---\n`;
writeFileSync(join(HERE, 'compose-probe.log'), out);
console.log(out.split('\n').filter((l) => /PROBE|Built|✖|✔|--- exit|Error/.test(l)).join('\n'));
rmSync(SCRATCH, { recursive: true, force: true });
