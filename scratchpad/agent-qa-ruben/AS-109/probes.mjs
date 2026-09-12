// AS-109 cycle-2 M6 probes — qa-ruben. Favicon-subset runs in the scratch
// worktree (test-name-pattern=favicon on api.test.js), not counted receipts.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const S = '/tmp/AS-109-mutant';
const SVG = `${S}/apps/chat/public/favicon.svg`;
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-109/probes.log';
const git = (...a) => spawnSync('git', ['-C', S, ...a], { encoding: 'utf8' });
const T3 = 'api: AS-28 — the favicon uses only palette hex values';
const T4 = 'api: AS-109 — the favicon carries no SMIL animation element';

const probes = [
  { name: 'P2 stroke-only <line>, all palette (honest edit)', expect: [T3], edit: (L) => L.splice(8, 0, '  <line x1="4" y1="28" x2="28" y2="28" stroke="#1C41E3" stroke-width="2"/>') },
  { name: 'P3 filter="drop-shadow(0 0 1px red)" on circle 1', expect: '?', edit: (L) => { L[5] = L[5].replace('r="2.5"/>', 'r="2.5" filter="drop-shadow(0 0 1px red)"/>'); } },
  { name: 'P4 paintless circle with aria-label="fill=x" (adversarial)', expect: '?', edit: (L) => L.splice(8, 0, '  <circle cx="16" cy="20" r="2" aria-label="fill=x"/>') },
  { name: "P5 <g fill='red'> wrapping the circles, own fills kept", expect: [T3], edit: (L) => { L.splice(8, 0, '  </g>'); L.splice(5, 0, "  <g fill='red'>"); } },
  { name: 'P6 FILL="#FFFFFF" uppercase attribute name on circle 1', expect: [T3], edit: (L) => { L[5] = L[5].replace('fill="#FFFFFF"', 'FILL="#FFFFFF"'); } },
  { name: 'P7 fill="currentColor" + color="red" on root', expect: [T3], edit: (L) => { L[5] = L[5].replace('fill="#FFFFFF"', 'fill="currentColor"'); L[0] = L[0].replace('<svg ', '<svg color="red" '); } },
  { name: 'P8 <svg fill="red"> root attribute, own fills kept', expect: [T3], edit: (L) => { L[0] = L[0].replace('<svg ', '<svg fill="red" '); } },
  { name: 'P9 shape inside an XML comment only', expect: [], edit: (L) => L.splice(8, 0, '  <!-- <circle cx="1" cy="1" r="1"/> -->') },
  { name: 'P10 circle 1 as open+close tag', expect: [], edit: (L) => { L[5] = L[5].replace('r="2.5"/>', 'r="2.5"></circle>'); } },
  { name: 'P11a <set> inside a comment', expect: [], edit: (L) => L.splice(8, 0, '  <!-- <set attributeName="fill" to="red"/> -->') },
  { name: 'P11b <SET> uppercase inside path', expect: [T4], edit: (L) => { L[4] = L[4].replace('4-4z"/>', '4-4z"><SET attributeName="fill" to="red"/></path>'); } },
  { name: 'P12 <linearGradient> + <stop stop-color="red"> in defs, fill="url(#g)" on circle 1', expect: [T3], edit: (L) => { L[5] = L[5].replace('fill="#FFFFFF"', 'fill="url(#g)"'); L.splice(4, 0, '  <defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs>'); } },
  { name: 'P13 <textPath> and <linearGradient> substrings do not count as shapes (4 real shapes removed to 3 -> floor)', expect: [T3], edit: (L) => { L.splice(7, 1); L.splice(7, 0, '  <defs><linearGradient id="g" fill="#FFFFFF"/><textPath href="#p" fill="#FFFFFF"/></defs>'); } },
  { name: 'P14 fill="#FFF" 3-digit (F6 record, safe direction)', expect: [T3], edit: (L) => { L[5] = L[5].replace('fill="#FFFFFF"', 'fill="#FFF"'); } },
  { name: 'P15 fill= present but empty value fill="" on circle 1', expect: [T3], edit: (L) => { L[5] = L[5].replace('fill="#FFFFFF"', 'fill=""'); } },
];

for (const p of probes) {
  const orig = readFileSync(SVG, 'utf8');
  const L = orig.split('\n');
  p.edit(L);
  const mutated = L.join('\n');
  assert.notEqual(mutated, orig, `${p.name}: no-op`);
  writeFileSync(SVG, mutated);
  assert.equal(git('diff', 'HEAD', '--name-only').stdout.trim(), 'apps/chat/public/favicon.svg');
  const r = spawnSync('node', ['--test', '--test-reporter=spec', '--test-name-pattern=favicon', 'test/api.test.js'], { cwd: `${S}/apps/chat`, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const red = []; const msgs = [];
  for (const l of out.split('\n')) {
    const mm = /^✖ (.+?) \(\d/.exec(l);
    if (mm && !red.includes(mm[1])) red.push(mm[1]);
    if (/^\s+AssertionError/.test(l)) msgs.push(l.trim());
  }
  const tests = Number((out.match(/ℹ tests (\d+)/) || [])[1]);
  git('checkout', 'HEAD', '--', '.');
  const clean = git('status', '--short').stdout.trim() === '';
  const match = p.expect === '?' ? '??' : (JSON.stringify(red) === JSON.stringify(p.expect) ? 'OK' : '!!');
  appendFileSync(LOG, JSON.stringify({ name: p.name, tests, red, msgs, expect: p.expect, match, clean }) + '\n');
  console.log(`${match.padEnd(3)} ${p.name}\n     tests=${tests} red=${JSON.stringify(red)} clean=${clean}`);
  for (const m of msgs) console.log('     ' + m.slice(0, 190));
  assert.ok(clean);
}
