// AC-3: each line of the CAN/CANNOT block appears exactly once in the built HTML
// BEFORE the first <figure (after entity decoding), and once more in the transcript.
import { readFileSync } from 'node:fs';
const html = readFileSync(process.argv[2], 'utf8');
const runMjs = readFileSync('/Users/forrest/Code/american-software-company/.worktrees/AS-90/apps/invoicing/demo/run.mjs', 'utf8');
const m = /const CAN_CANNOT = `([\s\S]*?)`;/.exec(runMjs);
const block = m[1];
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const firstFigure = html.indexOf('<figure');
const before = decode(html.slice(0, firstFigure));
const whole = decode(html);
const count = (hay, needle) => hay.split(needle).length - 1;
let ok = true;
const lines = block.split('\n');
for (const line of lines) {
  const b = count(before, line); const w = count(whole, line);
  if (b !== 1) ok = false;
  console.log(`${b === 1 ? 'ok ' : 'BAD'} before-first-figure=${b} whole=${w}  ${line.slice(0, 60)}`);
}
console.log(`block lines examined: ${lines.length}; whole block verbatim before first figure: ${before.includes(block)}`);
console.log(`first figure at byte ${firstFigure}; block starts at byte ${whole.indexOf(block)}; title at ${html.indexOf('<h1>')}`);
console.log(`alt texts: ${(html.match(/alt="[^"]*"/g) ?? []).join(' | ')}`);
console.log(`img count ${count(html, '<img ')}, data-uri imgs ${count(html, 'src="data:image/png;base64,')}`);
console.log(`chips: app=${count(html, 'd1-chip--app">')} mock=${count(html, 'd1-chip--mock">')} event=${count(html, 'd1-chip--event">')} (incl. legend)`);
console.log(`external refs: http(s) src/href=${(html.match(/(src|href)="https?:[^"]*"/g) ?? []).length}`);
process.exit(ok ? 0 : 1);
