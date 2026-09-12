// Loop 3 tick 19 inbox sweep — reads active identities from personnel/ and lists unread conversations via the chat API.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'personnel';
const ids = [];
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.md')) continue;
  const text = readFileSync(join(dir, f), 'utf8');
  const fm = text.split('---')[1] || '';
  const actor = /^actor_id:\s*(\S+)/m.exec(fm)?.[1];
  const status = /^status:\s*(\S+)/m.exec(fm)?.[1];
  if (actor && status === 'active') ids.push(actor);
}
for (const me of ids) {
  const r = await fetch(`http://127.0.0.1:8347/api/conversations?me=${encodeURIComponent(me)}`);
  const convs = await r.json();
  const list = Array.isArray(convs) ? convs : (convs.conversations || []);
  const unread = list.filter(c => (c.unread || 0) > 0);
  if (unread.length) {
    for (const c of unread) console.log(`${me}\t${c.id}\t${c.name || c.title || c.kind || ''}\tunread=${c.unread}`);
  } else {
    console.log(`${me}\t(no unread)`);
  }
}
