// AS-81 planning repro (cto-owen), variant 3: mirrors the shape of
// stream.test.js tests at lines 286 and 404 — the test OWNS its server and
// calls close() inline, with NO t.after registered for it. openStream throws
// before that line (simulated regression). Prediction: the test goes red and
// the child process never exits (listening server + heartbeat interval), so a
// plain `node --test` wedges — the AS-27 F2 symptom.
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatServer } from '/Users/forrest/Code/american-software-company/apps/chat/server.js';

const FIXTURE_ROOT = '/Users/forrest/Code/american-software-company/apps/chat/test/fixtures/repo';

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
  const first = await nextFrame();
  throw new Error(`simulated regression: expected a loop frame on connect, got ${first.event}`);
}

test('AS-81 repro: test owns close() inline (no t.after); helper throws first', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'as81-wedge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = await openStreamLikeMaster(base, 'human:forrest'); // throws
  await close(); // never reached
});
