// Copy cycle-1 helpers into c2/ with the scratch path rewritten so their outputs land here.
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
const S1 = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130';
const S2 = `${S1}/c2`;
for (const f of ['compose.mjs', 'build-falsifiers.mjs', 'ac9-mutation.sh', 'demo-twice.mjs', 'inspect-record.mjs']) {
  let t = readFileSync(`${S1}/${f}`, 'utf8');
  t = t.split(`${S1}'`).join(`${S2}'`).split(`${S1};`).join(`${S2};`).split(`S=${S1}\n`).join(`S=${S2}\n`);
  // demo-twice: distinct project name for cycle 2, and the teardown becomes SKILL step 1's own line (measured separately)
  if (f === 'demo-twice.mjs') t = t.split("'asc-review-as130'").join("'asc-c2-step1'").split('asc-review-as130-demo').join('asc-c2-step1-demo');
  if (f === 'ac9-mutation.sh') t = t.split('asc-review-as130-m9').join('asc-c2-m9');
  writeFileSync(`${S2}/${f}`, t);
  if (f.endsWith('.sh')) chmodSync(`${S2}/${f}`, 0o755);
  console.log(`${f}: ${t.includes(S2) ? 'rewritten' : 'UNCHANGED (no S path)'}`);
}
