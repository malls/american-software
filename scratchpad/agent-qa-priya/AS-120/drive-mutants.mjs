// AS-120 review (qa-priya): for each mutant id: clean scratch worktree, apply (mutate.mjs asserts site),
// compose run --build (own project), record Built/totals/not-ok, then ALWAYS tear down the project.
import { spawnSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
const SP = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-120';
const SW = '/Users/forrest/Code/american-software-company/.worktrees/AS-120-mutant';
const DIR = `${SW}/apps/chat`;
const ids = process.argv.slice(2);
const summary = `${SP}/mutant-summary.txt`;
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
function docker(args) { return spawnSync('/usr/local/bin/docker', args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
for (const id of ids) {
  const proj = `asc-review-as120-${id.toLowerCase()}`;
  const m = spawnSync('node', [`${SP}/mutate.mjs`, id], { encoding: 'utf8' });
  const applied = (m.stdout || '') + (m.stderr || '');
  if (m.status !== 0) { appendFileSync(summary, `\n## ${id}\nNOT APPLIED — skipped\n${applied}\n`); continue; }
  const r = docker(['compose', '-f', `${DIR}/compose.yaml`, '--project-directory', DIR, '-p', proj,
    'run', '--build', '--rm', 'test', 'node', '--test', '--test-reporter=tap']);
  const out = (r.stdout || '') + (r.stderr || '');
  const log = `${SP}/${proj}-${Date.now()}.log`;
  writeFileSync(log, out);
  const lines = out.split('\n');
  const built = lines.filter((l) => /Built/.test(l)).map((l) => l.trim());
  const totals = lines.filter((l) => /^# (tests|pass|fail|skipped|cancelled) /.test(l)).map((l) => l.trim());
  const notok = lines.filter((l) => /^\s*not ok/.test(l)).map((l) => l.trim());
  const errs = lines.filter((l) => /^\s*error: /.test(l) || /^\s*(12 files examined|expected:|actual:)/.test(l)).map((l) => l.trim()).slice(0, 10);
  const d = docker(['compose', '-f', `${DIR}/compose.yaml`, '--project-directory', DIR, '-p', proj, 'down', '-v', '--rmi', 'local', '--remove-orphans']);
  const net = docker(['network', 'ls', '--format', '{{.Name}}']).stdout.split('\n').filter((n) => n.includes(proj));
  appendFileSync(summary, `\n## ${id} (project ${proj})\napplied: ${applied.trim()}\nBuilt: ${built.join(' | ') || 'NONE'}\ntotals: ${totals.join(' ')}\nexit=${r.status}\nnot ok:\n  ${notok.join('\n  ') || '(none)'}\nerrs:\n  ${errs.join('\n  ')}\nteardown exit=${d.status}; leftover networks for project: ${net.length ? net.join(',') : 'none'}\nlog=${log}\n`);
  console.log(`${id}: ${totals.join(' ')} built=${built.length} notok=${notok.length} teardown=${d.status}`);
}
// leave the scratch tree clean
spawnSync('git', ['-C', SW, 'checkout', '--', '.']);
console.log('done');
