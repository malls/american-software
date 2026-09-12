#!/usr/bin/env node
// Build the D1 demo artifact page (AS-90) from the committed capture in
// docs/demo/d1/: the transcript of one real run, five screenshots of screen 1,
// and capture.json. The artifact is a PROJECTION of that directory, never the
// record — a fix belongs in apps/invoicing/demo/run.mjs (transcript) or in a
// re-capture (screenshots), not here.
//
// Zero-dependency and string-based, like the two precedents (brand-artifact,
// wireframe-artifact). Inlines docs/design/tokens/tokens.css plus a small page
// stylesheet that uses only var(--token) references; embeds each PNG as a
// data:image/png;base64 <img> (open question Q1 in the plan: if the Artifact
// CSP blocks data: images, the PNGs are still committed and the <img src>
// becomes their GitHub raw URL). Emits the precedents' shape — <title>,
// <style>, markup — because the publish wrapper supplies <!doctype>/<html>/
// <head>/<body>.
//
// It THROWS rather than publishing a half-page when: the transcript lacks the
// CAN/CANNOT block byte-for-byte (SHA-256 below), a step header has no label
// line under it, the label and header counts disagree, the transcript does not
// end with the epilogue sentence, any of the five PNGs is missing or empty, or
// tokens.css is below its byte floor. Each check prints its cardinality.
//
// Usage: node build.mjs <repo-root> <out-file>

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , rootArg, outArg] = process.argv;
if (!rootArg || !outArg) {
  console.error('usage: node build.mjs <repo-root> <out-file>');
  process.exit(2);
}
const root = resolve(rootArg);
const outFile = resolve(outArg);
const demoDir = join(root, 'docs', 'demo', 'd1');

const TITLE = 'D1 demo — core loop walkthrough';

/** SHA-256 of the CAN/CANNOT block exactly as apps/invoicing/demo/run.mjs
 *  prints it (the single source). A changed word anywhere in the block changes
 *  this digest and the build refuses — the block on the page is never allowed
 *  to drift from the one the demo prints. Update BOTH when the block changes
 *  deliberately (run.mjs, then this constant), never one without the other. */
const BLOCK_START = 'WHAT THIS DEMO CAN SHOW';
const BLOCK_END = "  state machine, not Stripe's delivery.";
const BLOCK_SHA256 = '9c6f399beef1fc39713a66be22a5aec35ad577f1ef7164ad42d770a0b1d46d75';
const EPILOGUE_SENTENCE = 'None of these creates a charge, a payment intent, or a transfer; the platform key never touches money.';

const LABELS = Object.freeze({
  'REAL APP BEHAVIOUR': { cls: 'app', what: "the app's own code did this; it would do the same against real Stripe" },
  'STRIPE-MOCK STAND-IN': { cls: 'mock', what: "Stripe's request validator answered with a fixture; real Stripe would answer with real data" },
  'SYNTHESIZED EVENT': { cls: 'event', what: 'we built and signed this event ourselves; it proves our receiver and state machine, not Stripe\'s delivery' },
});

const SCREENSHOTS = [
  { file: 'screen-1-signin-375.png', state: 'S1-DEFAULT-SIGNIN', width: 375, mode: 'sign in' },
  { file: 'screen-1-signin-1280.png', state: 'S1-DEFAULT-SIGNIN', width: 1280, mode: 'sign in' },
  { file: 'screen-1-signup-375.png', state: 'S1-DEFAULT-SIGNUP', width: 375, mode: 'sign up' },
  { file: 'screen-1-signup-1280.png', state: 'S1-DEFAULT-SIGNUP', width: 1280, mode: 'sign up' },
  { file: 'screen-1-error-validation-375.png', state: 'S1-ERROR-VALIDATION', width: 375, mode: 'sign in, submitted with the password blank' },
];

// --- inputs ---------------------------------------------------------------------

const paths = {
  transcript: join(demoDir, 'transcript.txt'),
  capture: join(demoDir, 'capture.json'),
  tokens: join(root, 'docs', 'design', 'tokens', 'tokens.css'),
};
for (const [name, p] of Object.entries(paths)) {
  if (!existsSync(p)) throw new Error(`missing ${name}: ${p}`);
}
const transcript = readFileSync(paths.transcript, 'utf8');
const capture = JSON.parse(readFileSync(paths.capture, 'utf8'));
const tokensCss = readFileSync(paths.tokens, 'utf8');

const FLOOR = 2000;
if (tokensCss.trim().length < FLOOR) {
  throw new Error(`tokens.css is ${tokensCss.trim().length} bytes, below the ${FLOOR}-byte floor — refusing to publish an unstyled page`);
}

