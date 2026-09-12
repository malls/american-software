// AS-111 review probes (qa-priya, M6). Boots the branch server against a temp
// data dir and drives inputs the plan did not test. Read-only on the worktree.
// usage: node probe.mjs [chatDir]   (default: the AS-111 worktree's apps/chat)
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, renameSync, copyFileSync, statSync, mkdirSync, readFileSync, unlinkSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHAT = resolve(process.argv[2] || '/Users/forrest/Code/american-software-company/.worktrees/AS-111/apps/chat');
const { createChatServer } = await import(pathToFileURL(join(CHAT, 'server.js')).href);
const { makeEvent, serialiseEvent, readStream, openItems } = await import(pathToFileURL(join(CHAT, 'lib', 'events.js')).href);
const FIXTURE_ROOT = join(CHAT, 'test', 'fixtures', 'repo');
const POLL = 25;

let seq = 0;
const line = (type, data, actor = 'agent:developer-lena') =>
  `${serialiseEvent(makeEvent({ type, actor, taskId: null, data, now: new Date(Date.now() - 60_000 + (seq++) * 1000) })).trimEnd()}\n`;
const start = (task, over = {}) => line('stage_started', { task, stage: 'implement', actor: 'agent:developer-lena', worktree: `.worktrees/${task}`, branch: `feat/${task}-thing`, cycle: 1, ...over });
const end = (task, over = {}) => line('stage_ended', { task, stage: 'implement', actor: 'agent:developer-lena', outcome: 'completed', reason: null, closedBy: 'orchestrator', startedId: null, durationS: 5, ...over }, 'agent:cto-owen');
const tick = () => line('tick_started', { source: 'watcher', pid: 1, startedAt: new Date().toISOString(), messageId: 1, loopTick: 1 });

const BASE = process.env.AS111_PROBE_DIR || tmpdir();
const OUT = process.env.AS111_PROBE_OUT || '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-111/probe-results.json';
async function boot() {
  mkdirSync(BASE, { recursive: true });
  const dir = mkdtempSync(join(BASE, 'as111-probe-'));
  const dataDir = join(dir, 'loop-data');
  mkdirSync(join(dataDir, 'events'), { recursive: true });
  const path = join(dataDir, 'events', 'company.jsonl');
  writeFileSync(path, '');
  writeFileSync(join(dataDir, 'worktrees.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), repoRoot: '/r', worktrees: [
      { relPath: '.', main: true, head: 'f6717b8', branch: 'master', detached: false, ahead: null, behind: null, dirtyCount: null, dirtyLattice: null, merged: null, lastCommit: null, errors: [] },
      { relPath: '.worktrees/AS-7', main: false, head: 'abc1234', branch: 'feat/AS-7-thing', detached: false, ahead: 1, behind: 0, dirtyCount: 0, dirtyLattice: false, merged: false, lastCommit: null, errors: [] },
      { relPath: '.worktrees/AS-8', main: false, head: 'def5678', branch: 'feat/AS-8-thing', detached: false, ahead: 1, behind: 0, dirtyCount: 0, dirtyLattice: false, merged: false, lastCommit: null, errors: [] },
    ],
  }));
  const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir, loopPollMs: POLL, lanesPollMs: POLL, eventsPollMs: POLL });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  // SSE consumer
  const ctrl = new AbortController();
  const frames = [];
  const res = await fetch(`${base}/api/stream?me=human:forrest`, { signal: ctrl.signal });
  (async () => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          let event = null, data = '';
          for (const l of block.split('\n')) {
            if (l.startsWith('event:')) event = l.slice(6).trim();
            else if (l.startsWith('data:')) data += l.slice(5).trim();
          }
          if (event) frames.push({ event, data: data ? JSON.parse(data) : null });
        }
      }
    } catch { /* aborted */ }
  })();
  await sleep(POLL * 8);
  frames.length = 0;
  const drain = async (ms = POLL * 10 + 200) => { await sleep(ms); const out = frames.splice(0); return out; };
  const get = async (p) => (await fetch(base + p)).json();
  const stop = async () => { ctrl.abort(); await close(); rmSync(dir, { recursive: true, force: true }); };
  return { path, dataDir, drain, get, stop, base };
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const reason = async (get) => (await get('/api/lanes')).lanes.events;
const summary = (fr) => ({ company: fr.filter((f) => f.event === 'company').length, lanes: fr.filter((f) => f.event === 'lanes').length, lanesReasons: fr.filter((f) => f.event === 'lanes').map((f) => f.data.lanes.events.reason) });

