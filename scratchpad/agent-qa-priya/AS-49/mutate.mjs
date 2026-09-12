// usage: node mutate.mjs <name> <relative file under scratch/apps/invoicing> <anchor literal> <replacement>
// One indivisible step: back up, mutate, assert applied at the intended site
// (anchor count 1 before, 0 after; replacement count 0 before, 1 after),
// run the test service with --build, record reds, restore, assert restored.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [name, rel, anchor, replacement] = process.argv.slice(2);
const root = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-49';
const file = `${root}/scratch/apps/invoicing/${rel}`;
const original = readFileSync(file, 'utf8');
const count = (s, needle) => s.split(needle).length - 1;
const restore = () => { writeFileSync(file, original); };
process.on('exit', restore);

console.log(`[${name}] anchor count before: ${count(original, anchor)} (must be 1); replacement count before: ${count(original, replacement)}`);
if (count(original, anchor) !== 1) { console.log('ABORT: anchor not unique'); process.exit(2); }
const mutated = original.replace(anchor, replacement);
writeFileSync(file, mutated);
const after = readFileSync(file, 'utf8');
console.log(`[${name}] anchor count after: ${count(after, anchor)} (must be 0); replacement count after: ${count(after, replacement)} (must be ${count(original, replacement) + 1})`);
if (count(after, anchor) !== 0 || count(after, replacement) !== count(original, replacement) + 1) { console.log('ABORT: mutation did not apply at the intended site'); process.exit(3); }
// Show the mutated line with context so the site is on the record.
const idx = mutated.indexOf(replacement);
console.log(`[${name}] site: line ${mutated.slice(0, idx).split('\n').length}: ${mutated.slice(idx, idx + 120).split('\n')[0]}`);

const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
const project = `asc-review-as49-priya-mut-${name.toLowerCase()}`;
const compose = `${root}/scratch/apps/invoicing/compose.yaml`;
const r = spawnSync('/usr/local/bin/docker', ['compose', '-p', project, '-f', compose, 'run', '--rm', '--build', 'test'], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = (r.stdout ?? '') + (r.stderr ?? '');
writeFileSync(`${root}/mut-${name}.test.log`, out);
const lines = out.split('\n');
console.log('BUILT:', lines.filter((l) => /Image .* Built/.test(l)).join(' | ') || 'NONE');
console.log(lines.filter((l) => /^(# |ℹ )(tests|pass|fail|skipped) /.test(l)).join('\n'));
console.log('RED SET:');
for (const l of lines.filter((l) => /^✖ /.test(l))) console.log('  ' + l.replace(/ \([0-9.]+ms\).*$/, ''));
console.log('EXIT:', r.status);
const d = spawnSync('/usr/local/bin/docker', ['compose', '-p', project, '-f', compose, '--profile', 'tools', 'down', '-v', '--rmi', 'local'], { env, encoding: 'utf8' });
console.log('DOWN EXIT:', d.status);
restore();
console.log(`[${name}] restored: ${readFileSync(file, 'utf8') === original}`);
