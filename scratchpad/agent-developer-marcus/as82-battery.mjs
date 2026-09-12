// AS-82 §5 mutation battery. Anchored LITERAL mutations on a scratch copy; never the worktree.
// Every anchor must occur EXACTLY ONCE in the file, and the printed edit line is
// checked by eye against the intended enclosing function (AS-95 cycle-1 lesson).
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-82/apps/chat';
const MUT = '/tmp/as82-mut/apps/chat';
const REL = 'watch/advance-watcher.mjs';
const PRISTINE = readFileSync(`${WT}/${REL}`, 'utf8');
const HASH_BEFORE = createHash('sha256').update(PRISTINE).digest('hex');

rmSync('/tmp/as82-mut', { recursive: true, force: true });
mkdirSync('/tmp/as82-mut', { recursive: true });
cpSync(WT, MUT, { recursive: true });

const BEAT = `    try {
      writeWatcherPid({
        path: paths.pid,
        pid,
        startedAt: watcherStartedAt,
        now: new Date(now()).toISOString(),
      });
    } catch {
      /* heartbeat is best-effort; the indicator degrades, the watcher does not */
    }
`;
const GATE = `    if (child) return; // our own tick is running; its lock covers this window\n`;
const CALL = `      writeWatcherPid({
        path: paths.pid,
        pid,
        startedAt: watcherStartedAt,
        now: new Date(now()).toISOString(),
      });
`;
const HIGHWATER = `    writeFileSync(
      paths.highwater + '.tmp',`;

const MUTS = [
  { id: 'M1', within: 'poll()', predicted: [2, 10],
    desc: 'delete the writeWatcherPid heartbeat call in poll() (AC-1, the headline)',
    find: CALL, repl: '' },
  { id: 'M2', within: 'poll()', predicted: [2],
    desc: 'move the heartbeat below the `if (child) return` gate (AC-2)',
    fn: (s) => s.replace(BEAT + GATE, GATE + BEAT) },
  { id: 'M3', within: 'fire()', predicted: [3, 7],
    desc: 'fire() proceeds without taking the lock (AC-3)',
    find: 'if (!acquireLock(nonce, { loop: { ticks: loopOps.nextTick() } })) {',
    repl: 'if (!true) {' },
  { id: 'M4', within: 'settle()', predicted: [5, 9],
    desc: 'delete releaseLock() in settle() (AC-4)',
    find: `      releaseLock();\n`, repl: '' },
  { id: 'M5', within: 'fire() spawn site', predicted: [4],
    desc: "spawn passes literal 'plan' instead of config.permissionMode (AC-5)",
    find: 'tickArgv(pid, nonce, config.permissionMode, rules ?? undefined)',
    repl: "tickArgv(pid, nonce, 'plan', rules ?? undefined)" },
  { id: 'M6', within: 'fire()', predicted: [2, 3],
    desc: 'delete the highwater write + rename in fire() (AC-6)',
    fn: (s) => {
      const i = s.indexOf(HIGHWATER);
      const j = s.indexOf(`    renameSync(paths.highwater + '.tmp', paths.highwater);\n`);
      if (i < 0 || j < i) throw new Error('M6 span not found');
      const end = j + `    renameSync(paths.highwater + '.tmp', paths.highwater);\n`.length;
      return s.slice(0, i) + s.slice(end);
    },
    probe: HIGHWATER },
  { id: 'M7', within: 'fire() tick-box timer', predicted: [6],
    desc: "delete proc.kill('SIGTERM') inside the tick box (AC-7)",
    find: `      proc.kill('SIGTERM');\n`, repl: '' },
  { id: 'M8', within: 'shutdown()', predicted: [8, 10],
    desc: 'delete unlinkSync(paths.pid) in shutdown() (AC-8)',
    find: `      unlinkSync(paths.pid);\n`, repl: '' },
  { id: 'M9', within: 'settle()', predicted: [5],
    desc: 'swap eventsOps.tickEnded() and loopOps.settle() (AC-9)',
    fn: (s) => s.replace(
      `      eventsOps.tickEnded({ code, signal, timedOut, headBefore, headAfter });\n      loopOps.settle({ code, signal, timedOut, headBefore, headAfter });\n`,
      `      loopOps.settle({ code, signal, timedOut, headBefore, headAfter });\n      eventsOps.tickEnded({ code, signal, timedOut, headBefore, headAfter });\n`),
    probe: `      eventsOps.tickEnded({ code, signal, timedOut, headBefore, headAfter });\n      loopOps.settle(` },
  { id: 'M10', within: 'settle()', predicted: [5, 6, 9],
    desc: 'delete the eventsOps.tickEnded() line in settle() (AC-9)',
    find: `      eventsOps.tickEnded({ code, signal, timedOut, headBefore, headAfter });\n`, repl: '' },
];

