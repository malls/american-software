// One-shot patch of test/api.test.js for AS-115: retarget four structural guards.
const fs = require('fs');
const path = process.argv[2];
let s = fs.readFileSync(path, 'utf8');
function rep(a, b) { if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); s = s.replace(a, b); }

// AS-26 guard: app.js reaches msg-refs.js through leaf-refs.js now.
rep("  assert.match(app, /from '\\.\\/msg-refs\\.js'/, 'body pipeline goes through msg-refs.js');",
`  // AS-115: the leaf chain moved to leaf-refs.js; app.js reaches msg-refs.js through it.
  assert.match(app, /from '\\.\\/leaf-refs\\.js'/, 'body pipeline goes through leaf-refs.js');
  const leafMod = await (await fetch(base + '/leaf-refs.js')).text();
  assert.match(leafMod, /from '\\.\\/msg-refs\\.js'/, 'leaf chain goes through msg-refs.js');`);

// AS-54 guard, structural half: order + terminality are now red-provable in test/leaf-refs.test.js.
const a54s = s.indexOf("  assert.match(app, /import \\{[^}]*tokenizeUrls[^}]*\\} from");
const a54e = s.indexOf('  // The anchor: verbatim href, no transformation between token and attribute.');
if (a54s < 0 || a54e < 0) throw new Error('AS-54 region not found');
s = s.slice(0, a54s) + `  // AS-115: the leaf chain (URL pass first, url tokens terminal) lives in
  // leaf-refs.js as the pure tokenizeLeaf; its order and terminality are
  // proven red in test/leaf-refs.test.js (T8/T11), not by reading control flow
  // here. This guard keeps the seam: app.js renders every leaf through it, the
  // URL pass still comes from markdown.js, and the markdown-link label opts out.
  const leafSrc = await (await fetch(base + '/leaf-refs.js')).text();
  assert.match(leafSrc, /import \\{[^}]*tokenizeUrls[^}]*\\} from '\\.\\/markdown\\.js'/,
    'the bare-URL pass comes from markdown.js — one scheme allowlist, one module');
  assert.ok(!/tokenizeUrls\\(/.test(app), 'app.js never runs the URL pass itself');
  assert.ok(app.includes('appendRefLeaf(a, tok.inner, refs, { autolink: false })'),
    'the markdown-link call site opts out of autolinking verbatim');
  const start = app.indexOf('function appendRefLeaf(');
  assert.ok(start !== -1, 'appendRefLeaf is present in the served app.js');
  const leaf = app.slice(start, app.indexOf('\\n}\\n', start));
  assert.match(leaf, /tokenizeLeaf\\(text, refs, opts\\)/, 'appendRefLeaf renders through tokenizeLeaf and forwards opts');

` + s.slice(a54e);

// AS-74 module count.
rep('  assert.equal(modules.length, 12,\n    `expected 12 served modules', '  assert.equal(modules.length, 14,\n    `expected 14 served modules');
rep('every served public/ module is free of markup sinks (12 examined)', 'every served public/ module is free of markup sinks (14 examined)');

// AS-72 timer scan: pin the copy chip's flash timer and exclude it from the cadence rules.
rep('  assert.equal(timers.length, 2, `exactly two timers in app.js (got ${timers.map((x) => x.kind).join(\', \')})`);',
`  // AS-115: the copy chip's "copied" flash is a UI timer, not a poll — pinned
  // to exactly one setTimeout(…, COPIED_MS) inside flashCopied() and excluded
  // from the cadence rules below.
  const flashAt = app.indexOf('function flashCopied(');
  assert.ok(flashAt !== -1, 'flashCopied is present');
  const flashEnd = app.indexOf('\\n}\\n', flashAt);
  const flash = timers.filter((x) => x.at > flashAt && x.at < flashEnd);
  assert.deepEqual(flash.map((x) => [x.kind, x.last]), [['setTimeout', 'COPIED_MS']],
    'the only flash timer is setTimeout(…, COPIED_MS) in flashCopied');
  const polls = timers.filter((x) => !flash.includes(x));
  assert.equal(polls.length, 2, \`exactly two poll timers in app.js (got \${polls.map((x) => x.kind).join(', ')})\`);`);
rep('  assert.deepEqual(\n    timers.map((x) => x.kind),', '  assert.deepEqual(\n    polls.map((x) => x.kind),');
rep('  for (const timer of timers) {\n    assert.ok(timer.at > initAt', '  for (const timer of polls) {\n    assert.ok(timer.at > initAt');
rep('  const ms = timers.map((timer) => {', '  const ms = polls.map((timer) => {');
s = s.replace(/callNames\(timers\[(\d)\]\.body\)/g, 'callNames(polls[$1].body)');
fs.writeFileSync(path, s);
console.log('patched');
