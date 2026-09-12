// AS-130 review: static criteria AC-6 (greps), AC-7 (surface diff), AC-8 (run.mjs hunks).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const git = (...a) => execFileSync('git', ['-C', W, ...a], { encoding: 'utf8' });

const surfaces = ['apps/invoicing/test', 'apps/invoicing/lib', 'apps/invoicing/routes', 'apps/invoicing/views', 'apps/invoicing/public', 'apps/invoicing/compose.yaml', 'apps/invoicing/Dockerfile', 'apps/invoicing/package.json', 'apps/invoicing/package-lock.json', 'apps/invoicing/app.js', 'apps/invoicing/server.js'];
const stat = git('diff', 'master', '--stat', '--', ...surfaces);
console.log(`AC-7 surface diff --stat: ${stat.trim() === '' ? 'EMPTY (ok)' : `NOT EMPTY:\n${stat}`}`);

const hunks = git('diff', 'master', '--', 'apps/invoicing/demo/run.mjs').split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
const re = /FREELANCER|CLIENT|CONTRACT|LINE_ITEM|DAYS_UNTIL_DUE|EVENT_|call\(|expect|label:|n:/;
const hits = hunks.filter((l) => re.test(l));
console.log(`AC-8 changed lines in run.mjs: ${hunks.length}; lines matching the forbidden identifiers: ${hits.length}`);
for (const h of hits) console.log(`  ${h}`);

const branchT = readFileSync(`${W}/docs/demo/d1/transcript.txt`, 'utf8');
const masterT = git('show', 'master:docs/demo/d1/transcript.txt');
const count = (t) => t.split('\n').filter((l) => /not built|404s/.test(l)).length;
console.log(`AC-6 grep -c 'not built|404s': branch ${count(branchT)}, master ${count(masterT)}`);
const lines = branchT.split('\n');
console.log(`AC-6 first line: ${JSON.stringify(lines[0])}`);
console.log(`AC-6 last line: ${JSON.stringify(branchT.trimEnd().split('\n').pop())}`);
console.log(`AC-6 step-2 body line: ${JSON.stringify(lines.find((l) => l.includes('page state')))}`);
console.log(`STOPPED present: ${branchT.includes('STOPPED at step')}`);
