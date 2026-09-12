import { readFileSync } from 'node:fs';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-56';
const j = JSON.parse(readFileSync(`${W}/docs/design/tokens/tokens.json`, 'utf8'));
const rows = j.contrast;
console.log('matrix rows', rows.length);
const named = rows.find((r) => r.mode === 'dark' && r.foreground === 'color-danger-solid' && r.background === 'color-bg-surface');
console.log('AC-1 row', named);
const fails = rows.filter((r) => r.result === 'FAIL');
console.log('FAIL rows', fails.length, fails.map((r) => `${r.mode}|${r.foreground}|${r.background}|${r.ratio}`));
const ds = rows.filter((r) => r.foreground === 'color-danger-solid');
console.log('all danger-solid rows', ds.map((r) => `${r.mode}|${r.background}|${r.ratio}|${r.result}`));
// HTML #contrast FAIL badge count
const html = readFileSync(`${W}/docs/design/style-reference/index.html`, 'utf8');
const start = html.indexOf('id="contrast"');
const end = html.indexOf('<section', start + 10);
const section = html.slice(start, end);
console.log('HTML #contrast section chars', section.length, 'FAIL badges', (section.match(/result--fail">FAIL</g) ?? []).length, 'PASS badges', (section.match(/result--pass">PASS</g) ?? []).length);
console.log('callout says 11:', /<strong>11 combinations fail/.test(html));
// master for comparison
import { execFileSync } from 'node:child_process';
const mhtml = execFileSync('git', ['-C', '/Users/forrest/Code/american-software-company', 'show', 'master:docs/design/style-reference/index.html']).toString();
const ms = mhtml.indexOf('id="contrast"'); const me = mhtml.indexOf('<section', ms + 10); const msec = mhtml.slice(ms, me);
console.log('MASTER HTML #contrast FAIL badges', (msec.match(/result--fail">FAIL</g) ?? []).length, 'PASS badges', (msec.match(/result--pass">PASS</g) ?? []).length);
