const ids = ['agent:ceo-carla','agent:cto-owen','agent:developer-marcus','agent:developer-lena','agent:qa-priya','agent:qa-ruben','agent:designer-sofia','agent:ux-jonah','agent:researcher-elliot','agent:researcher-nadia'];
for (const me of ids) {
  const r = await fetch(`http://127.0.0.1:8347/api/conversations?me=${encodeURIComponent(me)}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : (j.conversations || []);
  const unread = list.filter(c => c.unread > 0).map(c => ({ id: c.id, name: c.name || c.title || c.kind, unread: c.unread }));
  console.log(me, unread.length ? JSON.stringify(unread) : 'none');
}
