// Latest human:forrest messages across board-facing conversations, and any reply after them.
const convs = [[8,'board','agent:ceo-carla'],[14,'bizdev','agent:cto-owen'],[11,'dm-carla','agent:ceo-carla']];
// also discover DMs for owen/lena/marcus
for (const me of ['agent:cto-owen','agent:developer-lena','agent:developer-marcus','agent:qa-priya','agent:qa-ruben']) {
  const r = await fetch(`http://127.0.0.1:8347/api/conversations?me=${encodeURIComponent(me)}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : (j.conversations || []);
  for (const c of list) if (!c.name && !convs.find(x => x[0] === c.id)) convs.push([c.id, 'dm-' + me, me]);
}
for (const [id, name, me] of convs) {
  const r = await fetch(`http://127.0.0.1:8347/api/messages?conversation=${id}&me=${encodeURIComponent(me)}`);
  const j = await r.json();
  const msgs = Array.isArray(j) ? j : (j.messages || []);
  const last = msgs.slice(-4);
  console.log(`== ${name} (${id}) total=${msgs.length}`);
  for (const m of last) console.log(`  #${m.id} ${m.sender || m.author || m.from} ${m.created_at || m.createdAt || ''}: ${String(m.body || m.text || '').slice(0, 220).replace(/\n/g,' ')}`);
}
