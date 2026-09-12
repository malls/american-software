// AS-130 review probe: consistency of docs/demo/d1/ on the branch (cardinality first).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-130';
const D = `${W}/docs/demo/d1`;
const onDisk = readdirSync(D).filter((f) => f.endsWith('.png')).sort();
const tracked = execFileSync('git', ['-C', W, 'ls-files', 'docs/demo/d1'], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.png')).map((f) => f.split('/').pop()).sort();
console.log('png on disk', onDisk.length, '| png tracked', tracked.length, '| same set', JSON.stringify(onDisk) === JSON.stringify(tracked));

const c = JSON.parse(readFileSync(`${D}/capture.json`, 'utf8'));
console.log('captures', c.captures.length, '| screenMergeCommits', Object.keys(c.screenMergeCommits).length, JSON.stringify(c.screenMergeCommits));
console.log('branchCommit', c.branchCommit, '| chrome', c.chrome, '| base', c.base);
console.log('target', c.target);
console.log('capturedAt', c.capturedAt);
const inJson = c.captures.map((x) => x.file).sort();
console.log('capture.json files == tracked pngs', JSON.stringify(inJson) === JSON.stringify(tracked));
const offBase = c.captures.filter((x) => !x.url.startsWith(`${c.base}/`));
console.log('urls off base', offBase.length, offBase.map((x) => x.url));
let mismatched = 0;
for (const x of c.captures) {
  const s = statSync(`${D}/${x.file}`).size;
  if (s !== x.bytes) { mismatched += 1; console.log('BYTES MISMATCH', x.file, s, x.bytes); }
}
console.log('bytes mismatches', mismatched, 'of', c.captures.length);
const required = ['file', 'state', 'width', 'height', 'url', 'bytes'];
const missingReq = c.captures.filter((x) => required.some((k) => !(k in x)));
console.log('captures missing a required key', missingReq.length);
console.log('layer:', c.captures.filter((x) => x.layer).map((x) => `${x.file}=${x.layer}`));
console.log('media:', c.captures.filter((x) => x.media).map((x) => `${x.file}=${x.media}`));
console.log('states:', [...new Set(c.captures.map((x) => x.state))].length, 'distinct');
console.log('urls:', c.captures.map((x) => `${x.file} <- ${x.url.replace(c.base, '')} [${x.state}]`).join('\n  '));
// last URL by walk order should be the dashboard
console.log('last capture', c.captures.at(-1).file, c.captures.at(-1).url);
