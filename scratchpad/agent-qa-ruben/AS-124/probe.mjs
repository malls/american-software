// AS-124 review (qa-ruben): M6 probes past the criteria list. Boots the real
// server against a scratch data dir and drives tailEvents through the plan §6
// scenarios plus a few of my own. Usage: node probe.mjs <appDir>
import { createChatServer } from '/Users/forrest/Code/american-software-company/.worktrees/AS-124/apps/chat/server.js';
import { makeEvent, serialiseEvent } from '/Users/forrest/Code/american-software-company/.worktrees/AS-124/apps/chat/lib/events.js';
import { makeEventsOps } from '/Users/forrest/Code/american-software-company/.worktrees/AS-124/apps/chat/watch/advance-watcher.mjs';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, mkdirSync, renameSync, copyFileSync, statSync, readFileSync, chmodSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE_ROOT = '/Users/forrest/Code/american-software-company/.worktrees/AS-124/apps/chat/test/fixtures/repo';
const POLL = 25;
let seq = 0;
const line = (type, data) => `${serialiseEvent(makeEvent({ type, actor: 'agent:developer-lena', taskId: null, data, now: new Date(Date.now() - 60_000 + (seq++) * 1000) })).trimEnd()}\n`;
const stageStarted = (task) => line('stage_started', { task, stage: 'implement', actor: 'agent:developer-lena', worktree: `.worktrees/${task}`, branch: `feat/${task}-thing`, cycle: 1 });
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function boot(pollMs = POLL) {
  const dir = mkdtempSync(join(tmpdir(), 'ruben-as124-probe-'));
  const dataDir = join(dir, 'loop-data');
  mkdirSync(join(dataDir, 'events'), { recursive: true });
  const path = join(dataDir, 'events', 'company.jsonl');
  const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir, loopPollMs: pollMs, lanesPollMs: pollMs, eventsPollMs: pollMs });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  // SSE consumer: count company frames and record lanes reasons in order.
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
  const take = () => { const out = frames.splice(0); return { company: out.filter((f) => f.event === 'company').length, reasons: out.filter((f) => f.event === 'lanes').map((f) => f.data.lanes.events.reason) }; };
  const stop = async () => { ctrl.abort(); await close(); rmSync(dir, { recursive: true, force: true }); };
  return { path, dataDir, lanes, take, stop };
}

function show(label, obj) { console.log(`${label}: ${JSON.stringify(obj)}`); }

