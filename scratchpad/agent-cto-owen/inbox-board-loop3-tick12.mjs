// Find every message authored by human:* in any conversation visible to the two cofounders, newest 6, with keys.
for (const me of ['agent:ceo-carla', 'agent:cto-owen']) {
  const r = await fetch(`http://127.0.0.1:8347/api/conversations?me=${encodeURIComponent(me)}`);
  const j = await r.json();
  const convs = Array.isArray(j) ? j : (j.conversations || []);
  const human = [];
  for (const c of convs) {
    const mr = await fetch(`http://127.0.0.1:8347/api/messages?conversation=${c.id}&limit=2000&me=${encodeURIComponent(me)}`);
    const mj = await mr.json();
    const msgs = Array.isArray(mj) ? mj : (mj.messages || []);
    for (const m of msgs) {
      const a = m.authorId || '';
      if (String(a).startsWith('human:')) human.push({ conv: c.id, name: c.name || c.kind, id: m.id, at: m.created_at || m.ts, body: (m.body || m.text || '').replace(/\s+/g, ' ').slice(0, 200), lastRead: c.last_read_id ?? c.lastRead ?? c.read_up_to });
    }
  }
  human.sort((a, b) => a.id - b.id);
  console.log(`== ${me}: ${human.length} human messages; newest 6:`);
  for (const h of human.slice(-6)) console.log(`  #${h.id} conv=${h.conv}(${h.name}) ${h.at} lastRead=${h.lastRead}: ${h.body}`);
}
