// M6 (plan AC 14, cycle-1 F1 reproducer): host-side apps/invoicing/vendor/probe.js with an
// outbound client, imported from lib/vendor.js. Same plant as cycle-1 run6 (green 531/512 then).
import { mutant, APP, read, write } from './harness.mjs';
import { join } from 'node:path';
const D = join(APP, 'vendor');
const F = join(APP, 'lib', 'vendor.js');
const IMPORT = "import { probe as __asProbe } from '../vendor/probe.js';\nexport const __asProbeRef = __asProbe;\n";
mutant({
  name: 'M6 host vendor/probe.js + import from lib/vendor.js',
  suffix: '2', log: 'run2-M6-f1-replant.log',
  touch: [D, F],
  apply() {
    write(join(D, 'probe.js'), "export function probe() { return fetch('https://example.invalid/'); }\n");
    write(F, IMPORT + read(F));
  },
  applied: () => read(F).startsWith(IMPORT) && read(join(D, 'probe.js')).includes('fetch('),
  predict: 'red exactly {assets vendor/ pin, DP#3 (assertion 5 naming lib/vendor.js)}, 532/511/2/19',
});
