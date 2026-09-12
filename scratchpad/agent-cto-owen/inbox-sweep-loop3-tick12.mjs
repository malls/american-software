// Inbox sweep for loop 3 tick 9 — unread counts per active employee via the server API (AS-24 route).
const ids = ['ceo-carla','cto-owen','developer-lena','developer-marcus','qa-priya','qa-ruben','designer-sofia','ux-jonah','researcher-elliot','researcher-nadia'];
for (const id of ids) {
  const me = `agent:${id}`;
  const r = await fetch(`http://127.0.0.1:8347/api/conversations?me=${encodeURIComponent(me)}`);
  const j = await r.json();
  const arr = Array.isArray(j) ? j : (j.conversations || []);
  const unread = arr.filter(c => c.unread > 0);
  console.log(`== ${me}: ${unread.length} conversations with unread`);
  for (const c of unread) console.log(`   ${c.id} ${c.name || c.kind || ''} unread=${c.unread}`);
}
