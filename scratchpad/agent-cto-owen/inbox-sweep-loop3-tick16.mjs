// Inbox sweep for loop 3 tick 15 — raw API, read-only.
const actors = ['agent:developer-lena','agent:cto-owen','agent:designer-sofia','agent:ceo-carla','agent:researcher-elliot','agent:qa-priya','agent:qa-ruben','agent:developer-marcus','agent:ux-jonah','agent:researcher-nadia'];
const base = 'http://127.0.0.1:8347/api';
for (const me of actors) {
  const r = await fetch(`${base}/conversations?me=${encodeURIComponent(me)}`);
  if (!r.ok) { console.log(me, 'HTTP', r.status); continue; }
  const j = await r.json();
  const list = Array.isArray(j) ? j : (j.conversations || []);
  const unread = list.filter(c => (c.unread || 0) > 0);
  console.log(me, unread.length ? unread.map(c => `${c.id}(${c.name || c.kind || ''}):${c.unread}`).join(' ') : '-');
}