const results = [];
function report(name, obj) { results.push({ name, ...obj }); console.log(`\n## ${name}\n${JSON.stringify(obj, null, 1)}`); }

// (a) operator rotation: mv then cp — new inode, identical bytes
{
  const p = await boot();
  appendFileSync(p.path, start('AS-7') + tick());
  const s0 = summary(await p.drain());
  renameSync(p.path, `${p.path.replace('company.jsonl', 'company.1.jsonl')}`);
  copyFileSync(p.path.replace('company.jsonl', 'company.1.jsonl'), p.path);
  const s1 = summary(await p.drain());
  const r1 = await reason(p.get);
  appendFileSync(p.path, tick());
  const s2 = summary(await p.drain());
  const r2 = await reason(p.get);
  report('(a) mv+cp rotation, identical bytes, new inode', { beforeSwap: s0, afterSwap: s1, reasonAfterSwap: r1.reason, malformed: r1.malformed, afterNextAppend: s2, reasonAfterAppend: r2.reason });
  await p.stop();
}

// (b) replacement SHORTER than the offset with a new inode
{
  const p = await boot();
  appendFileSync(p.path, start('AS-7') + tick() + tick());
  const s0 = summary(await p.drain());
  const shorter = start('AS-8', { actor: 'agent:qa-priya', stage: 'review' });
  writeFileSync(`${p.path}.next`, shorter);
  const oldSize = statSync(p.path).size;
  renameSync(`${p.path}.next`, p.path);
  const s1 = summary(await p.drain());
  const l = await p.get('/api/lanes');
  const lane = (k) => l.lanes.lanes.find((x) => x.key === k);
  report('(b) shorter replacement, new inode', { oldSize, newSize: statSync(p.path).size, beforeSwap: s0, afterSwap: s1, reason: l.lanes.events.reason, open: l.lanes.events.open, as7Live: !!(lane('AS-7') && lane('AS-7').subAgent), as8Live: !!(lane('AS-8') && lane('AS-8').subAgent) });
  await p.stop();
}

// (b2) same inode, shorter (truncate + rewrite whole content in one writeFileSync) — what word?
{
  const p = await boot();
  appendFileSync(p.path, start('AS-7') + tick() + tick());
  const s0 = summary(await p.drain());
  const ino = statSync(p.path).ino;
  writeFileSync(p.path, start('AS-8', { actor: 'agent:qa-priya', stage: 'review' }));
  const s1 = summary(await p.drain());
  const l = await p.get('/api/lanes');
  report('(b2) shorter rewrite, SAME inode', { sameIno: statSync(p.path).ino === ino, beforeSwap: s0, afterSwap: s1, reason: l.lanes.events.reason, open: l.lanes.events.open });
  await p.stop();
}

