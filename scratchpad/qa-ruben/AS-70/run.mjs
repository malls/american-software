#!/usr/bin/env node
// qa-ruben AS-70 review runner. Usage:
//   node run.mjs <project> <cwd> <logname> -- <compose args...>
// Runs /usr/local/bin/docker compose -p <project> <args> in <cwd>, logs full
// output to scratchpad/qa-ruben/AS-70/<logname>.log, prints Built lines, the
// node test-runner summary, and exit status. Docker is off PATH in ticks.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DOCKER = '/usr/local/bin/docker';
const [project, cwd, logname, dashdash, ...args] = process.argv.slice(2);
if (!project || !cwd || !logname || dashdash !== '--') {
  console.error('usage: run.mjs <project> <cwd> <logname> -- <compose args...>');
  process.exit(2);
}
if (!project.startsWith('asc-rev-as70-')) { console.error('project must start with asc-rev-as70-'); process.exit(2); }
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const r = spawnSync(DOCKER, ['compose', '-p', project, ...args], { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const out = `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}`;
const log = `/Users/forrest/Code/american-software-company/scratchpad/qa-ruben/AS-70/${logname}.log`;
writeFileSync(log, out);
const built = out.split('\n').filter((l) => /Built\s*$/.test(l) || /\bBuilt\b/.test(l) && /Image/.test(l));
const summary = out.split('\n').filter((l) => /^ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(l.trim()) || /^# (tests|pass|fail|skipped|todo|cancelled)/.test(l.trim()));
const failing = out.split('\n').filter((l) => /^not ok|✖/.test(l.trim()));
console.log(`project=${project} exit=${r.status} log=${log}`);
console.log('BUILT:', built.length ? built.map((l) => l.trim()).join(' | ') : '(none)');
console.log('SUMMARY:', summary.map((l) => l.trim()).join(' '));
if (failing.length) console.log('FAILING:\n' + failing.map((l) => '  ' + l.trim()).join('\n'));
process.exit(r.status ?? 1);
