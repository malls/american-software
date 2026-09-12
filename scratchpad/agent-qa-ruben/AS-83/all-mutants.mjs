import { spawnSync } from 'node:child_process';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-83';
for (const m of process.argv.slice(2).length ? process.argv.slice(2) : ['M1', 'M2', 'M3']) {
  const r = spawnSync(process.execPath, [`${S}/mutate.mjs`, m], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // strip the diff body to keep output short; keep everything else
  const out = (r.stdout || '') + (r.stderr || '');
  const lines = out.split('\n');
  const kept = [];
  let inDiff = false;
  for (const l of lines) {
    if (/^\[M\d\] diff:/.test(l)) { inDiff = true; kept.push(l); continue; }
    if (inDiff && /^\[M\d\]/.test(l)) inDiff = false;
    if (!inDiff || /^[-+][^-+]/.test(l)) kept.push(l);
  }
  console.log(kept.join('\n'));
  console.log(`==== ${m} exit ${r.status} ====\n`);
}
