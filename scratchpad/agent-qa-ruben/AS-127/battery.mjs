// Run one or more mutants end to end: mutate (assert-applied) then a counted full-suite run.
//   node battery.mjs F6 F19 ...
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const HERE = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-127';
for (const name of process.argv.slice(2)) {
  const m = spawnSync('node', [`${HERE}/mutate.mjs`, name], { encoding: 'utf8' });
  let out = `\n===== ${name} =====\n${m.stdout}${m.stderr}`;
  if (m.status !== 0) { out += `mutate exit ${m.status} — SKIPPED RUN\n`; console.log(out); appendFileSync(`${HERE}/battery.log`, out); continue; }
  const proj = `asc-review-as127-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const r = spawnSync('node', [`${HERE}/run.mjs`, '--project', proj, '--cwd', `/tmp/rq-as127/${name}/apps/invoicing`, '--log', `${HERE}/mut-${name}.log`], { encoding: 'utf8' });
  out += `${r.stdout}${r.stderr}run.mjs exit ${r.status}\n`;
  console.log(out);
  appendFileSync(`${HERE}/battery.log`, out);
}
