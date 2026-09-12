// V6: a SYMLINK under lib/ pointing at demo/ (an unscanned fetch user in the image). Docker COPY
// ships symlinks as symlinks; classifyTree statSync's (follows) — the link's name is not a
// SKIPPED_DIRS name, so demo's files should surface under lib/walk/ as unlisted source.
import { mutant, APP, read } from './harness.mjs';
import { join } from 'node:path';
import { symlinkSync, readlinkSync, readdirSync } from 'node:fs';
const L = join(APP, 'lib', 'walk');
const demoFiles = readdirSync(join(APP, 'demo'));
mutant({
  name: `V6 symlink lib/walk -> ../demo (demo/ has ${demoFiles.length} entries: ${demoFiles.join(', ')})`,
  suffix: '8', log: 'run8-V6-symlink-to-demo.log',
  touch: [L],
  apply() { symlinkSync('../demo', L); },
  applied: () => readlinkSync(L) === '../demo',
  predict: 'red exactly {DP#3 (source-list assertion, lib/walk/* unlisted), DP#5 fetch in lib/walk/*}, 532/511/2/19 — or loud if COPY dereferences/drops the link',
});