// --- the CAN/CANNOT block, verbatim ---------------------------------------------

const blockStart = transcript.indexOf(BLOCK_START);
if (blockStart < 0) throw new Error('transcript lacks the CAN/CANNOT block');
const blockEndIdx = transcript.indexOf(BLOCK_END, blockStart);
if (blockEndIdx < 0) throw new Error('transcript lacks the end of the CAN/CANNOT block');
const block = transcript.slice(blockStart, blockEndIdx + BLOCK_END.length);
const digest = createHash('sha256').update(block, 'utf8').digest('hex');
if (digest !== BLOCK_SHA256) {
  throw new Error(`CAN/CANNOT block digest mismatch: got ${digest}, expected ${BLOCK_SHA256} — the block in transcript.txt differs from the one this script was pinned to; fix run.mjs or update BLOCK_SHA256 deliberately`);
}
const blockBullets = block.split('\n').filter((l) => l.startsWith('- ')).length;
console.log(`CAN/CANNOT block: ${block.split('\n').length} lines, ${blockBullets} bullets, digest ok`);

// --- the epilogue -----------------------------------------------------------------

if (transcript.trimEnd().split('\n').pop() !== EPILOGUE_SENTENCE) {
  throw new Error('transcript does not end with the epilogue sentence — a truncated or stopped run is not publishable');
}
if (transcript.includes('\nSTOPPED at step')) throw new Error('transcript records a STOPPED run');

// --- steps and labels -------------------------------------------------------------

const lines = transcript.split('\n');
const headerIdx = lines.map((l, i) => (/^\[[0-9]+b?\/12\] /.test(l) ? i : -1)).filter((i) => i >= 0);
const labelLines = lines.filter((l) => Object.hasOwn(LABELS, l)).length;
for (const i of headerIdx) {
  if (!Object.hasOwn(LABELS, lines[i + 1])) throw new Error(`step without label: ${JSON.stringify(lines[i])} is followed by ${JSON.stringify(lines[i + 1])}`);
}
if (headerIdx.length !== labelLines) {
  throw new Error(`step headers (${headerIdx.length}) and label lines (${labelLines}) disagree — a label line outside a step`);
}
if (headerIdx.length !== 13) throw new Error(`expected 13 steps (12 + 11b), found ${headerIdx.length}`);
console.log(`steps: ${headerIdx.length} headers, ${labelLines} labels, each header labelled`);

// --- screenshots ----------------------------------------------------------------------

const images = SCREENSHOTS.map((s) => {
  const p = join(demoDir, s.file);
  if (!existsSync(p)) throw new Error(`missing screenshot ${p}`);
  const bytes = statSync(p).size;
  if (bytes === 0) throw new Error(`empty screenshot ${p}`);
  const recorded = (capture.captures ?? []).find((c) => c.file === s.file);
  if (!recorded || recorded.state !== s.state || recorded.width !== s.width) {
    throw new Error(`capture.json does not record ${s.file} as ${s.state} at ${s.width}px — re-run capture.mjs`);
  }
  return { ...s, bytes, dataUri: `data:image/png;base64,${readFileSync(p).toString('base64')}` };
});
console.log(`screenshots: ${images.length} of ${SCREENSHOTS.length}, ${images.reduce((n, i) => n + i.bytes, 0)} bytes total`);

// --- render ---------------------------------------------------------------------------

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const transcriptHtml = lines.map((l) => {
  if (Object.hasOwn(LABELS, l)) return `<span class="d1-chip d1-chip--${LABELS[l].cls}">${esc(l)}</span>`;
  if (/^\[[0-9]+b?\/12\] /.test(l)) return `<span class="d1-step">${esc(l)}</span>`;
  return esc(l);
}).join('\n');

const legend = Object.entries(LABELS)
  .map(([label, { cls, what }]) => `<li><span class="d1-chip d1-chip--${cls}">${esc(label)}</span> ${esc(what)}.</li>`)
  .join('\n');

const figures = images.map((i) => `<figure class="d1-shot d1-shot--${i.width}">
<img src="${i.dataUri}" width="${i.width}" alt="Screen 1 in state ${i.state} at ${i.width}px: ${esc(i.mode)}">
<figcaption><code>${esc(i.state)}</code> — ${i.width}px, ${esc(i.mode)}</figcaption>
</figure>`).join('\n');

