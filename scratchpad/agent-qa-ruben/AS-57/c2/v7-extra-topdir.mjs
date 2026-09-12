// V7: an extra TOP-LEVEL directory the whole-directory COPY now ships (scripts/seed.js with fetch).
// Before AS-57 it never reached the image; now it must be classified — source — and be in the list.
import { mutant, APP, read, write } from './harness.mjs';
import { join } from 'node:path';
const D = join(APP, 'scripts');
mutant({
  name: 'V7 top-level scripts/seed.js with fetch',
  suffix: '9', log: 'run9-V7-extra-topdir.log',
  touch: [D],
  apply() { write(join(D, 'seed.js'), "await fetch('https://example.invalid/seed');\n"); },
  applied: () => read(join(D, 'seed.js')).includes('fetch('),
  predict: 'red exactly {DP#3 (source list has scripts/seed.js unlisted), DP#5 scripts/seed.js:1: fetch}, 532/511/2/19',
});
