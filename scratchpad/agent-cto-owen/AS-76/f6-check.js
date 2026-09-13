// f6-check.js — does F6, as rewritten in review cycle 1, name the red set it
// actually produces? Two directions, run against the scratch copy that already
// has the corrected T-A applied and green.
//
//   (a) delete a new SANCTIONED entry      -> claimed: cardinality + outbound-client test
//   (b) keep the entry, rewrite its line   -> claimed: the stale-entry arm only
//
// Each mutation is asserted to have applied at the intended site before the
// suite is run, and the file is restored from the in-memory original after.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const APP = process.argv[2];
const TEST = join(APP, 'test/dependency-policy.test.js');
const TRANSPORT = join(APP, 'lib/telemetry/transport.js');
const original = { test: readFileSync(TEST, 'utf8'), transport: readFileSync(TRANSPORT, 'utf8') };

function run(label) {
  const out = spawnSync('node', ['--test', 'test/dependency-policy.test.js'], { cwd: APP, encoding: 'utf8' });
  const text = out.stdout + out.stderr;
  const failed = [...text.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]).filter((n) => !n.endsWith('.test.js'));
  const counts = Object.fromEntries(
    [...text.matchAll(/^ℹ (tests|pass|fail) (\d+)$/gm)].map((m) => [m[1], Number(m[2])]),
  );
  console.log(`\n${label}\n  tests ${counts.tests} | pass ${counts.pass} | fail ${counts.fail}`);
  for (const name of failed) console.log(`  RED: ${name}`);
  return failed;
}

run('BASELINE (corrected T-A applied)');

// (a) delete the lib/telemetry/transport.js entry.
{
  const start = original.test.indexOf("  {\n    file: 'lib/telemetry/transport.js',");
  const end = original.test.indexOf('\n  },', start) + '\n  },\n'.length;
  if (start < 0 || end < start) throw new Error('(a) mutation site not found');
  const mutated = (original.test.slice(0, start) + original.test.slice(end))
    .replace('assert.equal(SANCTIONED.length, 5', 'assert.equal(SANCTIONED.length, 4');
  if (mutated.includes("file: 'lib/telemetry/transport.js'")) throw new Error('(a) mutation did NOT apply');
  writeFileSync(TEST, mutated);
  console.log('\n(a) asserted applied: telemetry transport entry gone, literal 5 -> 4');
  run('(a) delete the entry — F6 claims TWO reds: cardinality AND the outbound-client test');
  writeFileSync(TEST, original.test);
}

// (b) keep the entry, rewrite the line it pins.
{
  const mutated = original.transport.replace(
    '  const response = await fetch(url, init);',
    '  const response = await fetch(url, { ...init });',
  );
  if (mutated === original.transport) throw new Error('(b) mutation did NOT apply');
  writeFileSync(TRANSPORT, mutated);
  console.log('\n(b) asserted applied: pinned line rewritten, entry untouched');
  run('(b) rewrite the pinned line — F6 claims ONE red: the stale-entry arm');
  writeFileSync(TRANSPORT, original.transport);
}

console.log('\nrestored:',
  readFileSync(TEST, 'utf8') === original.test && readFileSync(TRANSPORT, 'utf8') === original.transport);
run('RESTORED');
