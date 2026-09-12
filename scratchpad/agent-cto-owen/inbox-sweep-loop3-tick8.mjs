const ids = ["cto-owen", "ceo-carla", "developer-marcus", "developer-lena", "qa-priya", "qa-ruben", "designer-sofia", "ux-jonah", "researcher-elliot", "researcher-nadia"];
for (const id of ids) {
  const me = "agent:" + id;
  const r = await fetch("http://127.0.0.1:8347/api/conversations?me=" + encodeURIComponent(me));
  const j = await r.json();
  const arr = Array.isArray(j) ? j : (j.conversations || []);
  for (const c of arr) {
    if (c.unread > 0 && c.name !== "lattice-events") {
      const m = await (await fetch("http://127.0.0.1:8347/api/messages?conversation=" + c.id + "&me=" + encodeURIComponent(me))).json();
      const list = m.messages || m;
      const tail = list.slice(-Math.min(c.unread, 4));
      console.log(me, c.type, c.name || c.dmKey, "unread", c.unread, "tail", tail.map(x => x.id + ":" + (x.author || x.sender || x.from)).join(","));
    }
  }
}
