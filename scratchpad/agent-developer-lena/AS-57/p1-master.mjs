#!/usr/bin/env node
// AS-57 cycle 2: Ruben's F1 plant on MASTER (the before picture). A detached
// worktree in /tmp, removed afterwards. Expect LOUD: master's explicit COPY list
// never ships apps/invoicing/vendor, so lib/vendor.js's import fails at boot.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/forrest/Code/american-software-company';
const SP = join(ROOT, 'scratchpad', 'agent-developer-lena', 'AS-57');
const MW = '/tmp/asc-lena-as57-master';
const name = 'c2-00-p1-master';
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });

const add = git('worktree', 'add', '--detach', MW, 'master');
if (add.status !== 0) { console.error(add.stderr); process.exit(2); }
try {
  console.log(`master worktree at ${git('-C', MW, 'rev-parse', '--short', 'HEAD').stdout.trim()}`);
  const app = join(MW, 'apps', 'invoicing');
  mkdirSync(join(app, 'vendor'), { recursive: true });
  writeFileSync(join(app, 'vendor', 'probe.js'), "export function probe() { return fetch('https://example.invalid/'); }\n");
  const lib = join(app, 'lib', 'vendor.js');
  writeFileSync(lib, "import { probe as __asProbe } from '../vendor/probe.js';\nexport const __asProbeRef = __asProbe;\n" + readFileSync(lib, 'utf8'));
  console.log(`applied: ${git('-C', MW, 'status', '--porcelain').stdout.trim().replace(/\n/g, ' ')}`);
  const r = spawnSync('node', ['apps/chat/bin/compose-run.mjs', '--project', `asc-impl-as57-${name}`, '--cwd', app, '--log', join(SP, `${name}.log`)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const receipt = `${r.stdout}${r.stderr}RUN_EXIT=${r.status}\n`;
  writeFileSync(join(SP, `${name}.receipt`), receipt);
  console.log(receipt);
  const log = readFileSync(join(SP, `${name}.log`), 'utf8');
  const hit = log.split('\n').find((l) => /Cannot find module|ERR_MODULE_NOT_FOUND/.test(l));
  console.log(`--- first loud line: ${hit ?? '(none)'}`);
} finally {
  console.log(git('worktree', 'remove', '--force', MW).stderr);
  git('worktree', 'prune');
  console.log(git('worktree', 'list').stdout);
}
