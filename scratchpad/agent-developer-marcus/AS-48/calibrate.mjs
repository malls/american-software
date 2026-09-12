// Scratch: run measure.mjs's instruments against master's copies of the same
// files, via `git show`, to prove the instrument reproduces the committed
// baseline literals (VIEW_START_TAGS 87+43+206, APP_CSS 146/115, TEMPLATE_LINKS 13).
import { execFileSync } from 'node:child_process';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-48';
const show = (p) => execFileSync('git', ['-C', WT, 'show', `master:apps/invoicing/${p}`], { encoding: 'utf8' });
let total = 0;
let links = 0;
for (const f of ['signin.ejs', 'connect-stripe.ejs', 'invoice-form.ejs']) {
  const src = show(`views/${f}`).replace(/<%#[\s\S]*?%>/g, '');
  const n = (src.match(/<[A-Za-z!/]/g) ?? []).length;
  total += n;
  const hrefs = (src.match(/\bhref="([^"]*)"/g) ?? []).length;
  const actions = [...src.matchAll(/<form\b([^>]*)>/g)].filter((m) => /\baction="/.test(m[1])).length;
  links += hrefs + actions;
  console.log(`master ${f}: startTags=${n} links=${hrefs + actions}`);
}
console.log(`master VIEW_START_TAGS=${total} TEMPLATE_LINKS=${links}`);
const css = show('public/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
console.log(`master app.css decls=${[...css.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+);/g)].length} refs=${[...css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].length}`);
