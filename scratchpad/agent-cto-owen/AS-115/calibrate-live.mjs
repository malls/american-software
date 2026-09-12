// AS-115 planning calibration against the live chat API (read-only GETs).
// Public channels only: #engineering (2) and #lattice-events (3), plus the
// CTO's own DMs (7, 11) — the channels where hashes and branches actually live.
const base = 'http://127.0.0.1:8347';
const me = 'agent:cto-owen';
const bodies = [];
for (const id of [1, 2, 3, 5, 7, 11]) {
  // AS-25 delta path: ?since=0 returns every row, replies included, flat.
  const r = await fetch(`${base}/api/messages?me=${me}&conversation=${id}&since=0`);
  const j = await r.json();
  for (const m of j.messages || []) if (typeof m.body === 'string') bodies.push(m.body);
}
console.log('bodies', bodies.length);
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
const ctx = (r, w = 22) => JSON.stringify(text.slice(Math.max(0, r.i - w), r.i + r.s.length + w));
console.log('--- all-digit samples:');
for (const r of allDigit.slice(0, 15)) console.log(' ', r.s, ctx(r));
console.log('--- all-alpha samples:');
for (const r of allAlpha.slice(0, 15)) console.log(' ', r.s, ctx(r));
const prev = {};
for (const r of mixed) { const c = text[r.i - 1] ?? '^'; prev[c] = (prev[c] || 0) + 1; }
console.log('char before mixed', prev);
const next = {};
for (const r of mixed) { const c = text[r.i + r.s.length] ?? '$'; next[c] = (next[c] || 0) + 1; }
console.log('char after mixed', next);
for (const L of [8, 9, 10, 11, 12, 13, 14, 15, 16]) {
  const s = mixed.filter((r) => r.s.length === L).slice(0, 6).map((r) => ctx(r));
  if (s.length) console.log(`len ${L} samples`, s);
}
console.log('len >16 samples', mixed.filter((r) => r.s.length > 16).slice(0, 6).map((r) => ctx(r)));
console.log('mixed preceded by # or -', mixed.filter((r) => ['#', '-'].includes(text[r.i - 1])).slice(0, 6).map((r) => ctx(r)));
// mixed 7-char runs that are probably NOT commit hashes (context words)
const suspicious = mixed.filter((r) => r.s.length === 7 && !/(merge|commit|head|sha|hash|landed|\(|at |fixed|cycle|master|branch|records|export|inline|is |ee|b[0-9a-f])/i.test(text.slice(Math.max(0, r.i - 30), r.i)));
console.log('7-char mixed with no hash-ish context word before', suspicious.length, suspicious.slice(0, 10).map((r) => ctx(r)));
const BR = /(?<![A-Za-z0-9_/.-])[A-Za-z0-9_-]+\/[A-Za-z0-9._/-]*AS-\d+[A-Za-z0-9._/-]*/g;
const br = [...text.matchAll(BR)].map((m) => m[0]);
const prefixes = {};
for (const b of br) { const p = b.split('/')[0]; prefixes[p] = (prefixes[p] || 0) + 1; }
console.log('slash-path-like with AS-n, by first segment', prefixes);
const featOther = [...text.matchAll(/(?<![A-Za-z0-9_/.-])feat\/[A-Za-z0-9._/-]+/g)].map((m) => m[0]).filter((b) => !/^feat\/AS-\d/.test(b));
console.log('feat/ not AS-n', [...new Set(featOther)].slice(0, 10));
for (const p of ['fix', 'chore', 'hotfix', 'bug', 'refactor', 'release', 'origin', 'spike', 'wip']) {
  const m = [...text.matchAll(new RegExp(`(?<![A-Za-z0-9_/.-])${p}\\/[A-Za-z0-9._/-]+`, 'g'))].map((x) => x[0]);
  if (m.length) console.log(p + '/', m.length, [...new Set(m)].slice(0, 6));
}
const trail = {};
for (const m of text.matchAll(/feat\/AS-\d+[A-Za-z0-9._-]*/g)) { const c = text[m.index + m[0].length] ?? '$'; trail[c] = (trail[c] || 0) + 1; }
console.log('char after feat/AS-n-slug', trail);
console.log('feat branches ending in a period (sentence end)', [...text.matchAll(/feat\/AS-\d+[A-Za-z0-9._-]*\./g)].slice(0, 5).map((m) => m[0]));
console.log('.worktrees/ refs', (text.match(/\.worktrees\/AS-\d+/g) || []).length);
console.log('urls containing a hex run', [...text.matchAll(/https?:\/\/\S*[0-9a-f]{7,40}\S*/g)].slice(0, 5).map((m) => m[0]));
console.log('master...feat', (text.match(/master\.\.\.feat\//g) || []).length, [...text.matchAll(/master\.\.\.feat\/\S+/g)].slice(0, 3).map((m) => m[0]));
console.log('hex in backticks', [...text.matchAll(/`[0-9a-f]{7,40}`/g)].length);
console.log('hex ranges a..b', [...text.matchAll(/[0-9a-f]{7,40}\.\.\.?[0-9a-f]{7,40}/g)].slice(0, 5).map((m) => m[0]));
console.log('uppercase hex 7+', [...text.matchAll(/(?<![A-Za-z0-9_])[0-9A-F]{7,40}(?![A-Za-z0-9_])/g)].filter((m) => /[A-F]/.test(m[0])).slice(0, 5).map((m) => m[0]));
console.log('pid-like "watcher:NNNNN"', (text.match(/watcher:\d{4,6}/g) || []).length);
console.log('"msg NNN" refs', (text.match(/\bmsg #?\d+/gi) || []).length);
console.log('feat/ inside backticks', (text.match(/`feat\/[^`]+`/g) || []).length);
console.log('compose project names asc-', [...new Set((text.match(/asc-[a-z0-9-]+/g) || []))].slice(0, 8));
