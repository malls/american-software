// AS-115 planning calibration (cto-owen). Reads the chat export, reports the
// shapes of hex runs and branch names that actually occur. Read-only.
import { readdirSync, readFileSync } from 'node:fs';
const dir = '/Users/forrest/Code/american-software-company/apps/chat/data/export/';
const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
const bodies = [];
for (const f of files) {
  for (const line of readFileSync(dir + f, 'utf8').split('\n')) {
    if (!line) continue;
    try {
      const j = JSON.parse(line);
      if (typeof j.body === 'string') bodies.push(j.body);
    } catch {}
  }
}
console.log('files', files.length, 'bodies', bodies.length);
const text = bodies.join('\n');
const HEX = /(?<![A-Za-z0-9_])[0-9a-f]{7,40}(?![A-Za-z0-9_])/g;
const runs = [...text.matchAll(HEX)].map((m) => ({ s: m[0], i: m.index }));
const byLen = {};
for (const r of runs) byLen[r.s.length] = (byLen[r.s.length] || 0) + 1;
console.log('hex runs by length', byLen);
const allDigit = runs.filter((r) => /^\d+$/.test(r.s));
const allAlpha = runs.filter((r) => /^[a-f]+$/.test(r.s));
const mixed = runs.filter((r) => /\d/.test(r.s) && /[a-f]/.test(r.s));
console.log('all-digit', allDigit.length, 'all-alpha', allAlpha.length, 'mixed', mixed.length);
const ctx = (r, w = 18) => JSON.stringify(text.slice(Math.max(0, r.i - w), r.i + r.s.length + w));
console.log('--- all-digit samples:');
for (const r of allDigit.slice(0, 12)) console.log(' ', r.s, ctx(r));
console.log('--- all-alpha samples:');
for (const r of allAlpha.slice(0, 12)) console.log(' ', r.s, ctx(r));
const mixedLen = {};
for (const r of mixed) mixedLen[r.s.length] = (mixedLen[r.s.length] || 0) + 1;
console.log('mixed by length', mixedLen);
const prev = {};
for (const r of mixed) { const c = text[r.i - 1] ?? '^'; prev[c] = (prev[c] || 0) + 1; }
console.log('char before mixed', prev);
const next = {};
for (const r of mixed) { const c = text[r.i + r.s.length] ?? '$'; next[c] = (next[c] || 0) + 1; }
console.log('char after mixed', next);
for (const L of [8, 9, 10, 11, 12, 16]) {
  const s = mixed.filter((r) => r.s.length === L).slice(0, 6).map((r) => ctx(r));
  if (s.length) console.log(`len ${L} samples`, s);
}
const long = mixed.filter((r) => r.s.length > 16).slice(0, 6).map((r) => ctx(r));
console.log('len >16 samples', long);
// branches
const BR = /(?<![A-Za-z0-9_/.-])[A-Za-z0-9_-]+\/[A-Za-z0-9._/-]*AS-\d+[A-Za-z0-9._/-]*/g;
const br = [...text.matchAll(BR)].map((m) => m[0]);
const prefixes = {};
for (const b of br) { const p = b.split('/')[0]; prefixes[p] = (prefixes[p] || 0) + 1; }
console.log('slash-path-like with AS-n, by first segment', prefixes);
console.log('feat/ samples', [...new Set(br.filter((b) => b.startsWith('feat/')))].slice(0, 20));
const featOther = [...text.matchAll(/(?<![A-Za-z0-9_/.-])feat\/[A-Za-z0-9._/-]+/g)].map((m) => m[0]).filter((b) => !/^feat\/AS-\d/.test(b));
console.log('feat/ not AS-n', [...new Set(featOther)].slice(0, 10));
for (const p of ['fix', 'chore', 'hotfix', 'bug', 'refactor', 'docs', 'test', 'release', 'origin']) {
  const m = [...text.matchAll(new RegExp(`(?<![A-Za-z0-9_/.-])${p}\\/[A-Za-z0-9._/-]+`, 'g'))].map((x) => x[0]);
  if (m.length) console.log(p + '/', m.length, [...new Set(m)].slice(0, 5));
}
// trailing punctuation after feat/ branches
const trail = {};
for (const m of text.matchAll(/feat\/AS-\d+[A-Za-z0-9._-]*/g)) { const c = text[m.index + m[0].length] ?? '$'; trail[c] = (trail[c] || 0) + 1; }
console.log('char after feat/AS-n-slug', trail);
console.log('.worktrees/ refs', (text.match(/\.worktrees\/AS-\d+/g) || []).length);
console.log('urls containing a hex run', [...text.matchAll(/https?:\/\/\S*[0-9a-f]{7,40}\S*/g)].length,
  [...text.matchAll(/https?:\/\/\S*[0-9a-f]{7,40}\S*/g)].slice(0, 3).map((m) => m[0]));
console.log('task_ ids', (text.match(/task_[0-9A-Z]{26}/g) || []).length);
console.log('master...feat', (text.match(/master\.\.\.feat\//g) || []).length);
console.log('hex with trailing period', [...text.matchAll(/(?<![A-Za-z0-9_])[0-9a-f]{7,40}\./g)].length);
console.log('hex in backticks', [...text.matchAll(/`[0-9a-f]{7,40}`/g)].length);
console.log('hex preceded by dash e.g. as93-', [...text.matchAll(/-[0-9a-f]{7,40}(?![A-Za-z0-9_])/g)].slice(0, 5).map((m) => m[0]));
console.log('uppercase hex-ish 7+', [...text.matchAll(/(?<![A-Za-z0-9_])[0-9A-F]{7,40}(?![A-Za-z0-9_])/g)].filter((m) => /[A-F]/.test(m[0])).slice(0, 5).map((m) => m[0]));
