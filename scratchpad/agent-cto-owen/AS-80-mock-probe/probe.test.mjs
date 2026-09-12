import test from 'node:test';
import assert from 'node:assert/strict';
import { make } from './mod.mjs';

test('probe: global mock sees module-internal setInterval and the leak is visible', (t) => {
  const sched = t.mock.method(globalThis, 'setInterval');
  const clr = t.mock.method(globalThis, 'clearInterval');
  const m = make(1000);
  const ids = sched.mock.calls.map((c) => c.result);
  assert.equal(ids.length, 2, 'both module-internal intervals recorded');
  assert.equal(typeof ids[0].unref, 'function', 'real Timeout passed through');
  assert.equal(ids[0].hasRef(), false, 'unref() took effect on the real timer');
  assert.deepEqual(process.getActiveResourcesInfo().filter((r) => r === 'Timeout'), [], 'unref timers invisible to getActiveResourcesInfo');
  m.close();
  const cleared = clr.mock.calls.map((c) => c.arguments[0]);
  const leaked = ids.filter((id) => !cleared.includes(id));
  assert.equal(leaked.length, 1, 'exactly the deliberately leaked timer is detected');
  for (const id of ids) clearInterval(id);
});
