// AS-82 QA cold mutation battery (Ruben). Scratch copy only; never touches the worktree.
import { cpSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-82';
const SCR = '/tmp/as82-mut-qa';
const REL = 'apps/chat/watch/advance-watcher.mjs';
const WTF = `${WT}/${REL}`;
const SCF = `${SCR}/${REL}`;
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

rmSync(SCR, { recursive: true, force: true });
cpSync(WT, SCR, { recursive: true });
rmSync(`${SCR}/.git`, { force: true }); // linked worktree's .git is a FILE
if (existsSync(`${SCR}/.git`)) throw new Error('.git still present in scratch');
const HASH_BEFORE = sha(WTF);
console.log('HASH_BEFORE', HASH_BEFORE);
if (sha(SCF) !== HASH_BEFORE) throw new Error('scratch copy differs from worktree');

function span(src, fnHeader) {
  const lines = src.split('\n');
  const s = lines.findIndex((l) => l.includes(fnHeader));
  if (s < 0) throw new Error('no header ' + fnHeader);
  const indent = lines[s].match(/^\s*/)[0];
  let e = s + 1;
  while (!(lines[e].startsWith(indent + '}') && lines[e].trim() === '}')) e++;
  return { s, e, lines };
}

// each mutation: { name, fn (enclosing function header), pattern, replace, predicted }
const MUTS = [
  { name: 'M1 delete heartbeat call in poll()', fn: '  function poll() {', pattern: /writeWatcherPid\(\{/g, replace: 'void ({', predicted: '{2,10}' },
  { name: 'M3 acquireLock condition -> false in fire()', fn: '  function fire(sentinel) {', pattern: /if \(!acquireLock\(nonce, \{ loop: \{ ticks: loopOps\.nextTick\(\) \} \}\)\) \{/g, replace: 'if (false) {', predicted: '{3,7}' },
  { name: 'M6 delete highwater write+rename in fire()', fn: '  function fire(sentinel) {', pattern: /    writeFileSync\(\n      paths\.highwater \+ '\.tmp',\n      JSON\.stringify\(\{ messageId: sentinel\.messageId, firedAt: new Date\(now\(\)\)\.toISOString\(\) \}\)\n    \);\n    renameSync\(paths\.highwater \+ '\.tmp', paths\.highwater\);\n/g, replace: '', predicted: '{3} or {2,3}' },
  { name: 'M9 swap tickEnded/loop.settle in settle()', fn: '    function settle(code = null, signal = null) {', pattern: /      eventsOps\.tickEnded\(\{ code, signal, timedOut, headBefore, headAfter \}\);\n      loopOps\.settle\(\{ code, signal, timedOut, headBefore, headAfter \}\);\n/g, replace: '      loopOps.settle({ code, signal, timedOut, headBefore, headAfter });\n      eventsOps.tickEnded({ code, signal, timedOut, headBefore, headAfter });\n', predicted: '{5}' },
  { name: 'M8 delete unlinkSync(paths.pid) in shutdown()', fn: '  function shutdown(signal) {', pattern: /      unlinkSync\(paths\.pid\);\n/g, replace: '', predicted: '{8,10}' },
  { name: 'M2 heartbeat moved below the child gate in poll()', fn: '  function poll() {', pattern: /    try \{\n      writeWatcherPid\(\{\n        path: paths\.pid,\n        pid,\n        startedAt: watcherStartedAt,\n        now: new Date\(now\(\)\)\.toISOString\(\),\n      \}\);\n    \} catch \{\n      \/\* heartbeat is best-effort; the indicator degrades, the watcher does not \*\/\n    \}\n    if \(child\) return; \/\/ our own tick is running; its lock covers this window\n/g, replace: '    if (child) return;\n    try {\n      writeWatcherPid({\n        path: paths.pid,\n        pid,\n        startedAt: watcherStartedAt,\n        now: new Date(now()).toISOString(),\n      });\n    } catch {\n      /* heartbeat is best-effort */\n    }\n', predicted: '{2}' },
];

const only = process.argv.slice(2);
for (const m of MUTS) {
  if (only.length && !only.some((o) => m.name.startsWith(o))) continue;
  const src = readFileSync(SCF, 'utf8');
  if (sha(SCF) !== HASH_BEFORE) throw new Error('scratch not pristine before ' + m.name);
  const { s, e, lines } = span(src, m.fn);
  const body = lines.slice(s, e + 1).join('\n');
  const hits = body.match(m.pattern) ?? [];
  if (hits.length !== 1) throw new Error(`${m.name}: expected 1 hit inside ${m.fn.trim()} (lines ${s + 1}-${e + 1}), got ${hits.length}`);
  const idx = body.search(m.pattern);
  const editLine = s + 1 + body.slice(0, idx).split('\n').length - 1;
  const mutatedBody = body.replace(m.pattern, m.replace);
  if (mutatedBody === body) throw new Error(m.name + ': mutation did not change content');
  const out = [...lines.slice(0, s), ...mutatedBody.split('\n'), ...lines.slice(e + 1)].join('\n');
  writeFileSync(SCF, out);
  if (sha(SCF) === HASH_BEFORE) throw new Error(m.name + ': file unchanged after write');
  console.log(`\n=== ${m.name} | enclosing ${m.fn.trim()} lines ${s + 1}-${e + 1} | edit at line ${editLine} | predicted ${m.predicted}`);
  const r = spawnSync(process.execPath, ['--test', `${SCR}/apps/chat/test/*.test.js`], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  const text = (r.stdout ?? '') + (r.stderr ?? '');
  const fails = text.split('\n').filter((l) => /^✖ AS-82/.test(l) || /^ℹ (tests|pass|fail)/.test(l));
  const otherFails = text.split('\n').filter((l) => /^✖/.test(l) && !/^✖ AS-82/.test(l));
  console.log(fails.join('\n'));
  if (otherFails.length) console.log('OTHER FAILS:\n' + otherFails.join('\n'));
  // restore
  cpSync(WTF, SCF);
  if (sha(SCF) !== HASH_BEFORE) throw new Error('restore failed after ' + m.name);
  console.log('restored, hash ok');
}
console.log('\nHASH_AFTER worktree', sha(WTF), sha(WTF) === HASH_BEFORE ? 'UNCHANGED' : 'CHANGED!!');
