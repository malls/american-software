#!/usr/bin/env node
// Build an Artifact-ready single file from the AS-30 core-loop wireframes.
//
// The wireframes (docs/design/wireframes/) are seven static, zero-JS HTML
// screens plus an index, sharing wireframe.css and the AS-29 tokens. They are
// the spec engineering builds from — this script does NOT redesign them. It
// stacks the eight pages into one document (the Artifact is a single page and
// its CSP blocks external stylesheets), inlines the two stylesheets, and
// rewrites the cross-page links so they still resolve inside one page.
//
// Deliberately zero-dependency and string-based, like the brand-artifact
// builder: the inputs are files we control. Every assumption this script makes
// about the source (one shared `id="main"` per screen, screen-prefixed state
// ids, seven screens) is checked, and a broken assumption throws rather than
// publishing a half-page — see the throw sites.
//
// Usage: node build.mjs <design-dir> <out-file>
//   design-dir  the docs/design directory to read (master or a worktree)
//   out-file    where to write the artifact-ready HTML

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , designDirArg, outFileArg] = process.argv;
if (!designDirArg || !outFileArg) {
  console.error('usage: node build.mjs <design-dir> <out-file>');
  process.exit(2);
}

const designDir = resolve(designDirArg);
const outFile = resolve(outFileArg);
const wfDir = join(designDir, 'wireframes');

// Where the written spec lives once merged. The .md links in the pages are
// relative and would dangle inside an Artifact; they become GitHub links.
const REPO_BLOB = 'https://github.com/malls/american-software/blob/master/docs/design/wireframes/';

// The v1 screen budget landed at exactly seven (milestone plan §4.3, AS-30
// plan §4). A different count is a material change to the product surface,
// not something to paper over silently.
const EXPECTED_SCREENS = 7;

const paths = {
  tokens: join(designDir, 'tokens', 'tokens.css'),
  css: join(wfDir, 'wireframe.css'),
  index: join(wfDir, 'index.html'),
};
for (const [name, p] of Object.entries(paths)) {
  if (!existsSync(p)) {
    throw new Error(`missing ${name}: ${p}\nIs AS-30 merged, or should you point at a worktree's docs/design?`);
  }
}

const screenFiles = readdirSync(wfDir)
  .filter((f) => /^screen-\d+-.*\.html$/.test(f))
  .sort((a, b) => Number(a.match(/^screen-(\d+)/)[1]) - Number(b.match(/^screen-(\d+)/)[1]));
if (screenFiles.length !== EXPECTED_SCREENS) {
  throw new Error(`found ${screenFiles.length} screen-*.html files, expected ${EXPECTED_SCREENS} — the screen budget changed; update EXPECTED_SCREENS deliberately`);
}

const tokensCss = readFileSync(paths.tokens, 'utf8');
const wireframeCss = readFileSync(paths.css, 'utf8');

// An empty stylesheet would publish an unstyled page with no error — the
// vacuous-pass class this repo keeps meeting. Refuse instead.
const FLOOR = 2000;
for (const [name, css] of [['tokens.css', tokensCss], ['wireframe.css', wireframeCss]]) {
  if (css.trim().length < FLOOR) {
    throw new Error(`${name} is ${css.trim().length} bytes, below the ${FLOOR}-byte floor — refusing to publish an unstyled page`);
  }
}

const bodyOf = (html, label) => {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (!m) throw new Error(`no <body>…</body> in ${label}`);
  const body = m[1].trim();
  if (body.length < 1000) throw new Error(`${label} body is only ${body.length} bytes — markers probably drifted`);
  return body;
};
const titleOf = (html, label) => {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) throw new Error(`no <title> in ${label}`);
  // "Screen 4 — Invoice create/edit — AS-30 wireframes" -> "Screen 4 — Invoice create/edit"
  return m[1].trim().replace(/\s+—\s+AS-30 wireframes\s*$/, '');
};

