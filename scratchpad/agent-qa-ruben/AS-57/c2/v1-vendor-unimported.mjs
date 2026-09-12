// V1: host vendor/probe.js planted but NOT imported — is the cardinality pin independent of the import guard?
import { mutant, APP, read, write } from './harness.mjs';
import { join } from 'node:path';
const D = join(APP, 'vendor');
mutant({
  name: 'V1 host vendor/probe.js, no import',
  suffix: '3', log: 'run3-V1-vendor-unimported.log',
  touch: [D],
  apply() { write(join(D, 'probe.js'), "export function probe() { return fetch('https://example.invalid/'); }\n"); },
  applied: () => read(join(D, 'probe.js')).includes('fetch('),
  predict: 'red exactly {assets vendor/ pin}, 532/512/1/19',
});
