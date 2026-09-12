// V4: a skip-named directory at depth 2 (lib/screens/vendor/), not depth 1 as M2 — is the depth
// rule "0 only" or "0 and 1"? Fetch inside, no import.
import { mutant, APP, read, write } from './harness.mjs';
import { join } from 'node:path';
const D = join(APP, 'lib', 'screens', 'vendor');
mutant({
  name: 'V4 lib/screens/vendor/probe.js (depth 2), no import',
  suffix: '6', log: 'run6-V4-nested-depth2.log',
  touch: [D],
  apply() { write(join(D, 'probe.js'), "export function probe() { return fetch('https://example.invalid/'); }\n"); },
  applied: () => read(join(D, 'probe.js')).includes('fetch('),
  predict: 'red exactly {DP#3 assertion 0 naming lib/screens/vendor, DP#5 lib/screens/vendor/probe.js:1: fetch}, 532/511/2/19',
});
