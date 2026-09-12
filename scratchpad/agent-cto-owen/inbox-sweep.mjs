// Tick inbox sweep: unread counts per active employee via the chat CLI (AS-24 self-routing).
import { spawnSync } from 'node:child_process';
const ids = ['agent:ceo-carla','agent:cto-owen','agent:developer-marcus','agent:developer-lena','agent:qa-priya','agent:qa-ruben','agent:ux-jonah','agent:designer-sofia','agent:researcher-elliot','agent:researcher-nadia'];
for (const id of ids) {
  const r = spawnSync('node', ['apps/chat/bin/chat.js', 'channels', '--me', id, '--json'], { encoding: 'utf8' });
  if (r.status !== 0) { console.log(id, 'ERR', (r.stderr || r.stdout).slice(0, 200)); continue; }
  let j; try { j = JSON.parse(r.stdout); } catch { console.log(id, 'BADJSON', r.stdout.slice(0, 200)); continue; }
  const arr = Array.isArray(j) ? j : (j.data || j.conversations || j.channels || []);
  const u = arr.filter(c => (c.unread || 0) > 0).map(c => `${c.id || c.name}:${c.unread}`);
  console.log(id, u.length ? u.join(' ') : '-');
}
