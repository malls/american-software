// f6-check-b.js — the third variant: delete the SANCTIONED entry but LEAVE the
// cardinality literal at 5 (the careless half-edit, as against the clean
// two-line removal f6-check.js (a) performs).
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const APP = process.argv[2];
const TEST = join(APP, 'test/dependency-policy.test.js');
const original = readFileSync(TEST, 'utf8');

function run(label) {
  const out = spawnSync('node', ['--test', 'test/dependency-policy.test.js'], { cwd: APP, encoding: 'utf8' });
  const text = out.stdout + out.stderr;
  const failed = [...new Set([...text.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))].filter((n) => !n.endsWith('.test.js'));
  const counts = Object.fromEntries([...text.matchAll(/^ℹ (tests|pass|fail) (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
  console.log(`\n${label}\n  tests ${counts.tests} | pass ${counts.pass} | fail ${counts.fail}`);
  for (const name of failed) console.log(`  RED: ${name}`);
}

const start = original.indexOf("  {\n    file: 'lib/telemetry/transport.js',");
const end = original.indexOf('\n  },', start) + '\n  },\n'.length;
const mutated = original.slice(0, start) + original.slice(end);
if (mutated.includes("file: 'lib/telemetry/transport.js'") || !mutated.includes('SANCTIONED.length, 5')) {
  throw new Error('mutation did NOT apply at the intended site');
}
writeFileSync(TEST, mutated);
console.log('asserted applied: entry gone, literal still 5');
run('(a-half) entry deleted, literal left at 5');
writeFileSync(TEST, original);
console.log('\nrestored:', readFileSync(TEST, 'utf8') === original);
