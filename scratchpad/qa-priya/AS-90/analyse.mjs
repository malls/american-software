// scratchpad/qa-priya/AS-90/analyse.mjs — extract the transcript from a demo log,
// count labels/headers/stripe calls, normalise per plan §1.4 (+ UUID), diff.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = '/Users/forrest/Code/american-software-company/scratchpad/qa-priya/AS-90';
const extract = (log) => {
  const s = log.indexOf('D1 core-loop walkthrough (AS-90)');
  const endSentence = 'None of these creates a charge, a payment intent, or a transfer; the platform key never touches money.';
  const e = log.indexOf(endSentence, s);
  if (s < 0 || e < 0) throw new Error('transcript not found in log');
  return `${log.slice(s, e + endSentence.length)}\n`;
};
const planNorm = (t) => t
  .replace(/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g, '<ts>')
  .replace(/\b(t=)[0-9]+/g, '$1<t>')
  .replace(/v1=[0-9a-f]{64}/g, 'v1=<sig>')
  .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<ulid>')
  .replace(/\b(acct|cus|in|ii)_[A-Za-z0-9]+/g, '$1_<id>')
  .replace(/127\.0\.0\.1:[0-9]+/g, '127.0.0.1:<port>');
const uuidNorm = (t) => t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>');

const stats = (name, t) => {
  const lines = t.split('\n');
  const labels = lines.filter((l) => /^(REAL APP BEHAVIOUR|STRIPE-MOCK STAND-IN|SYNTHESIZED EVENT)$/.test(l)).length;
  const headers = lines.filter((l) => /^\[/.test(l)).length;
  const epi = lines.filter((l) => /^ +[0-9]+\. (GET|POST) \/v1\//.test(l));
  const distinct = new Set(epi.map((l) => l.replace(/^ +[0-9]+\. /, '').replace(/\b(acct|in)_[A-Za-z0-9]+/g, '$1_{id}')));
  const forbidden = epi.filter((l) => /\/v1\/(charges|payment_intents|transfers|payouts)/.test(l));
  console.log(`${name}: lines=${lines.length} labels=${labels} headers=${headers} stripeCalls=${epi.length} distinctPaths=${distinct.size} forbidden=${forbidden.length}`);
  for (const p of distinct) console.log(`   ${p}`);
};

const args = process.argv.slice(2);
const files = args.length ? args : ['demo-run1.log', 'demo-run2.log'];
const ts = files.map((f) => extract(readFileSync(`${dir}/${f}`, 'utf8')));
ts.forEach((t, i) => { writeFileSync(`${dir}/${files[i]}.transcript.txt`, t); stats(files[i], t); });

// The committed transcript too.
const committed = readFileSync('/Users/forrest/Code/american-software-company/.worktrees/AS-90/docs/demo/d1/transcript.txt', 'utf8');
stats('committed', committed);

const all = [...ts, committed];
const names = [...files, 'committed'];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
  const a = planNorm(all[i]); const b = planNorm(all[j]);
  const a2 = uuidNorm(a); const b2 = uuidNorm(b);
  console.log(`${names[i]} vs ${names[j]}: plan-normalised identical=${a === b}; +uuid identical=${a2 === b2}`);
  if (a2 !== b2) {
    const la = a2.split('\n'); const lb = b2.split('\n');
    for (let k = 0; k < Math.max(la.length, lb.length); k++) if (la[k] !== lb[k]) console.log(`   line ${k + 1}:\n     A: ${la[k]}\n     B: ${lb[k]}`);
  }
}
// Raw diff of the pair: which lines differ before normalisation.
const ra = all[0].split('\n'); const rb = all[1].split('\n');
let n = 0;
for (let k = 0; k < Math.max(ra.length, rb.length); k++) if (ra[k] !== rb[k]) { n++; console.log(`raw diff line ${k + 1}:\n  A: ${ra[k]}\n  B: ${rb[k]}`); }
console.log(`raw differing lines between ${names[0]} and ${names[1]}: ${n}`);
