import { readFileSync } from 'node:fs';

const D = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-80/';
const names = (f) => readFileSync(D + f, 'utf8')
  .split('\n')
  .filter((l) => /^[✔✖] /.test(l))
  .map((l) => l.slice(2).replace(/ \([0-9.]+m?s\)\s*$/, '').trim());

const host = names('host.txt');
const comp = names('compose.txt');
console.log('host cases:', host.length, 'compose cases:', comp.length);

const count = (a) => a.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map());
const h = count(host); const c = count(comp);
const onlyHost = [...h].filter(([n, k]) => (c.get(n) || 0) !== k).map(([n, k]) => `${n} (host ${k}, compose ${c.get(n) || 0})`);
const onlyComp = [...c].filter(([n, k]) => (h.get(n) || 0) !== k).map(([n, k]) => `${n} (compose ${k}, host ${h.get(n) || 0})`);
console.log('--- differing (host side) ---');
console.log(onlyHost.join('\n') || '(none)');
console.log('--- differing (compose side) ---');
console.log(onlyComp.join('\n') || '(none)');
