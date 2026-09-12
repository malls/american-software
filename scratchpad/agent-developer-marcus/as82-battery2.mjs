// AS-82 battery, second pass: M2 and M7 only. Both failed the EXACTLY-ONCE anchor
// assertion on the first pass — M2 because the driver never set a probe string,
// M7 because `proc.kill('SIGTERM')` occurs twice (deploy ops + the tick box).
// Neither was a survivor: neither ever ran. Anchors here are made unique by
// slicing to the enclosing function first.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-82/apps/chat';
const MUT = '/tmp/as82-mut/apps/chat';
const REL = 'watch/advance-watcher.mjs';
const P = readFileSync(`${WT}/${REL}`, 'utf8');

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

const NAMES = {
  1: 'start() refuses to run beside a live watcher', 2: 'every poll rewrites heartbeatAt',
  3: 'a message fires exactly one tick', 4: 'the spawn call site passes tickArgv',
  5: 'settle releases the lock, then records tick_ended', 6: 'a tick that outlives the box',
  7: 'a fire that loses the lock', 8: 'shutdown clears the intervals',
  9: 'a spawn error settles the tick', 10: 'entry point: the real process heartbeats',
};
const countOf = (s, sub) => s.split(sub).length - 1;
const lineOf = (s, i) => s.slice(0, i).split('\n').length;
function run() {
  try { return execFileSync('node', ['--test', `${MUT}/test/watcher-main.test.js`, `${MUT}/test/watcher-process.test.js`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000 }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}
const failedSet = (out) => Object.entries(NAMES)
  .filter(([, f]) => out.split('\n').some((l) => l.startsWith('✖ ') && l.includes(f)))
  .map(([n]) => Number(n)).sort((a, b) => a - b);

const cases = [];

// --- M2: move the heartbeat below the gate. Anchor = BEAT immediately followed
// by GATE, which can only occur in poll(). Asserted exactly once.
{
  const anchor = BEAT + GATE;
  const n = countOf(P, anchor);
  const line = lineOf(P, P.indexOf(anchor));
  cases.push({ id: 'M2', within: 'poll()', predicted: [2], n, line,
    desc: 'move the heartbeat below the `if (child) return` gate (AC-2)',
    mutated: n === 1 ? P.replace(anchor, GATE + BEAT) : null });
}

// --- M7: delete proc.kill('SIGTERM') in the TICK BOX. The string occurs twice in
// the file, so anchor by slicing from the TIMEOUT log line that only the tick box has.
{
  const TIMEOUT_LOG = '      log(`TIMEOUT tick exceeded';
  const KILL = `      proc.kill('SIGTERM');\n`;
  const nLog = countOf(P, TIMEOUT_LOG);
  const at = P.indexOf(TIMEOUT_LOG);
  const killAt = P.indexOf(KILL, at);
  const within = P.slice(at, killAt + KILL.length);
  // uniqueness is established by TIMEOUT_LOG (once) + first KILL after it
  const n = nLog === 1 && killAt > at && countOf(within, KILL) === 1 ? 1 : 0;
  cases.push({ id: 'M7', within: 'fire() tick-box timer', predicted: [6], n,
    line: lineOf(P, killAt),
    desc: "delete proc.kill('SIGTERM') inside the tick box (AC-7)",
    mutated: n === 1 ? P.slice(0, killAt) + P.slice(killAt + KILL.length) : null });
}

for (const c of cases) {
  if (c.n !== 1 || !c.mutated) { console.log(`${c.id} ANCHOR ${c.n}x — NOT RUN`); continue; }
  if (c.mutated === P) { console.log(`${c.id} NO-CHANGE — NOT RUN`); continue; }
  writeFileSync(`${MUT}/${REL}`, c.mutated);
  const out = run();
  const obs = failedSet(out);
  const counts = (out.match(/ℹ (tests|pass|fail) \d+/g) || []).join(' ');
  const eq = JSON.stringify(obs) === JSON.stringify(c.predicted);
  console.log(`${c.id}\tline ${c.line}\t${c.within}\tpred {${c.predicted}}\tobs {${obs}}\t${eq ? 'MATCH' : (obs.length ? 'DIFFERS' : 'SURVIVOR')}\t${c.desc} | ${counts}`);
}
writeFileSync(`${MUT}/${REL}`, P);
console.log('PASS2 DONE');
