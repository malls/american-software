// AS-81 planning repro (cto-owen), variant 2: the helper's single on-connect
// await hits nextFrame()'s 5000 ms rejection (no frame ever arrives) and the
// helper throws WITHOUT aborting its AbortController. Same question: does a
// plain `node --test` on this file exit on its own, or wedge?
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatServer } from '/Users/forrest/Code/american-software-company/apps/chat/server.js';

const FIXTURE_ROOT = '/Users/forrest/Code/american-software-company/apps/chat/test/fixtures/repo';

async function bootServer(t) {
  const dir = mkdtempSync(join(tmpdir(), 'as81-repro-'));
  const { server, close } = createChatServer({
    dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT, dataDir: join(dir, 'loop-data'),
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { base };
}

async function openStreamLikeMaster(base, me) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream?me=${encodeURIComponent(me)}`, { signal: ctrl.signal });
  const frames = [];
  const waiters = [];
  (async () => {
    const decoder = new TextDecoder();
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += decoder.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith(':')) continue;
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (!data) continue;
          const frame = { event, data: JSON.parse(data) };
          const w = waiters.shift();
          if (w) w.resolve(frame);
          else frames.push(frame);
        }
      }
    } catch {
      // aborted / destroyed
    }
  })();
  const nextFrame = (ms = 5000) =>
    new Promise((resolveP, rejectP) => {
      if (frames.length > 0) return resolveP(frames.shift());
      const timer = setTimeout(() => rejectP(new Error(`no frame within ${ms}ms`)), ms);
      waiters.push({ resolve: (f) => { clearTimeout(timer); resolveP(f); } });
    });
  await nextFrame(); // loop
  await nextFrame(); // lanes
  await nextFrame(); // nothing will ever come: 5000 ms rejection, ctrl never aborted
  return { close: () => ctrl.abort() };
}

test('AS-81 repro: helper hits the 5 s nextFrame rejection, controller never aborted', async (t) => {
  const { base } = await bootServer(t);
  await openStreamLikeMaster(base, 'human:forrest');
});
