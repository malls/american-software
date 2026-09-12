#!/usr/bin/env node
// Build the D1 demo artifact page (AS-90, re-captured for all seven screens
// under AS-130) from the committed capture in docs/demo/d1/: the transcript of
// one real run, the screenshots of the seven screens, and capture.json. The
// artifact is a PROJECTION of that directory, never the record — a fix belongs
// in apps/invoicing/demo/run.mjs (transcript) or in a re-capture (screenshots),
// not here.
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
// end with the epilogue sentence, any PNG is missing or empty, capture.json
// disagrees with a file, or tokens.css is below its byte floor. Each check
// prints its cardinality.
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
const BLOCK_SHA256 = '4021fa1c3d7ee56321c0b1e7acfb5406904e3e3c8c9964bd97596b2848cb3f3f';
const EPILOGUE_SENTENCE = 'None of these creates a charge, a payment intent, or a transfer; the platform key never touches money.';

const LABELS = Object.freeze({
  'REAL APP BEHAVIOUR': { cls: 'app', what: "the app's own code did this; it would do the same against real Stripe" },
  'STRIPE-MOCK STAND-IN': { cls: 'mock', what: "Stripe's request validator answered with a fixture; real Stripe would answer with real data" },
  'SYNTHESIZED EVENT': { cls: 'event', what: 'we built and signed this event ourselves; it proves our receiver and state machine, not Stripe\'s delivery' },
});

/** The screenshots, grouped by screen in screen order; within a screen, in the
 *  order the walk reached them. `mode` is the caption; `layer` and `media`
 *  must match what capture.json recorded for the file. */
const SCREENS = [
  { n: 1, title: 'sign in / sign up', shots: [
    { file: 'screen-1-signin-375.png', state: 'S1-DEFAULT-SIGNIN', width: 375, mode: 'sign in' },
    { file: 'screen-1-signin-1280.png', state: 'S1-DEFAULT-SIGNIN', width: 1280, mode: 'sign in' },
    { file: 'screen-1-signup-375.png', state: 'S1-DEFAULT-SIGNUP', width: 375, mode: 'sign up' },
    { file: 'screen-1-signup-1280.png', state: 'S1-DEFAULT-SIGNUP', width: 1280, mode: 'sign up' },
    { file: 'screen-1-error-validation-375.png', state: 'S1-ERROR-VALIDATION', width: 375, mode: 'sign in, submitted with the password blank' },
  ] },
  { n: 2, title: 'Connect Stripe', shots: [
    { file: 'screen-2-default-notstarted-375.png', state: 'S2-DEFAULT-NOTSTARTED', width: 375, mode: 'before onboarding starts' },
    { file: 'screen-2-default-notstarted-1280.png', state: 'S2-DEFAULT-NOTSTARTED', width: 1280, mode: 'before onboarding starts' },
    { file: 'screen-2-return-notready-375.png', state: 'S2-RETURN-NOTREADY', width: 375, mode: 'after the return from onboarding — the validator\'s account fixture is not ready' },
    { file: 'screen-2-return-notready-1280.png', state: 'S2-RETURN-NOTREADY', width: 1280, mode: 'after the return from onboarding — the validator\'s account fixture is not ready' },
    { file: 'screen-2-return-ready-375.png', state: 'S2-RETURN-READY', width: 375, mode: 'ready as recorded from an event we signed' },
    { file: 'screen-2-return-ready-1280.png', state: 'S2-RETURN-READY', width: 1280, mode: 'ready as recorded from an event we signed' },
  ] },
  { n: 3, title: 'dashboard', shots: [
    { file: 'screen-3-empty-firstrun-375.png', state: 'S3-EMPTY-FIRSTRUN', width: 375, layer: 'S3-GATED-STRIPENOTREADY', mode: 'first run, nothing created yet; the Stripe gate layered on' },
    { file: 'screen-3-empty-firstrun-1280.png', state: 'S3-EMPTY-FIRSTRUN', width: 1280, layer: 'S3-GATED-STRIPENOTREADY', mode: 'first run, nothing created yet; the Stripe gate layered on' },
    { file: 'screen-3-default-populated-375.png', state: 'S3-DEFAULT-POPULATED', width: 375, mode: 'at the end of the walk: the contract and the paid invoice' },
    { file: 'screen-3-default-populated-1280.png', state: 'S3-DEFAULT-POPULATED', width: 1280, mode: 'at the end of the walk: the contract and the paid invoice' },
  ] },
  { n: 4, title: 'invoice form', shots: [
    { file: 'screen-4-gated-stripenotready-375.png', state: 'S4-GATED-STRIPENOTREADY', width: 375, mode: 'refused before the account is ready' },
    { file: 'screen-4-gated-stripenotready-1280.png', state: 'S4-GATED-STRIPENOTREADY', width: 1280, mode: 'refused before the account is ready' },
    { file: 'screen-4-default-create-375.png', state: 'S4-DEFAULT-CREATE', width: 375, mode: 'new invoice' },
    { file: 'screen-4-default-create-1280.png', state: 'S4-DEFAULT-CREATE', width: 1280, mode: 'new invoice' },
    { file: 'screen-4-error-validation-375.png', state: 'S4-ERROR-VALIDATION', width: 375, mode: 'saved with the line-item description blank' },
    { file: 'screen-4-default-edit-375.png', state: 'S4-DEFAULT-EDIT', width: 375, mode: 'editing the draft' },
    { file: 'screen-4-default-edit-1280.png', state: 'S4-DEFAULT-EDIT', width: 1280, mode: 'editing the draft' },
  ] },
  { n: 5, title: 'invoice detail', shots: [
    { file: 'screen-5-default-draft-375.png', state: 'S5-DEFAULT-DRAFT', width: 375, mode: 'draft' },
    { file: 'screen-5-default-draft-1280.png', state: 'S5-DEFAULT-DRAFT', width: 1280, mode: 'draft' },
    { file: 'screen-5-default-open-375.png', state: 'S5-DEFAULT-OPEN', width: 375, mode: 'issued and sent — the validator\'s fixture answered' },
    { file: 'screen-5-default-open-1280.png', state: 'S5-DEFAULT-OPEN', width: 1280, mode: 'issued and sent — the validator\'s fixture answered' },
    { file: 'screen-5-default-paid-375.png', state: 'S5-DEFAULT-PAID', width: 375, mode: 'paid by an event we signed' },
    { file: 'screen-5-default-paid-1280.png', state: 'S5-DEFAULT-PAID', width: 1280, mode: 'paid by an event we signed' },
  ] },
  { n: 6, title: 'contract form', shots: [
    { file: 'screen-6-default-375.png', state: 'S6-DEFAULT', width: 375, mode: 'new contract' },
    { file: 'screen-6-default-1280.png', state: 'S6-DEFAULT', width: 1280, mode: 'new contract' },
    { file: 'screen-6-error-validation-375.png', state: 'S6-ERROR-VALIDATION', width: 375, mode: 'generated with the project description blank' },
  ] },
  { n: 7, title: 'contract detail', shots: [
    { file: 'screen-7-default-375.png', state: 'S7-DEFAULT', width: 375, mode: 'the generated document' },
    { file: 'screen-7-default-1280.png', state: 'S7-DEFAULT', width: 1280, mode: 'the generated document' },
    { file: 'screen-7-default-1280-print.png', state: 'S7-DEFAULT', width: 1280, media: 'print', mode: 'the generated document, print view' },
  ] },
];
const SCREENSHOTS = SCREENS.flatMap((s) => s.shots.map((shot) => ({ ...shot, screen: s.n })));

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