// Link rewriting shared by the index and the screens:
//   screen-N-slug.html#X  -> #X          (state ids are screen-prefixed, so unique)
//   screen-N-slug.html    -> #screen-N
//   NN-something.md       -> GitHub blob URL
const rewriteLinks = (html) => html
  .replace(/href="screen-(\d+)-[^"#]*\.html#([^"]+)"/g, 'href="#$2"')
  .replace(/href="screen-(\d+)-[^"#]*\.html"/g, 'href="#screen-$1"')
  .replace(/href="(\d{2}-[^"#/]+\.md)(#[^"]*)?"/g, (_, file, frag) => `href="${REPO_BLOB}${file}${frag || ''}"`);

const screens = screenFiles.map((file) => {
  const n = Number(file.match(/^screen-(\d+)/)[1]);
  const html = readFileSync(join(wfDir, file), 'utf8');
  let body = bodyOf(html, file);

  // Each page has exactly one landmark `id="main"` and its skip link. Stacked,
  // those collide; namespace them per screen. Anything else that collides is a
  // real change to the source, caught by the duplicate-id check below.
  const mainCount = (body.match(/\sid="main"/g) || []).length;
  if (mainCount !== 1) throw new Error(`${file}: expected exactly one id="main", found ${mainCount}`);
  body = body
    .replace(/\sid="main"/, ` id="screen-${n}-main"`)
    .replace(/href="#main"/g, `href="#screen-${n}-main"`);
  body = rewriteLinks(body);

  return { n, file, title: titleOf(html, file), body };
});

const indexHtml = readFileSync(paths.index, 'utf8');
const indexBody = rewriteLinks(bodyOf(indexHtml, 'index.html'));

// Artifact-only shim: the minimum needed to stack eight pages into one — a
// section boundary per screen and a jump list. Tokens only, no new palette,
// no new type. It is not part of the wireframes and must not be copied back.
const shimCss = `
/* ------------------------------------------------------------------ *
 * Artifact-only shim (wireframe-artifact skill). Stacks the eight
 * source pages into one document. Not part of the wireframes; a fix
 * belongs in docs/design/wireframes/, not here.
 * ------------------------------------------------------------------ */
.wfa-screen { position: relative; border-top: var(--border-width-hairline, 1px) solid var(--color-border-default); margin-top: var(--space-10, 4rem); padding-top: var(--space-6, 2rem); }
.wfa-screen__label { font-family: var(--font-family-mono); font-size: var(--font-size-xs, 0.75rem); letter-spacing: 0.06em; text-transform: uppercase; color: var(--color-text-subtle); margin: 0 0 var(--space-4, 1rem); }
.wfa-jump { display: flex; flex-wrap: wrap; gap: var(--space-2, 0.5rem); list-style: none; padding: 0; margin: var(--space-4, 1rem) 0 0; }
.wfa-jump a { font-family: var(--font-family-mono); font-size: var(--font-size-sm, 0.875rem); }
`;

const jumpList = `<nav class="container" aria-label="Jump to a screen">
  <ul class="wfa-jump">
${screens.map((s) => `    <li><a href="#screen-${s.n}">${s.title}</a></li>`).join('\n')}
  </ul>
</nav>`;

const screenSections = screens.map((s) => `
<section class="wfa-screen" id="screen-${s.n}" aria-label="${s.title.replace(/"/g, '&quot;')}">
  <div class="container"><p class="wfa-screen__label">${s.file} · <a href="${REPO_BLOB}${s.file}">source</a></p></div>
${s.body}
</section>`).join('\n');

// The publish wrapper injects <!doctype>, <html>, <head> and <body>, so the
// file is page CONTENT: a <title>, a <style>, then the markup.
const out = `<title>D1 Core-Loop Wireframes</title>
<style>
/* ------------------------------------------------------------------ *
 * Inlined from docs/design/tokens/tokens.css — generated, do not edit
 * here. Edit BRANDING.md, then re-run the brand pipeline.
 * ------------------------------------------------------------------ */
${tokensCss}
/* ------------------------------------------------------------------ *
 * Inlined from docs/design/wireframes/wireframe.css
 * ------------------------------------------------------------------ */
${wireframeCss}
${shimCss}
</style>
${indexBody}
${jumpList}
${screenSections}
`;

// Post-conditions on the assembled page, each reported with its cardinality
// so a green result is a statement about something that was actually counted.
const ids = [...out.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const dupes = [...ids.reduce((m, id) => m.set(id, (m.get(id) || 0) + 1), new Map())].filter(([, c]) => c > 1);
if (dupes.length) throw new Error(`duplicate ids after stacking: ${dupes.map(([id, c]) => `${id}×${c}`).join(', ')}`);

const relativeLinks = [...out.matchAll(/href="((?:\.\.\/|screen-\d+-)[^"]*|[^"#:]*\.(?:html|md|css))"/g)].map((m) => m[1]);
if (relativeLinks.length) throw new Error(`unrewritten relative links: ${[...new Set(relativeLinks)].join(', ')}`);

const fragmentTargets = [...out.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
const idSet = new Set(ids);
const dangling = [...new Set(fragmentTargets.filter((t) => !idSet.has(t)))];
if (dangling.length) throw new Error(`in-page anchors with no target: ${dangling.join(', ')}`);

const externalLoads = [...out.matchAll(/<(?:link|script|img|iframe)\b[^>]*>/gi)].map((m) => m[0]);
if (externalLoads.length) throw new Error(`page would load external resources: ${externalLoads.slice(0, 3).join(' ')}`);

writeFileSync(outFile, out);

const kb = (n) => `${(n / 1024).toFixed(1)}kB`;
console.log(`wrote ${outFile}`);
console.log(`  screens       : ${screens.length} (${screens.map((s) => s.n).join(',')})`);
console.log(`  ids           : ${ids.length} unique, 0 duplicates`);
console.log(`  in-page links : ${fragmentTargets.length}, 0 dangling`);
console.log(`  tokens.css    : ${kb(tokensCss.length)}`);
console.log(`  wireframe.css : ${kb(wireframeCss.length)}`);
console.log(`  total         : ${kb(out.length)}`);
