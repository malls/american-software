// Scratch: apply the plan §1.4 normaliser (plus the UUID rule — the app's ids
// are UUIDs, not ULIDs) to two transcripts and compare; also the AC-2 counts.
import { readFileSync, writeFileSync } from 'node:fs';

const RULES = [
  [/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/g, '<ts>'],
  [/\b(t=)[0-9]+/g, '$1<t>'],
  [/v1=[0-9a-f]{64}/g, 'v1=<sig>'],
  [/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, '<ulid>'],
  [/\b(acct|cus|in|ii)_[A-Za-z0-9]+/g, '$1_<id>'],
  [/127\.0\.0\.1:[0-9]+/g, '127.0.0.1:<port>'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'],
];
const normalise = (text) => RULES.reduce((t, [re, rep]) => t.replace(re, rep), text);

const [, , a, b] = process.argv;
const A = readFileSync(a, 'utf8');
const B = readFileSync(b, 'utf8');
const nA = normalise(A);
const nB = normalise(B);
writeFileSync(`${a}.norm`, nA);
writeFileSync(`${b}.norm`, nB);
console.log(`normalised identical: ${nA === nB}`);
const la = A.split('\n');
const lb = B.split('\n');
let raw = 0;
for (let i = 0; i < Math.max(la.length, lb.length); i += 1) if (la[i] !== lb[i]) raw += 1;
console.log(`raw differing lines: ${raw} of ${la.length}`);
for (let i = 0; i < Math.max(la.length, lb.length); i += 1) {
  if (la[i] !== lb[i]) console.log(`  L${i + 1}: ${la[i]}\n         ${lb[i]}`);
}
const labels = la.filter((l) => /^(REAL APP BEHAVIOUR|STRIPE-MOCK STAND-IN|SYNTHESIZED EVENT)$/.test(l)).length;
const steps = la.filter((l) => l.startsWith('[')).length;
console.log(`AC-2: label lines ${labels}, step headers ${steps}`);
const epi = la.slice(la.findIndex((l) => l.startsWith('Epilogue:')) + 2).filter((l) => /^\s+\d+\. /.test(l));
console.log(`epilogue: ${epi.length} Stripe requests; distinct paths ${new Set(epi.map((l) => l.replace(/^\s+\d+\. /, ''))).size}`);
