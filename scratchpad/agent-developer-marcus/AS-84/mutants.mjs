// AS-84 mutation battery driver. One mutant per run, applied to a WORKING-TREE
// copy that the shell restores from a backup (trap EXIT) immediately after the
// suite has spoken. Every mutant asserts:
//   - the `from` text occurs EXACTLY ONCE in the file (the anchor: a pattern
//     that cannot match anywhere but the intended site)
//   - the mutated file contains the `to` text and no longer contains `from`
//   - `site`, a regex that must match the enclosing function's own line range,
//     so "some edit applied" is never mistaken for "the intended edit applied"
//     (the AS-95 sharpening).
// Usage: node mutants.mjs list | node mutants.mjs apply <id>
import { readFileSync, writeFileSync } from 'node:fs';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-84/apps/chat/watch/advance-watcher.mjs';

export const MUTANTS = [
  {
    id: 'M1',
    ac: 'AC-1 (+AC-11)',
    what: 'releaseLock drops the source term — pid alone is ownership again',
    file: W,
    from: '    if (held && held.pid === pid && held.source === source) {',
    to: '    if (held && held.pid === pid) {',
    site: /function releaseLock\(\)[\s\S]{0,220}if \(held && held\.pid === pid\) \{/,
  },
  {
    id: 'M2',
    ac: 'AC-2',
    what: 'verify-after-create drops the nonce term',
    file: W,
    from: '      if (verify && verify.pid === pid && verify.nonce === nonce) return true;',
    to: '      if (verify && verify.pid === pid) return true;',
    site: /const verify = parseLock\(\);\n      if \(verify && verify\.pid === pid\) return true;/,
  },
  {
    id: 'M3',
    ac: 'AC-3 (+AC-4)',
    what: 'the ctor hydration line is deleted — lastAttempt starts blank again',
    file: W,
    from: '  let lastAttempt = hydrateAttempt(readState(statePath)?.lastAttempt);',
    to: '  let lastAttempt = null;',
    site: /let deploying = false;[\s\S]{0,400}\n  let lastAttempt = null;/,
  },
  {
    id: 'M4',
    ac: 'AC-4',
    what: "hydrateAttempt maps 'started' to itself instead of to a failure",
    file: W,
    from: "    return { id: record.id, at, outcome: 'fail', detail: 'interrupted: watcher exited mid-build' };",
    to: "    return { id: record.id, at, outcome: 'started', detail: 'interrupted: watcher exited mid-build' };",
    site: /export function hydrateAttempt\(record\)[\s\S]{0,600}outcome: 'started', detail: 'interrupted/,
  },
  {
    id: 'M5',
    ac: 'AC-5',
    what: "the pre-build persist() runs BEFORE the 'started' record is set (i.e. it is not on disk when compose spawns)",
    file: W,
    from:
      "      lastAttempt = { id: desiredId, at: startedAt, outcome: 'started', detail: 'building' };\n" +
      '      persist(stateFields);',
    to:
      '      persist(stateFields);\n' +
      "      lastAttempt = { id: desiredId, at: startedAt, outcome: 'started', detail: 'building' };",
    site: /async function performDeploy\([\s\S]{0,1400}persist\(stateFields\);\n      lastAttempt = \{ id: desiredId/,
  },
  {
    id: 'M6a',
    ac: 'AC-6',
    what: 'abort() resolves without ever signalling the compose child',
    file: W,
    from: '    if (deployChild) {\n      try {\n        deployChild.kill(signal);',
    to: '    if (null) {\n      try {\n        deployChild.kill(signal);',
    site: /async function abort\(signal = 'SIGTERM'\)[\s\S]{0,300}if \(null\) \{/,
  },
  {
    id: 'M6b',
    ac: 'AC-6 (+AC-14)',
    what: "an aborted build is recorded as 'fail' (and so earns a 30-min cooldown)",
    file: W,
    from: "          outcome = 'aborted';",
    to: "          outcome = 'fail';",
    site: /if \(abortSignal !== null && !result\.timedOut\) \{\n          outcome = 'fail';/,
  },
  {
    id: 'M7',
    ac: 'AC-7',
    what: 'abort() while idle writes state anyway',
    file: W,
    from: '    if (!deploying) return;\n    abortSignal = signal;',
    to: '    if (!deploying) { persist({}); return; }\n    abortSignal = signal;',
    site: /async function abort\(signal = 'SIGTERM'\) \{\n    if \(!deploying\) \{ persist\(\{\}\); return; \}/,
  },
  {
    id: 'M8',
    ac: 'AC-8',
    what: "evaluate()'s try/catch is deleted — a throwing collaborator rejects again",
    file: W,
    from:
      '  async function evaluate(opts = {}) {\n' +
      '    try {\n' +
      '      return await evaluateInner(opts);\n' +
      '    } catch (err) {',
    to:
      '  async function evaluate(opts = {}) {\n' +
      '    return await evaluateInner(opts);\n' +
      '    // eslint-disable-next-line no-unreachable\n' +
      '    try {\n' +
      '      return await evaluateInner(opts);\n' +
      '    } catch (err) {',
    // The site check names the evaluate WRAPPER, never evaluateInner: the
    // AS-95 sharpening is that a mutation landing at a plausible neighbour
    // looks identical, from the outside, to a vacuous guard.
    site: /async function evaluate\(opts = \{\}\) \{\n    return await evaluateInner\(opts\);/,
  },
  {
    id: 'M9',
    ac: 'AC-9',
    what: 'shutdown() exits synchronously again — it never waits for what it killed',
    file: W,
    from: '    if (waits.length === 0) return finish(dying);',
    to: '    return finish(dying);',
    site: /function shutdown\(signal\)[\s\S]{0,900}\n    return finish\(dying\);\n/,
  },
  {
    id: 'M10',
    ac: 'AC-10 (+AC-14)',
    what: 'shutdown() never calls deployOps.abort() — the build is orphaned',
    file: W,
    from: "      waits.push(deployOps.abort('SIGTERM'));\n",
    to: '',
    site: /log\('STOP aborting in-flight deploy'\);\n    \}/,
  },
  {
    id: 'M12',
    ac: 'AC-12',
    what: 'the grace timer is removed — shutdown waits unconditionally',
    file: W,
    from: '    return Promise.race([Promise.all(waits), grace]).then(() => {',
    to: '    return Promise.all(waits).then(() => {',
    site: /function shutdown\(signal\)[\s\S]{0,1400}return Promise\.all\(waits\)\.then\(\(\) => \{/,
  },
  {
    id: 'M13',
    ac: 'AC-13',
    what: "deployPoll()'s .catch is deleted",
    file: W,
    from:
      '    return deployOps\n' +
      '      .evaluate({ busy: Boolean(child) })\n' +
      '      .catch((err) => log(`ERROR deploy poll rejected: ${err.message}`));',
    to: '    return deployOps.evaluate({ busy: Boolean(child) });',
    site: /function deployPoll\(\) \{\n    return deployOps\.evaluate\(\{ busy: Boolean\(child\) \}\);\n  \}/,
  },
  {
    id: 'M14',
    ac: 'AC-16 (+AC-18)',
    what: "finish() no longer fires abort('SIGKILL') at grace expiry — the deploy child is orphaned again (Ruben F1)",
    file: W,
    from: "      log('STOP grace expired: killing deploy child');\n      void deployOps.abort('SIGKILL');\n",
    to: "      log('STOP grace expired: killing deploy child');\n",
    site: /function finish\(dying\) \{[\s\S]{0,900}log\('STOP grace expired: killing deploy child'\);\n    \}\n/,
  },
  {
    id: 'M15',
    ac: 'AC-18',
    what: "abort('SIGKILL') no longer releases the deploy lock synchronously — a dead-pid source:deploy lock is left behind",
    file: W,
    from: "    if (signal === 'SIGKILL') lock.releaseLock();\n",
    to: '',
    site: /async function abort\(signal = 'SIGTERM'\) \{[\s\S]{0,900}\n    await pending;\n  \}/,
  },
  {
    id: 'M16',
    ac: 'AC-17',
    what: "runDockerCompose drops the compose log stream 'error' listener (Ruben F2)",
    file: W,
    from: "    out.on('error', (err) => log(`WARN deploy log stream error: ${err.message}`));\n",
    to: '',
    site: /export function runDockerCompose\([\s\S]{0,400}const out = createLog\(logPath, \{ flags: 'a' \}\);\n(?:\s*\/\/[^\n]*\n)*    const proc = spawnFn\(/,
  },
];

// CLI only when run directly — battery.mjs imports MUTANTS from here.
const { pathToFileURL } = await import('node:url');
if (!process.argv[1] || import.meta.url !== pathToFileURL(process.argv[1]).href) {
  // imported: export the specs and do nothing else
} else {
const [, , cmd, id] = process.argv;
if (cmd === 'list') {
  for (const m of MUTANTS) console.log(`${m.id}\t${m.ac}\t${m.what}`);
  process.exit(0);
}
if (cmd !== 'apply' || !id) {
  console.error('usage: node mutants.mjs list | node mutants.mjs apply <id>');
  process.exit(2);
}
const m = MUTANTS.find((x) => x.id === id);
if (!m) {
  console.error(`no such mutant: ${id}`);
  process.exit(2);
}
const before = readFileSync(m.file, 'utf8');
const occurrences = before.split(m.from).length - 1;
if (occurrences !== 1) {
  console.error(`ANCHOR FAIL ${m.id}: \`from\` occurs ${occurrences} times, expected exactly 1`);
  process.exit(1);
}
const after = before.replace(m.from, m.to);
if (after === before) {
  console.error(`ANCHOR FAIL ${m.id}: replacement was a no-op`);
  process.exit(1);
}
writeFileSync(m.file, after);
const reread = readFileSync(m.file, 'utf8');
if (!m.site.test(reread)) {
  console.error(`SITE FAIL ${m.id}: the mutation did not land at the intended site`);
  process.exit(1);
}
const stillThere = reread.split(m.from).length - 1;
console.log(`APPLIED ${m.id} (${m.ac}) — ${m.what}`);
console.log(`  anchor: \`from\` occurrences before=1 after=${stillThere}; site regex matched inside its own function`);
// The grep -c equivalent, with line numbers, over the mutated text's first
// non-empty line: the count IS the anchor evidence, and the line number says
// which function it landed in.
const needle = m.to.split('\n').find((l) => l.trim().length > 0);
if (needle) {
  const lines = reread.split('\n');
  const hits = lines.map((l, i) => [i + 1, l]).filter(([, l]) => l.includes(needle));
  console.log(`  grep -c ${JSON.stringify(needle.trim())} => ${hits.length}`);
  for (const [n, l] of hits) console.log(`    ${n}: ${l.trim()}`);
} else {
  // A deletion mutant: the evidence is the disappearance, counted the same way.
  const gone = m.from.split('\n').find((l) => l.trim().length > 0);
  const lines = reread.split('\n');
  const hits = lines.filter((l) => l.includes(gone));
  console.log(`  (deletion) grep -c ${JSON.stringify(gone.trim())} => ${hits.length} (was 1)`);
}
}
