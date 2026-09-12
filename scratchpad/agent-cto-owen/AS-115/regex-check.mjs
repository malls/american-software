// AS-115 planning: candidate recognition rules vs the live corpus and the
// named positive/negative inputs. Read-only.
const HASH_RE = /(?<![A-Za-z0-9_/#-])[0-9a-f]{7,40}(?!\.?[A-Za-z0-9_-])/g;
const BRANCH_RE = /(?<![A-Za-z0-9_-])feat\/AS-\d+(?:-[A-Za-z0-9_]+)+(?![A-Za-z0-9_/-])/g;
const admitHash = (s) => !(/^\d+$/.test(s) && s.length !== 7);
const hashes = (t) => [...t.matchAll(HASH_RE)].map((m) => m[0]).filter(admitHash);
const branches = (t) => [...t.matchAll(BRANCH_RE)].map((m) => m[0]);

const base = 'http://127.0.0.1:8347';
const bodies = [];
for (const id of [1, 2, 3, 5, 7, 11]) {
  const j = await (await fetch(`${base}/api/messages?me=agent:cto-owen&conversation=${id}&since=0`)).json();
  for (const m of j.messages || []) if (typeof m.body === 'string') bodies.push(m.body);
}
const text = bodies.join('\n');
const h = hashes(text);
const byLen = {};
for (const s of h) byLen[s.length] = (byLen[s.length] || 0) + 1;
console.log('corpus hash tokens', h.length, byLen);
console.log('corpus branch tokens', branches(text).length, [...new Set(branches(text))].length);

const positives = [
  ['merged 74cb6f9 after', ['74cb6f9']],
  ['(commit e5a180a)', ['e5a180a']],
  ['head e5a180a, merge-tree clean', ['e5a180a']],
  ['landed as 0337a54.', ['0337a54']],
  ['at 1411753, 456/456 host', ['1411753']],
  ['four commits to efadfac; host', ['efadfac']],
  ['master pushed b3f71ee..44ac58a; worktree', ['b3f71ee', '44ac58a']],
  ['build cb92cbbb2c37d4a8, 5 s', ['cb92cbbb2c37d4a8']],
  ['full ' + 'a'.repeat(20) + '1'.repeat(20) + ' sha', ['a'.repeat(20) + '1'.repeat(20)]],
  ['`e5a180a`', ['e5a180a']],
  ['e5a180a:', ['e5a180a']],
  ['desiredId == 84639eb29e39d4d7) and', ['84639eb29e39d4d7']],
];
const negatives = [
  'acceded to the plan',
  'defaced and effaced',
  'pid 1234567890 exited',
  'epoch 1757620000 and 1757620000123',
  'msg 810 and message 1234',
  '#1411753 is an issue',
  'AS-1411753',
  'x_e5a180a and e5a180a_x',
  '1C41E3FF and Abc1234 and DEADBEEF',
  'd1d38cac-4449-42ce-babe-fcc1b3e77a2a',
  'asc-as93-ruben-mm6-test',
  'apps/abc1234.js and lib/abc1234/x',
  'abc1234.js',
  'abcdef1234567890abcdef1234567890abcdef123', // 41 chars
  '2147483648 and 10000000',
  'task_01M28WQ53NHZFJB9SKGXX7X5BT',
  'watcher:53418 loop tick 10',
  'v1.156 released',
  'feat/AS-88-deploy-names-its-project', // branch, not hash; hash pass sees nothing hex-7 here anyway
];
let bad = 0;
for (const [inp, want] of positives) {
  const got = hashes(inp);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(ok ? 'ok ' : 'BAD', JSON.stringify(inp), '->', got);
}
for (const inp of negatives) {
  const got = hashes(inp);
  const ok = got.length === 0;
  if (!ok) bad++;
  console.log(ok ? 'ok ' : 'BAD', 'NEG', JSON.stringify(inp), '->', got);
}
console.log('--- branches');
const bpos = [
  ['branch feat/AS-88-deploy-names-its-project from', ['feat/AS-88-deploy-names-its-project']],
  ['(feat/AS-26-message-permalinks).', ['feat/AS-26-message-permalinks']],
  ['on feat/AS-83-probe-budget.', ['feat/AS-83-probe-budget']],
  ['git diff master...feat/AS-93-deep-link-host', ['feat/AS-93-deep-link-host']],
  ['origin/feat/AS-95-watcher-loop', ['feat/AS-95-watcher-loop']],
  ['`feat/AS-28-favicon`', ['feat/AS-28-favicon']],
  ['feat/AS-115-copy-refs,', ['feat/AS-115-copy-refs']],
];
const bneg = [
  'feat/AS-88', // no slug
  'feat/AS-88-', // dangling
  'xfeat/AS-88-slug',
  'feat/AS-88-slug/extra',
  'fix/AS-88-slug',
  '.worktrees/AS-88',
  'feat/AS-88-slug-', // trailing dash: token must not include it -> we require whole-match; see below
  'feat/as-88-slug',
];
for (const [inp, want] of bpos) {
  const got = branches(inp);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(ok ? 'ok ' : 'BAD', JSON.stringify(inp), '->', got);
}
for (const inp of bneg) {
  const got = branches(inp);
  console.log(got.length === 0 ? 'ok ' : 'NOTE', 'NEG', JSON.stringify(inp), '->', got);
}
console.log('bad', bad);