// (c) close with --cycle for a start that stated none; and the double-null F4 hole
{
  const S1 = JSON.parse(start('AS-7', { cycle: null }));
  const S2 = JSON.parse(start('AS-7', { cycle: 2 }));
  const C1 = JSON.parse(end('AS-7', { cycle: 1 }));
  const dir = mkdtempSync(join(tmpdir(), 'as111-c-'));
  const f = join(dir, 'c.jsonl');
  writeFileSync(f, [S1, S2, C1].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const open1 = openItems(readStream(f).events).stages.map((s) => [s.id === S2.id ? 'S2' : s.id, s.cycle]);
  // the hole: neither start states a cycle, late close states cycle 1
  const S1n = JSON.parse(start('AS-7', { cycle: null }));
  const S2n = JSON.parse(start('AS-7', { cycle: null }));
  const C1n = JSON.parse(end('AS-7', { cycle: 1 }));
  writeFileSync(f, [S1n, S2n, C1n].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const open2 = openItems(readStream(f).events).stages.length;
  // and: start states 1 (explicit), rework start states nothing, late close states 1
  const S1e = JSON.parse(start('AS-7', { cycle: 1 }));
  const S2e = JSON.parse(start('AS-7', { cycle: null }));
  const C1e = JSON.parse(end('AS-7', { cycle: 1 }));
  writeFileSync(f, [S1e, S2e, C1e].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const open3 = openItems(readStream(f).events).stages.length;
  rmSync(dir, { recursive: true, force: true });
  report('(c) cycle lenience', { 'start(null),start(2),close(1) -> open': open1, 'start(null),start(null),close(1) -> open count': open2, 'start(1),start(null),close(1) -> open count': open3 });
}

// (d) since = id adjacent to a malformed line; since = an id that only exists inside a malformed line
{
  const p = await boot();
  const a = start('AS-7'); const b = tick(); const c = end('AS-7');
  const idA = JSON.parse(a).id; const idB = JSON.parse(b).id; const idC = JSON.parse(c).id;
  const ghost = JSON.parse(tick()); // a valid id, but its line will be corrupted
  const corrupted = JSON.stringify(ghost).slice(0, -3) + '\n'; // malformed json carrying ghost.id
  appendFileSync(p.path, a + 'not json\n' + b + corrupted + c);
  await p.drain();
  const all = await p.get('/api/events');
  const q = async (qs) => (await p.get(`/api/events?${qs}`)).events.map((e) => e.id === idA ? 'A' : e.id === idB ? 'B' : e.id === idC ? 'C' : e.id);
  report('(d) since around malformed lines', {
    parsed: all.events.length, malformed: all.stream.malformed,
    'task=AS-7&since=A': await q(`task=AS-7&since=${idA}`),
    'task=AS-7&since=B(adjacent to malformed)': await q(`task=AS-7&since=${idB}`),
    'since=B': await q(`since=${idB}`),
    'since=<ghost id inside malformed line>': await q(`since=${ghost.id}`),
    'task=AS-7&since=<ghost>': await q(`task=AS-7&since=${ghost.id}`),
    'since=""': await q('since='),
    'task=AS-7&since=A&limit=0': await q(`task=AS-7&since=${idA}&limit=0`),
  });
  await p.stop();
}

// (e) replay after replaced: ids repeat on the wire?
{
  const p = await boot();
  appendFileSync(p.path, start('AS-7') + tick());
  const before = (await p.drain()).filter((f) => f.event === 'company').map((f) => f.data.id);
  const buf = readFileSync(p.path);
  writeFileSync(`${p.path}.next`, buf); renameSync(`${p.path}.next`, p.path);
  const after = (await p.drain()).filter((f) => f.event === 'company').map((f) => f.data.id);
  report('(e) replay ids', { before, after, identical: JSON.stringify(before) === JSON.stringify(after) });
  await p.stop();
}

// (g) delete then recreate between polls (no ENOENT ever observed)
{
  const p = await boot();
  appendFileSync(p.path, start('AS-7'));
  await p.drain();
  const keep = readFileSync(p.path);
  unlinkSync(p.path);
  writeFileSync(p.path, keep + tick());
  const s = summary(await p.drain());
  report('(g) unlink+recreate inside one poll gap', { after: s, reason: (await reason(p.get)).reason });
  await p.stop();
}

// (h) in-place truncate to 0 then regrow LONGER before the next poll (same inode)
{
  const p = await boot();
  appendFileSync(p.path, start('AS-7'));
  await p.drain();
  truncateSync(p.path, 0);
  appendFileSync(p.path, start('AS-8', { actor: 'agent:qa-priya', stage: 'review', branch: 'feat/AS-8-a-much-longer-branch-name-so-the-file-grows-past-the-old-offset' }));
  const s = summary(await p.drain());
  const r = await reason(p.get);
  report('(h) truncate+regrow longer in one gap, same inode', { after: s, reason: r.reason, malformed: r.malformed, open: r.open });
  await p.stop();
}

// (i) window edge: exactly-64-byte and <64-byte consumed prefixes
{
  const p = await boot();
  appendFileSync(p.path, 'x'.repeat(10) + '\n'); // 11 bytes consumed, malformed 1
  await p.drain();
  // replace: same inode, first 11 bytes differ, longer
  writeFileSync(p.path, 'y'.repeat(10) + '\n' + start('AS-7'));
  const s = summary(await p.drain());
  const r = await reason(p.get);
  report('(i) short-prefix window (<64 bytes consumed) then in-place rewrite', { after: s, reason: r.reason, malformed: r.malformed });
  await p.stop();
}

// (j) a partial line pending (no trailing newline) when the file is replaced
{
  const p = await boot();
  const full = start('AS-7');
  appendFileSync(p.path, full.slice(0, 40)); // partial, no newline
  await p.drain();
  const r0 = await reason(p.get);
  // replace with a new inode whose first 40 bytes match, then completes differently
  writeFileSync(`${p.path}.next`, full + tick()); renameSync(`${p.path}.next`, p.path);
  const s = summary(await p.drain());
  const r = await reason(p.get);
  report('(j) replace while a partial line is pending', { reasonBefore: r0.reason, after: s, reason: r.reason, malformed: r.malformed });
  await p.stop();
}

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log('\nDONE');