const NAMES = {
  1: 'start() refuses to run beside a live watcher',
  2: 'every poll rewrites heartbeatAt',
  3: 'a message fires exactly one tick',
  4: 'the spawn call site passes tickArgv',
  5: 'settle releases the lock, then records tick_ended',
  6: 'a tick that outlives the box',
  7: 'a fire that loses the lock',
  8: 'shutdown clears the intervals',
  9: 'a spawn error settles the tick',
  10: 'entry point: the real process heartbeats',
};

const countOf = (s, sub) => s.split(sub).length - 1;
const lineOf = (s, sub) => s.slice(0, s.indexOf(sub)).split('\n').length;

function run() {
  try {
    return execFileSync('node', ['--test', `${MUT}/test/watcher-main.test.js`, `${MUT}/test/watcher-process.test.js`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 });
  } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

function failedSet(out) {
  const f = [];
  for (const [n, frag] of Object.entries(NAMES)) if (out.includes('✖ ') && out.split('\n').some((l) => l.startsWith('✖ ') && l.includes(frag))) f.push(Number(n));
  return f.sort((a, b) => a - b);
}

const rows = [];
for (const mu of MUTS) {
  writeFileSync(`${MUT}/${REL}`, PRISTINE);
  if (createHash('sha256').update(readFileSync(`${MUT}/${REL}`)).digest('hex') !== HASH_BEFORE)
    throw new Error(`${mu.id}: restore check failed`);

  const probe = mu.probe ?? mu.find;
  const n = countOf(PRISTINE, probe);
  if (n !== 1) { rows.push({ ...mu, error: `anchor matched ${n}x, expected exactly 1` }); console.log(`${mu.id} ANCHOR ${n}x`); continue; }
  const line = lineOf(PRISTINE, probe);

  const mutated = mu.fn ? mu.fn(PRISTINE) : PRISTINE.replace(mu.find, mu.repl);
  if (mutated === PRISTINE) { rows.push({ ...mu, error: 'mutation produced NO change' }); console.log(`${mu.id} NO-CHANGE`); continue; }
  writeFileSync(`${MUT}/${REL}`, mutated);

  const out = run();
  const observed = failedSet(out);
  const counts = (out.match(/ℹ (tests|pass|fail) \d+/g) || []).join(' ');
  rows.push({ ...mu, line, observed, counts });
  console.log(`${mu.id} @${line} ${mu.within} pred {${mu.predicted}} obs {${observed}} | ${counts}`);
}

writeFileSync(`${MUT}/${REL}`, PRISTINE);
console.log('\n=== BATTERY TABLE ===');
for (const r of rows) {
  if (r.error) { console.log(`${r.id}\tERROR ${r.error} — ${r.desc}`); continue; }
  const eq = JSON.stringify(r.observed) === JSON.stringify(r.predicted);
  const verdict = eq ? 'MATCH' : (r.observed.length === 0 ? 'SURVIVOR' : 'DIFFERS');
  console.log(`${r.id}\tline ${r.line}\t${r.within}\tpred {${r.predicted}}\tobs {${r.observed}}\t${verdict}\t${r.desc}`);
}
console.log('\nHASH_BEFORE ' + HASH_BEFORE);
