// AS-126 planning spike (cto-owen). Runs the favicon subset of api.test.js on the
// detached scratch copy /tmp/AS-126-plan against mutated favicon.svg, with and
// without the candidate T5 test. Never touches the main checkout.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const S = '/tmp/AS-126-plan';
const SVG = `${S}/apps/chat/public/favicon.svg`;
const TEST = `${S}/apps/chat/test/api.test.js`;
const svg0 = readFileSync(SVG, 'utf8');
const test0 = readFileSync(TEST, 'utf8');

const T5 = `
test('api: AS-126 — the favicon carries no filter element or filter= attribute', async (t) => {
  const { base } = await bootServer(t);
  const svg = await (await fetch(base + '/favicon.svg')).text();
  const artwork = svg.replace(/<!--[\\s\\S]*?-->/g, '');
  assert.ok(artwork.includes('<svg'), 'the body is an SVG document (cardinality before absence)');
  const door = /<filter[\\s\\/>]|\\sfilter\\s*=/i.exec(artwork);
  assert.ok(!door, \`the artwork carries no filter element or filter= attribute, found "\${door && door[0].trim()}"\`);
});
`;
const ANCHOR = "// --- AS-27: the advance-loop status endpoint";
const testT5 = test0.replace(ANCHOR, T5.trimStart() + '\n' + ANCHOR);
if (testT5 === test0) throw new Error('T5 anchor not found');

function run(label) {
  const r = spawnSync('node', ['--test', '--test-name-pattern', 'favicon', 'test/api.test.js'],
    { cwd: `${S}/apps/chat`, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = r.stdout + r.stderr;
  const sum = out.split('\n').filter((l) => /^ℹ (tests|pass|fail)/.test(l)).map((l) => l.replace('ℹ ', '')).join(' ');
  const tail = out.slice(out.indexOf('failing tests:'));
  const reds = [...new Set([...tail.matchAll(/^✖ api: (AS-\d+) — /gm)].map((m) => m[1]))];
  const msgs = [...tail.matchAll(/AssertionError \[ERR_ASSERTION\]: (.+)$/gm)].map((m) => m[1].slice(0, 120));
  console.log(`${label}\n  ${sum} exit=${r.status}\n  red=${JSON.stringify(reds)}\n  msg=${JSON.stringify(msgs)}`);
}

const A_C1 = '<circle fill="#FFFFFF" cx="9" cy="13" r="2.5"/>';
const A_PATH = '<path fill="#1C41E3" d=';
const mutants = {
  'P3 filter= drop-shadow on circle 1 (line 6)': (s) => s.replace(A_C1, '<circle fill="#FFFFFF" filter="drop-shadow(0 0 1px red)" cx="9" cy="13" r="2.5"/>'),
  'E1 <filter> element in <defs> + filter="url(#f)" on path': (s) => s.replace(A_PATH, '<defs><filter id="f"><feColorMatrix type="hueRotate" values="180"/></filter></defs>\n  <path fill="#1C41E3" filter="url(#f)" d='),
  'E2 <filter> element only, unreferenced': (s) => s.replace(A_PATH, '<filter id="f"><feDropShadow dx="0" dy="0" stdDeviation="1" flood-color="red"/></filter>\n  <path fill="#1C41E3" d='),
  'S1 style="filter:drop-shadow(...)" on circle 1': (s) => s.replace(A_C1, '<circle fill="#FFFFFF" style="filter:drop-shadow(0 0 1px red)" cx="9" cy="13" r="2.5"/>'),
  'S2 <style>circle{filter:drop-shadow(0 0 1px red)}</style>': (s) => s.replace(A_PATH, '<style>circle{filter:drop-shadow(0 0 1px red)}</style>\n  <path fill="#1C41E3" d='),
  'C1 FILTER= uppercase on circle 1': (s) => s.replace(A_C1, '<circle fill="#FFFFFF" FILTER="drop-shadow(0 0 1px red)" cx="9" cy="13" r="2.5"/>'),
  'C2 filter = "..." spaced on circle 1': (s) => s.replace(A_C1, '<circle fill="#FFFFFF" filter = "drop-shadow(0 0 1px red)" cx="9" cy="13" r="2.5"/>'),
  'C3 <FILTER> uppercase element': (s) => s.replace(A_PATH, '<FILTER id="f"></FILTER>\n  <path fill="#1C41E3" d='),
  'F1 feDropShadow primitive outside any <filter>': (s) => s.replace(A_PATH, '<feDropShadow dx="0" dy="0" stdDeviation="1" flood-color="red"/>\n  <path fill="#1C41E3" d='),
  'N1 color-interpolation-filters="linearRGB" on path (must stay GREEN)': (s) => s.replace(A_PATH, '<path color-interpolation-filters="linearRGB" fill="#1C41E3" d='),
  'N2 filter= inside an XML comment (must stay GREEN)': (s) => s.replace('<!-- AS-28', '<!-- filter="drop-shadow(0 0 1px red)" AS-28'),
  'N3 aria-label="filter=x" (in-value, must stay GREEN)': (s) => s.replace('aria-label="ASC Chat"', 'aria-label="ASC Chat filter=x"'),
  'N4 filter=\'...\' single-quoted on circle 1': (s) => s.replace(A_C1, "<circle fill=\"#FFFFFF\" filter='drop-shadow(0 0 1px red)' cx=\"9\" cy=\"13\" r=\"2.5\"/>"),
};

const which = process.argv[2] || 'all';
for (const [name, mut] of Object.entries(mutants)) {
  if (which !== 'all' && !name.startsWith(which)) continue;
  const s = mut(svg0);
  if (s === svg0) throw new Error(`mutation did not apply: ${name}`);
  for (const [tf, body] of [['master api.test.js', test0], ['with T5', testT5]]) {
    if (which === 'hole' && tf !== 'master api.test.js') continue;
    writeFileSync(SVG, s);
    writeFileSync(TEST, body);
    try { run(`[${tf}] ${name}`); } finally { writeFileSync(SVG, svg0); writeFileSync(TEST, test0); }
  }
}
writeFileSync(TEST, testT5);
try { run('[with T5] CONTROL unmutated favicon'); } finally { writeFileSync(TEST, test0); }
