// AS-124 review (qa-ruben): the R11 observable. A genuine rotation (replaced,
// reset) followed by an identical-content swap at a new inode — the sequence
// the deployed mount produces when a real rotation is followed by the transient
// inode flap. Branch: the second swap adopts (0 frames). If `resetTail` did not
// reset the hash, the second compare would mismatch and replay again.
// Usage: node probe-r11.mjs <appDir>
const appDir = process.argv[2];
const { createChatServer } = await import(`${appDir}/server.js`);
const { makeEvent, serialiseEvent } = await import(`${appDir}/lib/events.js`);
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync, renameSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE_ROOT = `${appDir}/test/fixtures/repo`;
const POLL = 25;
let seq = 0;
const line = (type, data) => `${serialiseEvent(makeEvent({ type, actor: 'agent:developer-lena', taskId: null, data, now: new Date(Date.now() - 60_000 + (seq++) * 1000) })).trimEnd()}\n`;
const stageStarted = (task) => line('stage_started', { task, stage: 'implement', actor: 'agent:developer-lena', worktree: `.worktrees/${task}`, branch: `feat/${task}-thing`, cycle: 1 });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

const dir = mkdtempSync(join(tmpdir(), 'ruben-as124-r11-'));
const dataDir = join(dir, 'loop-data');
mkdirSync(join(dataDir, 'events'), { recursive: true });
const path = join(dataDir, 'events', 'company.jsonl');
const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir, loopPollMs: POLL, lanesPollMs: POLL, eventsPollMs: POLL });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;
const ctrl = new AbortController();
const frames = [];
const res = await fetch(`${base}/api/stream?me=human:forrest`, { signal: ctrl.signal });
(async () => {
  const dec = new TextDecoder(); let buf = '';
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        let event = 'message', data = '';
        for (const l of raw.split('\n')) { if (l.startsWith(':')) continue; if (l.startsWith('event:')) event = l.slice(6).trim(); else if (l.startsWith('data:')) data += l.slice(5).trim(); }
        if (data) frames.push({ event, data: JSON.parse(data) });
      }
    }
  } catch {}
})();
const lanes = async () => (await (await fetch(`${base}/api/lanes`)).json()).lanes.events;
const take = () => frames.splice(0).filter((f) => f.event === 'company').length;

appendFileSync(path, stageStarted('AS-7') + stageStarted('AS-8'));
await sleep(POLL * 8 + 200); take();
const old = readFileSync(path);
writeFileSync(`${path}.n1`, Buffer.concat([Buffer.from(stageStarted('AS-9')), old])); renameSync(`${path}.n1`, path);
await sleep(POLL * 8 + 200);
const afterRotation = { company: take(), reason: (await lanes()).reason };
writeFileSync(`${path}.n2`, readFileSync(path)); renameSync(`${path}.n2`, path);
await sleep(POLL * 8 + 200);
const afterFlap = { company: take(), reason: (await lanes()).reason };
console.log(JSON.stringify({ afterRotation, afterFlap }));
ctrl.abort(); await close(); rmSync(dir, { recursive: true, force: true });
