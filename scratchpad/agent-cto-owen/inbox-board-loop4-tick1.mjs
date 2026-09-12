// Find the DM between cto-owen and human:forrest and print the last 2 messages there.
const me = "agent:cto-owen";
const r = await fetch(`http://127.0.0.1:8347/api/conversations?me=${encodeURIComponent(me)}`);
const j = await r.json();
const arr = Array.isArray(j) ? j : (j.conversations || []);
for (const c of arr) {
  if (c.type !== "dm" && c.kind !== "dm") continue;
  const m = await fetch(`http://127.0.0.1:8347/api/messages?conversation=${c.id}&me=${encodeURIComponent(me)}&since=1130`);
  const mj = await m.json();
  const members = mj.conversation?.members || [];
  if (!members.includes("human:forrest")) continue;
  console.log(`DM conv ${c.id} members=${JSON.stringify(members)} unread=${c.unread}`);
  for (const x of (mj.messages || []).slice(-2)) console.log(`[${x.id}] ${x.author_id || x.author || x.sender}: ${(x.body || x.text || "").slice(0, 1200)}\n`);
}
