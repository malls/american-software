// Every human:* message with id > 1059 visible to any active employee; plus the newest message id overall.
const ids = ['designer-sofia','developer-lena','qa-ruben','researcher-elliot','cto-owen','ceo-carla','qa-priya','ux-jonah','developer-marcus','researcher-nadia'];
let maxId = 0; const seen = new Map();
for (const e of ids) {
  const me = `agent:${e}`;
  const r = await fetch(`http://127.0.0.1:8347/api/conversations?me=${encodeURIComponent(me)}`);
  const j = await r.json();
  const convs = Array.isArray(j) ? j : (j.conversations || []);
  for (const c of convs) {
    const mr = await fetch(`http://127.0.0.1:8347/api/messages?conversation=${c.id}&limit=200&me=${encodeURIComponent(me)}`);
    const mj = await mr.json();
    const msgs = Array.isArray(mj) ? mj : (mj.messages || []);
    for (const m of msgs) {
      if (m.id > maxId) maxId = m.id;
      if (String(m.authorId || '').startsWith('human:') && m.id > 1059 && !seen.has(m.id)) seen.set(m.id, { conv: c.id, name: c.name || c.kind, me, body: (m.body || '').replace(/\s+/g, ' ').slice(0, 300) });
    }
  }
}
console.log('max message id:', maxId);
for (const [id, h] of [...seen].sort((a, b) => a[0] - b[0])) console.log(`#${id} conv=${h.conv}(${h.name}) via ${h.me}: ${h.body}`);
if (!seen.size) console.log('no human messages after #1059');
