// qa-ruben AS-100 M6 probe: /api/events?task=X&since=<id of an event from task Y>.
// Read-only against the worktree code; server boots on port 0 with a temp dataDir.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatServer } from '/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat/server.js';
import { makeEvent, serialiseEvent } from '/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat/lib/events.js';

const dataDir = mkdtempSync(join(tmpdir(), 'as100-probe-'));
mkdirSync(join(dataDir, 'events'), { recursive: true });
const t0 = Date.parse('2026-09-11T06:00:00.000Z');
const evs = [
  makeEvent({ type: 'stage_started', actor: 'agent:cto-owen', now: new Date(t0 + 1000), data: { task: 'AS-7', stage: 'implement', actor: 'agent:developer-lena', worktree: null, branch: null, cycle: null } }),
  makeEvent({ type: 'stage_started', actor: 'agent:cto-owen', now: new Date(t0 + 2000), data: { task: 'AS-8', stage: 'plan', actor: 'agent:cto-owen', worktree: null, branch: null, cycle: null } }),
  makeEvent({ type: 'stage_ended', actor: 'agent:cto-owen', now: new Date(t0 + 3000), data: { task: 'AS-7', stage: 'implement', actor: 'agent:developer-lena', outcome: 'completed', reason: null, closedBy: 'orchestrator', startedId: null, durationS: 2 } }),
];
writeFileSync(join(dataDir, 'events', 'company.jsonl'), evs.map(serialiseEvent).join('\n') + '\n');
process.env.CHAT_EVENTS_PATH = join(dataDir, 'events', 'company.jsonl');

const repoRoot = '/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat/test/fixtures/repo';
const { server, close } = createChatServer({ dbPath: join(dataDir, 'chat.db'), repoRoot, dataDir });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const get = async (p) => (await fetch(`http://127.0.0.1:${port}${p}`)).json();

const sinceAS8 = evs[1].id; // id of the AS-8 event, sitting between the two AS-7 events
const a = await get(`/api/events?task=AS-7`);
const b = await get(`/api/events?task=AS-7&since=${sinceAS8}`);
const c = await get(`/api/events?since=${sinceAS8}`);
console.log('task=AS-7            ->', a.events.map((e) => e.type));
console.log('task=AS-7&since=AS8id ->', b.events.map((e) => e.type), '(expected: [stage_ended])');
console.log('since=AS8id          ->', c.events.map((e) => e.type));
console.log('since=ev_nonsense    ->', (await get('/api/events?since=ev_01ABC')).events.length);
await close();
