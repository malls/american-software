// V5: a SUBDIRECTORY inside host vendor/ holding a non-JS file — the pin counts entries, not files;
// a third entry of any kind or type must be red.
import { mutant, APP, read, write } from './harness.mjs';
import { join } from 'node:path';
const D = join(APP, 'vendor');
mutant({
  name: 'V5 host vendor/notes/README.txt (subdir, non-JS)',
  suffix: '7', log: 'run7-V5-vendor-subdir.log',
  touch: [D],
  apply() { write(join(D, 'notes', 'README.txt'), 'nothing to see\n'); },
  applied: () => read(join(D, 'notes', 'README.txt')).length > 0,
  predict: 'red exactly {assets vendor/ pin, 3 entries: notes, states-ledger.md, tokens.css}, 532/512/1/19',
});
