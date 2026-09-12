import { execFileSync } from "node:child_process";
const ids = ["agent:ceo-carla","agent:designer-sofia","agent:cto-owen","agent:developer-marcus","agent:qa-ruben","agent:developer-lena","agent:researcher-nadia","agent:qa-priya","agent:researcher-elliot","agent:ux-jonah"];
for (const id of ids) {
  let out;
  try { out = execFileSync("node", ["apps/chat/bin/chat.js","inbox","--me",id,"--json"], {encoding:"utf8", stdio:["ignore","pipe","ignore"]}); } catch(e){ console.log(id, "ERR", String(e.message).slice(0,200)); continue; }
  let j; try { j = JSON.parse(out); } catch(e){ console.log(id, "nonjson", out.slice(0,300)); continue; }
  const convs = Array.isArray(j) ? j : (j.data ?? j.conversations ?? j.unread ?? []);
  let total=0; const human=[];
  const walk = (msgs, conv) => { for (const m of msgs||[]) { total++; if (String(m.authorId||m.author||"").startsWith("human:")) human.push({conv, id:m.id, ts:m.ts||m.createdAt, body:String(m.body||"").slice(0,300)}); } };
  if (Array.isArray(convs)) for (const c of convs) walk(c.messages||c.items||[], c.name||c.id||c.conversation);
  else if (typeof j === "object") { for (const [k,v] of Object.entries(j)) if (Array.isArray(v)) walk(v,k); }
  console.log(`== ${id}: unread=${total} humanUnread=${human.length}`);
  for (const h of human) console.log("   ", JSON.stringify(h));
  if (total && !human.length && id===ids[0]) console.log("   sample keys:", Object.keys(j).slice(0,10).join(","), Array.isArray(convs)&&convs[0]?Object.keys(convs[0]).join(","):"");
}
