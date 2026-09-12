// V2: no file planted; lib/vendor.js gains a DYNAMIC import('../vendor/probe.js') behind a never-called
// function — the specifier regex's second form. Nothing lands in vendor/, so the pin stays green.
import { mutant, APP, read, write } from './harness.mjs';
import { join } from 'node:path';
const F = join(APP, 'lib', 'vendor.js');
const ADD = "\nexport async function __asLazy() { return (await import('../vendor/probe.js')).probe(); }\n";
mutant({
  name: 'V2 dynamic import(\'../vendor/probe.js\') from lib/vendor.js, no file',
  suffix: '4', log: 'run4-V2-dynamic-import.log',
  touch: [F],
  apply() { write(F, read(F) + ADD); },
  applied: () => read(F).endsWith(ADD),
  predict: 'red exactly {DP#3 assertion 5 naming lib/vendor.js}, 532/512/1/19',
});
