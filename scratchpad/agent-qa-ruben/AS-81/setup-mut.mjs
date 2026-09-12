// AS-81 review: build scratch copies and apply/assert the mutations. Never touches the worktree.
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = '/Users/forrest/Code/american-software-company';
const SP = `${ROOT}/scratchpad/agent-qa-ruben/AS-81`;
const WT = `${ROOT}/.worktrees/AS-81/apps/chat`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const count = (file, needle) => readFileSync(file, 'utf8').split(needle).length - 1;

const before = {
  server: sha(readFileSync(`${WT}/server.js`)),
  test: sha(readFileSync(`${WT}/test/stream.test.js`)),
};
writeFileSync(`${SP}/hashes-before.json`, JSON.stringify(before, null, 2));
console.log('worktree hashes before', before);

for (const d of ['mut', 'ctl', 'ac4']) {
  rmSync(`${SP}/${d}`, { recursive: true, force: true });
  mkdirSync(`${SP}/${d}`, { recursive: true });
  cpSync(WT, `${SP}/${d}`, { recursive: true });
  rmSync(`${SP}/${d}/data`, { recursive: true, force: true });
  console.log(d, 'data/ present after copy?', existsSync(`${SP}/${d}/data`), 'node_modules?', existsSync(`${SP}/${d}/node_modules`));
}

// ctl = master's harness against the same mutated server
const masterTest = execFileSync('git', ['-C', ROOT, 'show', 'master:apps/chat/test/stream.test.js']);
writeFileSync(`${SP}/ctl/test/stream.test.js`, masterTest);
console.log('ctl harness sha == master sha:', sha(readFileSync(`${SP}/ctl/test/stream.test.js`)) === sha(masterTest));
console.log('ctl harness differs from branch harness:', sha(masterTest) !== before.test);

// AC-1 mutation on mut and ctl: delete both on-connect res.write lines
for (const d of ['mut', 'ctl']) {
  const p = `${SP}/${d}/server.js`;
  const pre = { loop: count(p, 'readLoopStatus())}'), lanes: count(p, 'readLanes() })}') };
  const lines = readFileSync(p, 'utf8').split('\n');
  const hit = [];
  const kept = lines.filter((l, i) => {
    const m = l.includes('readLoopStatus())}') || l.includes('readLanes() })}');
    if (m) hit.push(`${i + 1}: ${l.trim()}`);
    return !m;
  });
  writeFileSync(p, kept.join('\n'));
  const post = { loop: count(p, 'readLoopStatus())}'), lanes: count(p, 'readLanes() })}') };
  console.log(`${d} AC-1 mutation: counts before`, pre, 'after', post, 'removed lines:', hit);
  // context: show 6 lines above the first removed line in the ORIGINAL to prove it is the /api/stream handler
  const first = parseInt(hit[0], 10);
  console.log(`${d} context (original lines ${first - 8}..${first + 2}):`);
  console.log(lines.slice(first - 9, first + 2).map((l, i) => `${first - 8 + i}: ${l}`).join('\n'));
}

// AC-4 mutation on ac4: delete ctrl.abort() from openStream's catch only
{
  const p = `${SP}/ac4/test/stream.test.js`;
  const pre = count(p, 'ctrl.abort()');
  let s = readFileSync(p, 'utf8');
  const needle = '      ctrl.abort();\n      throw e;';
  const n = s.split(needle).length - 1;
  console.log('ac4 needle occurrences (expect 1):', n);
  s = s.replace(needle, '      throw e;');
  writeFileSync(p, s);
  const post = count(p, 'ctrl.abort()');
  const surviving = s.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => l.includes('ctrl.abort()'));
  console.log('ac4 ctrl.abort() count before', pre, 'after', post, 'surviving:', surviving);
}
console.log(new Date().toISOString());
