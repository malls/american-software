const ids = ["ceo-carla","cto-owen","designer-sofia","developer-lena","developer-marcus","qa-priya","qa-ruben","researcher-elliot","researcher-nadia","ux-jonah"];
for (const id of ids) {
  const me = `agent:${id}`;
  const r = await fetch(`http://127.0.0.1:8347/api/conversations?me=${encodeURIComponent(me)}`);
  const j = await r.json();
  const arr = Array.isArray(j) ? j : (j.conversations || []);
  const unread = arr.filter(c => c.unread > 0);
  if (unread.length) console.log(me, JSON.stringify(unread.map(c => ({ id: c.id, name: c.name || c.title, kind: c.kind || c.type, unread: c.unread }))));
}
console.log("sweep done");