const css = `
.d1 { max-width: 72rem; margin: 0 auto; padding: var(--space-8) var(--space-6); font-family: var(--font-family-sans); color: var(--color-text-primary); background: var(--color-bg-canvas); line-height: var(--line-height-relaxed); }
.d1 h1 { font-size: var(--font-size-3xl); line-height: var(--line-height-3xl); margin: 0 0 var(--space-2); }
.d1 h2 { font-size: var(--font-size-xl); line-height: var(--line-height-xl); margin: var(--space-10) 0 var(--space-3); }
.d1 .d1-sub { color: var(--color-text-secondary); margin: 0 0 var(--space-6); }
.d1 pre { font-family: var(--font-family-mono); font-size: var(--font-size-sm); line-height: var(--line-height-sm); background: var(--color-bg-surface); border: var(--border-width-hairline) solid var(--color-border-hairline); border-radius: var(--radius-md); padding: var(--space-4); overflow-x: auto; white-space: pre-wrap; }
.d1 .d1-block { border-color: var(--color-border-interactive); }
.d1 .d1-made { color: var(--color-text-secondary); font-size: var(--font-size-sm); }
.d1 .d1-made code, .d1 figcaption code { font-family: var(--font-family-mono); font-size: var(--font-size-xs); }
.d1 .d1-shots { display: flex; flex-wrap: wrap; gap: var(--space-6); align-items: flex-start; }
.d1 figure { margin: 0; background: var(--color-bg-surface); border: var(--border-width-hairline) solid var(--color-border-hairline); border-radius: var(--radius-md); padding: var(--space-3); }
.d1 figure img { display: block; max-width: 100%; height: auto; border: var(--border-width-hairline) solid var(--color-border-hairline); }
.d1 .d1-shot--375 { flex: 0 1 24rem; }
.d1 .d1-shot--1280 { flex: 1 1 40rem; }
.d1 figcaption { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-top: var(--space-2); }
.d1 .d1-legend { list-style: none; padding: 0; margin: 0 0 var(--space-4); display: grid; gap: var(--space-2); }
.d1 .d1-chip { display: inline-block; font-family: var(--font-family-mono); font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold); padding: 0 var(--space-2); border-radius: var(--radius-sm); line-height: var(--line-height-sm); }
.d1 .d1-chip--app { background: var(--color-success-bg-subtle); color: var(--color-success-text-on-subtle); }
.d1 .d1-chip--mock { background: var(--color-warning-bg-subtle); color: var(--color-warning-text-on-subtle); }
.d1 .d1-chip--event { background: var(--color-accent-bg-subtle); color: var(--color-accent-text-on-subtle); }
.d1 .d1-step { font-weight: var(--font-weight-bold); color: var(--color-text-primary); }
`;

const made = capture;
const out = `<title>${esc(TITLE)}</title>
<style>
/* Inlined from docs/design/tokens/tokens.css — generated, do not edit here. */
${tokensCss}
/* Page stylesheet for the D1 demo artifact (token references only). */
${css}
</style>
<main class="d1">
<h1>${esc(TITLE)}</h1>
<p class="d1-sub">One real run of <code>apps/invoicing/demo/run.mjs</code>, plus screen 1 in a real browser. Read the first block before anything else.</p>
<pre class="d1-block">${esc(block)}</pre>

<h2>How this was made</h2>
<p class="d1-made">Transcript: <code>cd apps/invoicing &amp;&amp; DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build demo &amp;&amp; docker compose down</code> — the shipped image, next to stripe-mock, no internet route, a fresh database file. Screenshots: the host's ${esc(made.chrome ?? 'Chrome')} over the DevTools protocol against a running <code>web</code> (${esc(made.method ?? 'cdp')}), captured ${esc(made.capturedAt ?? '')} at branch commit <code>${esc(made.branchCommit ?? '?')}</code>; screen 1 as merged in <code>${esc(made.screen1MergeCommit ?? '95b5ee5')}</code>. Source of record: <code>docs/demo/d1/</code>.</p>

<h2>Screen 1 — sign in / sign up</h2>
<div class="d1-shots">
${figures}
</div>

<h2>Transcript</h2>
<ul class="d1-legend">
${legend}
</ul>
<pre class="d1-transcript">${transcriptHtml}</pre>
</main>
`;

writeFileSync(outFile, out);
const kb = (n) => `${(n / 1024).toFixed(1)}kB`;
console.log(`wrote ${outFile}`);
console.log(`  tokens.css : ${kb(tokensCss.length)}`);
console.log(`  transcript : ${lines.length} lines`);
console.log(`  images     : ${kb(images.reduce((n, i) => n + i.dataUri.length, 0))} as data URIs`);
console.log(`  total      : ${kb(out.length)}`);
