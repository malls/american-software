// AS-81 planning repro (cto-owen), variant 4: the proposed fix shape applied
// to the variant-3 test. (a) openStream aborts its own controller in a finally
// when the on-connect await throws, and bounds that await; (b) the
// server-owning test registers a guarded t.after(close) BEFORE opening the
// stream, while still owning the inline close() it asserts on. Prediction: the
// test goes red and the process exits on its own within ~1 s.
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatServer } from '/Users/forrest/Code/american-software-company/apps/chat/server.js';

const FIXTURE_ROOT = '/Users/forrest/Code/american-software-company/apps/chat/test/fixtures/repo';
const CONNECT_MS = 2000;

async function openStreamFixed(base, me) {
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
  let ok = false;
  try {
    const first = await nextFrame(CONNECT_MS);
    throw new Error(`simulated regression: expected a loop frame on connect, got ${first.event}`);
    ok = true; // eslint-disable-line no-unreachable
  } finally {
    if (!ok) ctrl.abort();
  }
}

test('AS-81 repro (fixed shape): guarded t.after(close) + abort-on-throw; helper throws first', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'as81-fixed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { server, close } = createChatServer({ dbPath: join(dir, 'chat.db'), repoRoot: FIXTURE_ROOT });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  let closedByTest = false;
  t.after(async () => { if (!closedByTest) await close(); });
  const a = await openStreamFixed(base, 'human:forrest'); // throws
  closedByTest = true;
  await close(); // never reached in this repro; reached in the real test
});
