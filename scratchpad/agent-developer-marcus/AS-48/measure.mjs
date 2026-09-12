// Scratch: pre-run predictions for the cardinality literals AS-48 moves.
// Start tags per template (the plan's perl instrument, in JS), app.css
// declaration / var() counts (assets.test.js's regexes), template links.
import { readFileSync, readdirSync } from 'node:fs';
const APP = process.argv[2] ?? '/Users/forrest/Code/american-software-company/.worktrees/AS-48/apps/invoicing';
let total = 0;
for (const f of readdirSync(`${APP}/views`).sort()) {
  const src = readFileSync(`${APP}/views/${f}`, 'utf8').replace(/<%#[\s\S]*?%>/g, '');
  const n = (src.match(/<[A-Za-z!/]/g) ?? []).length;
  total += n;
  const hrefs = (src.match(/\bhref="([^"]*)"/g) ?? []).length;
  const actions = [...src.matchAll(/<form\b([^>]*)>/g)].filter((m) => /\baction="/.test(m[1])).length;
  console.log(`${f}: startTags=${n} hrefs=${hrefs} actions=${actions} links=${hrefs + actions}`);
}
console.log(`VIEW_START_TAGS total=${total}`);
const css = readFileSync(`${APP}/public/app.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
console.log(`app.css decls=${[...css.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+);/g)].length} refs=${[...css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].length}`);
