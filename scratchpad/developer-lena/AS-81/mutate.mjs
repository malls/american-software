// AS-81 mutation driver. Every mutation is anchored to a site that can only
// match once, and the script REFUSES unless the match count is exactly what it
// expects — an unapplied mutation looks identical to a surviving guard, and a
// mutation that lands at the wrong site looks identical to both.
// usage: node mutate.mjs <appRoot> <mutation>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [root, name] = process.argv.slice(2);
if (!root || !name) throw new Error('usage: node mutate.mjs <appRoot> <mutation>');

/** Drop whole lines matching `pred`, requiring exactly `expect` of them, and
 *  report the line numbers so the site is on the record, not just the count. */
function dropLines(file, pred, expect, label) {
  const path = join(root, file);
  const src = readFileSync(path, 'utf8');
  const lines = src.split('\n');
  const hits = lines.map((l, i) => [i + 1, l]).filter(([, l]) => pred(l));
  if (hits.length !== expect) {
    throw new Error(`${label}: expected ${expect} site(s), found ${hits.length} — mutation NOT applied`);
  }
  const kept = lines.filter((l) => !pred(l));
  writeFileSync(path, kept.join('\n'));
  const after = readFileSync(path, 'utf8').split('\n').filter(pred).length;
  if (after !== 0) throw new Error(`${label}: site survived the rewrite`);
  console.log(`${label}: removed ${hits.length} line(s) at ${hits.map(([n]) => n).join(',')} in ${file}`);
  for (const [n, l] of hits) console.log(`    ${n}: ${l.trim()}`);
}

const mutations = {
  // server.js: the AS-27 on-connect loop write, inside the /api/stream try.
  // Anchored on the full call, not a bare res.write — there are others.
  'drop-loop-write': () => dropLines(
    'server.js',
    (l) => l.includes('res.write(`event: loop\\ndata: ${JSON.stringify(readLoopStatus())}'),
    1, 'M-loop'
  ),
  // server.js: the AS-99 on-connect lanes write, its sibling.
  'drop-lanes-write': () => dropLines(
    'server.js',
    (l) => l.includes('res.write(`event: lanes\\ndata: ${JSON.stringify({ lanes: readLanes() })}'),
    1, 'M-lanes'
  ),
  // stream.test.js: the AS-81 abort in openStream's catch. Anchored on the bare
  // statement form so it cannot match the `close: () => ctrl.abort(),` property.
  'drop-abort': () => dropLines(
    'test/stream.test.js',
    (l) => l.trim() === 'ctrl.abort();',
    1, 'M-abort'
  ),
  // stream.test.js: the §3B guarded after-hooks in the two server-owning tests.
  'drop-guard-hooks': () => dropLines(
    'test/stream.test.js',
    (l) => l.trim() === 'let closedByTest = false;'
      || l.trim() === 't.after(async () => { if (!closedByTest) await close(); });'
      || l.trim() === 'closedByTest = true;',
    6, 'M-hooks'
  ),
};

if (!mutations[name]) throw new Error(`unknown mutation ${name}`);
mutations[name]();

// Report the surviving population at each anchor, so the report can say which
// occurrence went and which stayed rather than just "a line was removed".
const target = name.includes('loop-write') || name.includes('lanes-write')
  ? 'server.js' : 'test/stream.test.js';
const check = readFileSync(join(root, target), 'utf8');
console.log(`  ${target} after mutation: ${check.split('\n').length} lines`
  + `, ctrl.abort() sites=${(check.match(/ctrl\.abort\(\)/g) || []).length}`
  + `, closedByTest sites=${(check.match(/closedByTest/g) || []).length}`
  + `, on-connect res.write sites=${(check.match(/res\.write\(`event: /g) || []).length}`);