// The block is everything from BLOCK_START to the first empty line (run.mjs
// prints it as one paragraph, then a blank line). Sliced to a fixed last line,
// as the first version did, a bullet appended after that line passed the
// digest and was missing from the page (AS-90 review, F3).
const blockStart = transcript.indexOf(BLOCK_START);
if (blockStart < 0) throw new Error('transcript lacks the CAN/CANNOT block');
const blockEndIdx = transcript.indexOf('\n\n', blockStart);
if (blockEndIdx < 0) throw new Error('transcript lacks the end of the CAN/CANNOT block (no empty line after it)');
const block = transcript.slice(blockStart, blockEndIdx);
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
  if (!recorded || recorded.state !== s.state || recorded.width !== s.width || (recorded.layer ?? null) !== (s.layer ?? null) || (recorded.media ?? null) !== (s.media ?? null)) {
    throw new Error(`capture.json does not record ${s.file} as ${s.state} at ${s.width}px${s.layer ? ` with layer ${s.layer}` : ''}${s.media ? ` under ${s.media} media` : ''} — re-run capture.mjs`);
  }
  return { ...s, bytes, dataUri: `data:image/png;base64,${readFileSync(p).toString('base64')}` };
});
const recordedCount = (capture.captures ?? []).length;
if (recordedCount !== SCREENSHOTS.length) {
  throw new Error(`capture.json records ${recordedCount} captures, this script lays out ${SCREENSHOTS.length} — the two lists disagree`);
}
console.log(`screenshots: ${images.length} of ${SCREENSHOTS.length}, ${images.reduce((n, i) => n + i.bytes, 0)} bytes total, ${SCREENS.length} screens`);

const merges = capture.screenMergeCommits ?? {};
for (const s of SCREENS) {
  if (typeof merges[s.n] !== 'string' || merges[s.n] === '') throw new Error(`capture.json names no merge commit for screen ${s.n}`);
}

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

const figure = (i) => {
  const media = i.media ? `, emulated ${i.media} media` : '';
  const layer = i.layer ? ` (layer <code>${esc(i.layer)}</code>)` : '';
  return `<figure class="d1-shot d1-shot--${i.width}">
<img src="${i.dataUri}" width="${i.width}" alt="Screen ${i.screen} in state ${i.state} at ${i.width}px${media}: ${esc(i.mode)}">
<figcaption><code>${esc(i.state)}</code>${layer} — ${i.width}px${esc(media)}, ${esc(i.mode)}</figcaption>
</figure>`;
};

const screenSections = SCREENS.map((s) => `<h2>Screen ${s.n} — ${esc(s.title)}</h2>
<p class="d1-made">As merged in <code>${esc(merges[s.n])}</code>.</p>
<div class="d1-shots">
${images.filter((i) => i.screen === s.n).map(figure).join('\n')}
</div>`).join('\n\n');

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
<p class="d1-sub">One real run of <code>apps/invoicing/demo/run.mjs</code>, plus all seven screens in a real browser, in the states that same walk reaches. Read the first block before anything else.</p>
<pre class="d1-block">${esc(block)}</pre>

<h2>How this was made</h2>
<p class="d1-made">Transcript: <code>cd apps/invoicing &amp;&amp; DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build demo &amp;&amp; docker compose down</code> — the shipped image, next to stripe-mock, no internet route, a fresh database file. Screenshots: the host's ${esc(made.chrome ?? 'Chrome')} over the DevTools protocol (${esc(made.method ?? 'cdp')}) against the ${esc(made.target ?? 'demo service')} — the same shipped image and the same placeholder key beside the same validator, driven through the demo's own requests from the browser, with the two events signed by us — captured ${esc(made.capturedAt ?? '')} at branch commit <code>${esc(made.branchCommit ?? '?')}</code>. Each screen's section names the commit it was merged in. Source of record: <code>docs/demo/d1/</code>.</p>

${screenSections}

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
