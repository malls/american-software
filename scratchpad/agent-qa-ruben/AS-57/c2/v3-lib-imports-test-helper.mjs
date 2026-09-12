// V3 (cycle-1 F2 path): lib/ imports a test helper — a `test/` specifier from app code.
// Static import of a real file that exists in the image (test/helpers/hash-comment.js has no
// side effects), so only the guard should fire.
import { mutant, APP, read, write } from './harness.mjs';
import { join } from 'node:path';
const F = join(APP, 'lib', 'vendor.js');
const IMPORT = "import { stripTrailingHashComment as __asStrip } from '../test/helpers/hash-comment.js';\nexport const __asStripRef = __asStrip;\n";
mutant({
  name: 'V3 lib/vendor.js imports ../test/helpers/hash-comment.js',
  suffix: '5', log: 'run5-V3-lib-imports-test-helper.log',
  touch: [F],
  apply() { write(F, IMPORT + read(F)); },
  applied: () => read(F).startsWith(IMPORT),
  predict: 'red exactly {DP#3 assertion 5 naming lib/vendor.js}, 532/512/1/19',
});
