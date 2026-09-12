// AS-80 planning probe: does t.mock.method(globalThis, 'setInterval') observe a
// bare-identifier call made inside an imported ESM module, and does the mock
// pass the real Timeout through (so .unref() still works)?
export function make(ms) {
  const a = setInterval(() => {}, ms);
  a.unref();
  const b = setInterval(() => {}, ms);
  b.unref();
  return {
    close() {
      clearInterval(a);
      // b deliberately leaked — this is the AS-80 mutant shape
    },
  };
}
