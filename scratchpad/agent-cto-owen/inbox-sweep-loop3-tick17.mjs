import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const ids = [];
for (const f of readdirSync('personnel')) {
  if (!f.endsWith('.md')) continue;
  const t = readFileSync(`personnel/${f}`, 'utf8');
  const m = t.match(/^actor_id:\s*(\S+)/m);
  const s = t.match(/^status:\s*(\S+)/m);
  if (m && (!s || s[1] === 'active')) ids.push(m[1]);
}
for (const id of ids) {
  const r = spawnSync('node', ['apps/chat/bin/chat.js', 'channels', '--me', id, '--json'], { encoding: 'utf8' });
  let j;
  try { j = JSON.parse(r.stdout); } catch { console.log(id, 'PARSE-FAIL', r.stderr.slice(0, 200)); continue; }
  const list = Array.isArray(j) ? j : (j.conversations || j.channels || []);
  const unread = list.filter(c => c.unread > 0).map(c => `${c.id ?? c.slug ?? c.name}(${c.kind ?? c.type ?? ''}):${c.unread}`);
  if (unread.length) console.log(id, '->', unread.join(' '));
}
console.log('swept', ids.length);
