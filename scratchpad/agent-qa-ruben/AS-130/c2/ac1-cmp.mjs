// AS-130 c2, AC-1: fresh build on the branch record vs the committed index.html (byte compare);
// same on the merged tree. Plus AC-6/8/11/12 static checks at the tip.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const M = '/tmp/as130-c2-merged';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-130/c2';
for (const [label, root] of [['branch', W], ['merged', M]]) {
  const out = `${S}/index-${label}.html`;
  const r = spawnSync('node', [`${root}/.claude/skills/d1-demo-artifact/build.mjs`, root, out], { encoding: 'utf8' });
  const same = readFileSync(out).equals(readFileSync(`${root}/docs/demo/d1/index.html`));
  console.log(`AC-1 ${label}: build exit ${r.status}; ${r.stdout.split('\n').slice(0, 3).join(' | ')}; fresh == committed index.html: ${same}`);
}
// AC-6 transcript form
const t = readFileSync(`${W}/docs/demo/d1/transcript.txt`, 'utf8');
const lines = t.split('\n');
console.log(`AC-6: first line "${lines[0]}"; last non-empty "${t.trimEnd().split('\n').pop().slice(0, 60)}…"; not built|404s: ${(t.match(/not built|404s/g) ?? []).length}; step-2 body line: ${(t.match(/body: text\/html, \d+ bytes, page state S3-EMPTY-FIRSTRUN/) ?? ['MISSING'])[0]}`);
const tm = execFileSync('git', ['-C', W, 'show', 'master:docs/demo/d1/transcript.txt'], { encoding: 'utf8' });
console.log(`AC-6 red (master's transcript): not built|404s = ${(tm.match(/not built|404s/g) ?? []).length}`);
// AC-8 run.mjs hunk scan
const d = execFileSync('git', ['-C', W, 'diff', 'master...feat/AS-130-demo-recapture', '--', 'apps/invoicing/demo/run.mjs'], { encoding: 'utf8' });
const changed = d.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
const hits = changed.filter((l) => /FREELANCER|CLIENT|CONTRACT|LINE_ITEM|DAYS_UNTIL_DUE|EVENT_|call\(|expect|label:|n:/.test(l));
console.log(`AC-8: run.mjs changed lines ${changed.length}; matching the forbidden pattern: ${hits.length}${hits.length ? '\n  ' + hits.join('\n  ') : ''}`);
// AC-7 surface diff: three-dot (what the branch changed) and two-dot (vs today's master)
const surface = ['apps/invoicing/test', 'apps/invoicing/lib', 'apps/invoicing/routes', 'apps/invoicing/views', 'apps/invoicing/public', 'apps/invoicing/compose.yaml', 'apps/invoicing/Dockerfile', 'apps/invoicing/package.json', 'apps/invoicing/package-lock.json', 'apps/invoicing/app.js', 'apps/invoicing/server.js'];
const three = execFileSync('git', ['-C', W, 'diff', '--stat', 'master...feat/AS-130-demo-recapture', '--', ...surface], { encoding: 'utf8' }).trim();
const two = execFileSync('git', ['-C', W, 'diff', '--stat', 'master', '--', ...surface], { encoding: 'utf8' }).trim().split('\n').pop();
console.log(`AC-7: surface diff master...branch (the branch's own changes): ${three === '' ? 'empty' : three}`);
console.log(`AC-7: surface diff master..branch (today's master has moved since base): ${two || 'empty'}`);
// AC-11/12 capture.json
const c = JSON.parse(readFileSync(`${W}/docs/demo/d1/capture.json`, 'utf8'));
const keys = ['file', 'state', 'width', 'height', 'url', 'bytes'];
const complete = c.captures.filter((x) => keys.every((k) => x[k] !== undefined && x[k] !== null)).length;
const layer = c.captures.filter((x) => x.layer).map((x) => x.file);
const media = c.captures.filter((x) => x.media).map((x) => x.file);
console.log(`AC-11: screenMergeCommits ${Object.keys(c.screenMergeCommits).length}; branchCommit ${c.branchCommit}; target "${c.target}"; chrome ${c.chrome}; captures ${c.captures.length}, complete ${complete}; layer on ${JSON.stringify(layer)}; media on ${JSON.stringify(media)}`);
console.log(`AC-12: urls off ${c.base}: ${c.captures.filter((x) => !x.url.startsWith(`${c.base}/`)).length} of ${c.captures.length}`);
// AC-13 record grep
const skill = readFileSync(`${W}/.claude/skills/d1-demo-artifact/SKILL.md`, 'utf8');
const readme = readFileSync(`${W}/apps/invoicing/demo/README.md`, 'utf8');
console.log(`AC-13: ".env.local" / "--env-file" in SKILL.md or demo/README.md: ${(skill + readme).match(/\.env\.local|--env-file/g)?.length ?? 0}`);
