// Counted compose receipt on the AS-48 worktree: node receipt.cjs <project> <service>
// Same shape as recipe.cjs's run/teardown/leak block, no mutation.
const { spawnSync } = require('child_process');
const fs = require('fs');
const DOCKER = '/usr/local/bin/docker';
const ROOT = '/Users/forrest/Code/american-software-company';
const app = `${ROOT}/.worktrees/AS-48/apps/invoicing`;
const [project, service] = process.argv.slice(2);
if (!project || !service) throw new Error('usage: node receipt.cjs <project> <service>');
const log = `${ROOT}/scratchpad/agent-developer-marcus/AS-48/${project}-${service}.log`;
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const runArgs = ['compose', '-p', project, 'run', '--rm', '--build', service];
console.log(`docker ${runArgs.join(' ')}`);
const r = spawnSync(DOCKER, runArgs, { encoding: 'utf8', cwd: app, env, maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout || '') + (r.stderr || '');
const d = spawnSync(DOCKER, ['compose', '-p', project, '--profile', 'tools', 'down', '-v', '--rmi', 'local', '--remove-orphans'], { encoding: 'utf8', cwd: app, env });
const nets = spawnSync(DOCKER, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}_`));
const imgs = spawnSync(DOCKER, ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}-`));
const ctrs = spawnSync(DOCKER, ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}-`));
fs.writeFileSync(log, out);
const built = out.split('\n').filter((l) => /Image .* Built/.test(l)).map((l) => l.trim());
const sum = (k) => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1];
console.log(`RECEIPT project=${project} service=${service}\n  built: ${built.join(' | ') || 'MISSING'}\n  tests=${sum('tests')} pass=${sum('pass')} fail=${sum('fail')} skipped=${sum('skipped')}\n  run exit=${r.status}\n  down exit=${d.status}\n  leak check: ${nets.length + imgs.length + ctrs.length ? 'LEAK ' + [...nets, ...imgs, ...ctrs].join(',') : 'clean'}`);
const failed = out.split('\n').filter((l) => /^✖/.test(l) && !/^✖ (failing tests:|test\/)/.test(l));
const seen = new Set();
for (const l of failed) seen.add(l.replace(/ \([0-9.]+ms\)$/, ''));
console.log(`RED SET (${seen.size}):`);
for (const l of seen) console.log('  ' + l);
