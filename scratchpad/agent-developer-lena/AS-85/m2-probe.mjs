// AS-85 / M2 survivor run-down. The mutation applied at the intended site
// (line 582, the sole build projection in loopStateKey), so the question is
// whether the guard is weak or `current` is redundant GIVEN the other three
// key fields. Drive composeBuild over the full cross-product of its inputs and
// look for a single (id, desiredId, reason) triple that maps to two different
// `current` values. If none exists, no test of any shape can kill M2.
import { composeBuild, DEPLOY_STATE_STALE_MS } from '../../../.worktrees/AS-85/apps/chat/server.js';

const now = Date.parse('2026-09-11T12:00:00.000Z');
const fresh = new Date(now - 5_000).toISOString();
const stale = new Date(now - DEPLOY_STATE_STALE_MS - 1_000).toISOString();

const buildIds = [null, 'unknown-shape', 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'];
const desiredIds = [null, 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 42];
const reasons = ['current', 'busy', 'stale-build', 'cooldown', 'no-git', 'inputs-dirty',
  'no-docker', 'stale-state', 'no-watcher', 'unknown-build', 'no-state', 'unreadable-state', 7];
const computedAts = [fresh, stale, null, 'not-a-date'];
const states = [null, { error: 'unparsable' }, 'a string', 'OBJ'];

const map = new Map();
let cases = 0;
for (const buildId of buildIds)
  for (const desiredId of desiredIds)
    for (const reason of reasons)
      for (const computedAt of computedAts)
        for (const shape of states)
          for (const watcherListening of [true, false]) {
            const deployState = shape === 'OBJ' ? { desiredId, reason, computedAt } : shape;
            const b = composeBuild({ buildId, deployState, watcherListening, nowMs: now });
            cases++;
            const k = JSON.stringify([b.id, b.desiredId, b.reason]);
            if (!map.has(k)) map.set(k, new Set());
            map.get(k).add(JSON.stringify(b.current));
          }

const ambiguous = [...map].filter(([, v]) => v.size > 1);
console.log(`composeBuild cases driven: ${cases}`);
console.log(`distinct (id, desiredId, reason) triples observed: ${map.size}`);
console.log(`triples mapping to MORE THAN ONE \`current\`: ${ambiguous.length}`);
for (const [k, v] of ambiguous) console.log(`  ${k} -> ${[...v].join(' | ')}`);
console.log(ambiguous.length === 0
  ? 'VERDICT: current = f(id, desiredId, reason) over every reachable input. M2 is unkillable by construction.'
  : 'VERDICT: current is independent for at least one triple — M2 IS killable, the guard is weak.');