// (a) mv + cp rotation with the ENOENT gap observed by a poll.
{
  const s = await boot();
  appendFileSync(s.path, stageStarted('AS-7') + stageStarted('AS-8'));
  await sleep(POLL * 8 + 200); s.take();
  renameSync(s.path, `${s.path}.1`);
  await sleep(POLL * 6 + 100);
  const gap = s.take(); const gapReason = await s.lanes();
  copyFileSync(`${s.path}.1`, s.path);
  await sleep(POLL * 8 + 200);
  show('(a) mv..gap..cp: during gap', { ...gap, reason: gapReason.reason });
  show('(a) mv..gap..cp: after cp', { ...s.take(), reason: (await s.lanes()).reason, malformed: (await s.lanes()).malformed });
  await s.stop();
}
// (a') mv + cp inside one poll gap (no ENOENT seen): must adopt silently.
{
  const s = await boot(300);
  appendFileSync(s.path, stageStarted('AS-7') + stageStarted('AS-8'));
  await sleep(300 * 3 + 100); s.take();
  renameSync(s.path, `${s.path}.1`); copyFileSync(`${s.path}.1`, s.path);
  await sleep(300 * 3 + 100);
  show("(a') mv+cp within one poll", { ...s.take(), reason: (await s.lanes()).reason });
  await s.stop();
}
// (b) two renames inside one poll gap, the second with different early content.
{
  const s = await boot(300);
  const l1 = stageStarted('AS-7'), l2 = stageStarted('AS-8');
  appendFileSync(s.path, l1 + l2);
  await sleep(300 * 3 + 100); s.take();
  writeFileSync(`${s.path}.a`, l1 + l2); renameSync(`${s.path}.a`, s.path);
  const l1b = l1.replace('AS-7', 'AS-9');
  writeFileSync(`${s.path}.b`, l1b + l2 + stageStarted('AS-10')); renameSync(`${s.path}.b`, s.path);
  await sleep(300 * 3 + 100);
  show('(b) two renames one gap, second differs', { ...s.take(), reason: (await s.lanes()).reason });
  await s.stop();
}
// (c) swap to a LONGER file, identical prefix, new bytes end in a partial line.
{
  const s = await boot();
  appendFileSync(s.path, stageStarted('AS-7') + stageStarted('AS-8'));
  await sleep(POLL * 8 + 200); s.take();
  const old = readFileSync(s.path); const extra = stageStarted('AS-9'); const partial = extra.slice(0, 50);
  writeFileSync(`${s.path}.next`, Buffer.concat([old, Buffer.from(partial)])); renameSync(`${s.path}.next`, s.path);
  await sleep(POLL * 8 + 200);
  const mid = s.take(); const midL = await s.lanes();
  appendFileSync(s.path, extra.slice(50));
  await sleep(POLL * 8 + 200);
  show('(c) longer swap w/ partial tail: after swap', { ...mid, reason: midL.reason, malformed: midL.malformed });
  show('(c) longer swap w/ partial tail: after completion', { ...s.take(), reason: (await s.lanes()).reason, malformed: (await s.lanes()).malformed });
  await s.stop();
}
// (d) hash cost: 8 MiB identical swap; measure the poll that adopts it.
{
  const s = await boot(200);
  const big = []; let bytes = 0;
  while (bytes < 8 * 1024 * 1024) { const l = stageStarted(`AS-${bytes % 97}`); big.push(l); bytes += Buffer.byteLength(l); }
  appendFileSync(s.path, big.join(''));
  await sleep(200 * 5 + 500); s.take();
  const sz = statSync(s.path).size;
  const t0 = performance.now();
  writeFileSync(`${s.path}.next`, readFileSync(s.path)); renameSync(`${s.path}.next`, s.path);
  // wait for the poll that follows the rename, then measure how long /api/lanes stays responsive
  await sleep(200 * 4 + 200);
  const r = s.take();
  show('(d) 8 MiB identical swap', { size: sz, company: r.company, reason: (await s.lanes()).reason, elapsedMsIncludingWait: Math.round(performance.now() - t0) });
  // Direct measurement of the compare cost, same algorithm as prefixMatches.
  const { createHash } = await import('node:crypto'); const { openSync, readSync, closeSync } = await import('node:fs');
  const t1 = performance.now(); const fd = openSync(s.path, 'r'); const b = Buffer.alloc(65536); const h = createHash('sha256'); let pos = 0;
  while (pos < sz) { const got = readSync(fd, b, 0, Math.min(b.length, sz - pos), pos); if (!got) break; h.update(b.subarray(0, got)); pos += got; }
  closeSync(fd); h.digest();
  show('(d) direct prefix hash of the 8 MiB file (host tmp)', { ms: +(performance.now() - t1).toFixed(2) });
  await s.stop();
}
// (e) size === offset with a pending inode change and an UNREADABLE file: degrade, never throw; recover on the next readable poll.
{
  const s = await boot();
  appendFileSync(s.path, stageStarted('AS-7') + stageStarted('AS-8'));
  await sleep(POLL * 8 + 200); s.take();
  const old = readFileSync(s.path);
  writeFileSync(`${s.path}.next`, old, { mode: 0o000 }); renameSync(`${s.path}.next`, s.path);
  await sleep(POLL * 6 + 100);
  const dur = s.take(); const durL = await s.lanes();
  chmodSync(s.path, 0o644);
  await sleep(POLL * 6 + 100);
  show('(e) unreadable on the confirming poll', { ...dur, reason: durL.reason });
  show('(e) after chmod back', { ...s.take(), reason: (await s.lanes()).reason });
  appendFileSync(s.path, stageStarted('AS-9'));
  await sleep(POLL * 6 + 100);
  show('(e) then one append', { ...s.take(), reason: (await s.lanes()).reason });
  await s.stop();
}
// (f) no-stream -> file appears: no spurious replaced on the first polls.
{
  const s = await boot();
  try { unlinkSync(s.path); } catch {}
  await sleep(POLL * 6 + 100);
  const before = await s.lanes(); s.take();
  writeFileSync(s.path, stageStarted('AS-7'));
  const seen = [];
  for (let i = 0; i < 6; i++) { await sleep(POLL); seen.push((await s.lanes()).reason); }
  show('(f) no-stream -> appears', { before: before.reason, reasonsOverSixPolls: seen, ...s.take() });
  await s.stop();
}
// (g) sweep path: closeOpen via sweep() carries a stated cycle.
{
  const T0 = Date.parse('2026-09-11T05:00:00.000Z'); const MIN = 60000;
  const ev = (type, data, atMs, actor = 'system:watcher') => makeEvent({ type, actor, data, now: new Date(atMs) });
  const file = [ev('tick_started', { source: 'watcher', pid: 1, startedAt: new Date(T0).toISOString(), messageId: 1, loopTick: 1 }, T0),
    ev('stage_started', { task: 'AS-95', stage: 'review', actor: 'agent:qa-ruben', worktree: '.worktrees/AS-95', branch: 'feat/AS-95-x', cycle: 2 }, T0 + 1000, 'agent:cto-owen')]
    .map((e) => serialiseEvent(e) + '\n').join('');
  const state = { file };
  const ops = makeEventsOps({ streamPath: '/scratch/x.jsonl', tickTimeoutMs: 30 * MIN, lockBusy: () => false, isBusy: () => false, now: () => T0 + 31 * MIN,
    readFile: () => state.file, append: (_p, c) => { state.file += c; }, mkdir: () => {}, log: () => {} });
  ops.sweep();
  const gained = state.file.slice(file.length).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  show('(g) sweep closeOpen carries cycle', gained.map((e) => ({ type: e.type, cycle: e.data.cycle, outcome: e.data.outcome, closedBy: e.data.closedBy })));
}
// (h) MINE: identical-prefix swap while reason is still `replaced` (pending next append) — adoption must not clear it early.
{
  const s = await boot();
  appendFileSync(s.path, stageStarted('AS-7') + stageStarted('AS-8'));
  await sleep(POLL * 8 + 200); s.take();
  const old = readFileSync(s.path);
  writeFileSync(`${s.path}.n1`, Buffer.concat([Buffer.from(stageStarted('AS-9')), old])); renameSync(`${s.path}.n1`, s.path); // genuine replacement
  await sleep(POLL * 8 + 200);
  const r1 = s.take(); const l1 = await s.lanes();
  writeFileSync(`${s.path}.n2`, readFileSync(s.path)); renameSync(`${s.path}.n2`, s.path); // identical swap while `replaced` pending
  await sleep(POLL * 8 + 200);
  const r2 = s.take(); const l2 = await s.lanes();
  show('(h) genuine replacement', { ...r1, reason: l1.reason });
  show('(h) identical swap while replaced pending', { ...r2, reason: l2.reason });
  await s.stop();
}
// (i) MINE: empty file adopted (offset 0), then an identical (empty) swap at a new inode, then a swap to a non-empty file.
{
  const s = await boot();
  await sleep(POLL * 4 + 100); s.take();
  writeFileSync(`${s.path}.e`, ''); renameSync(`${s.path}.e`, s.path);
  await sleep(POLL * 6 + 100);
  const r1 = s.take(); const l1 = await s.lanes();
  writeFileSync(`${s.path}.f`, stageStarted('AS-7')); renameSync(`${s.path}.f`, s.path);
  await sleep(POLL * 6 + 100);
  show('(i) empty->empty new inode', { ...r1, reason: l1.reason });
  show('(i) empty->one line new inode', { ...s.take(), reason: (await s.lanes()).reason });
  await s.stop();
}
// (j) MINE: same-inode truncation to a SHORTER file that then grows past the old cursor before the poll (the window check must catch it — unchanged path).
{
  const s = await boot(300);
  const l1 = stageStarted('AS-7'), l2 = stageStarted('AS-8');
  appendFileSync(s.path, l1 + l2);
  await sleep(300 * 3 + 100); s.take();
  writeFileSync(s.path, l1.replace('AS-7', 'AS-9') + l2 + stageStarted('AS-10')); // same inode, rewritten in place, longer
  await sleep(300 * 3 + 100);
  show('(j) same-inode in-place rewrite, longer, window identical', { ...s.take(), reason: (await s.lanes()).reason });
  await s.stop();
}
console.log('probes done');
