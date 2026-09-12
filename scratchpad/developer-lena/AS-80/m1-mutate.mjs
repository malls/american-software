// M1: delete the `clearInterval(loopPoll)` line inside close(). Site-anchored.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const F = '/Users/forrest/Code/american-software-company/.worktrees/AS-80/apps/chat/server.js';
const NEEDLE = 'clearInterval(loopPoll)';
const occ = (s, n) => s.split(n).length - 1;
const slice = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.indexOf(b));

const before = readFileSync(F, 'utf8');
assert.equal(occ(before, NEEDLE), 1, `pre: ${NEEDLE} must occur exactly once`);
const lines = before.split('\n');
const idx = lines.findIndex((l) => l.includes(NEEDLE));
console.log(`M1 target line ${idx + 1}: ${lines[idx].trim()}`);
lines.splice(idx, 1);
writeFileSync(F, lines.join('\n'));

// Assert applied AT the site, not merely that some edit applied.
const after = readFileSync(F, 'utf8');
assert.equal(occ(after, NEEDLE), 0, 'post: needle count 1 -> 0');
const region = slice(after, 'clearInterval(heartbeat);', 'clearInterval(lanesPoll);');
assert.equal(region.includes('loopPoll'), false,
  'post: the close() slice between heartbeat and lanesPoll must no longer mention loopPoll');
assert.equal(occ(after, 'const loopPoll = setInterval('), 1, 'post: the ARMING site is untouched');
assert.equal(after.split('\n').length, before.split('\n').length - 1, 'post: exactly one line removed');
console.log('M1 applied at the intended site: needle 1 -> 0; close() slice clean; arming site intact.');
