// Tick inbox sweep helper: unread counts in board-relevant conversations per employee.
const ids = [
  "agent:ceo-carla", "agent:developer-marcus", "agent:developer-lena", "agent:qa-priya",
  "agent:qa-ruben", "agent:ux-jonah", "agent:designer-sofia", "agent:researcher-elliot",
  "agent:researcher-nadia",
];
for (const me of ids) {
  const r = await fetch("http://127.0.0.1:8347/api/conversations?me=" + encodeURIComponent(me));
  const j = await r.json();
  const list = Array.isArray(j) ? j : (j.conversations || j.data);
  const a = list
    .filter((c) => c.unread > 0 && (c.type === "dm" ? c.dmKey.includes("human:") : ["board", "bizdev", "engineering"].includes(c.name)))
    .map((c) => (c.name || c.dmKey) + ":" + c.unread);
  console.log(me, "=>", a.join(" ") || "-");
}
