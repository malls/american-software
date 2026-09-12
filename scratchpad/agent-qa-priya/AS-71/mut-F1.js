// F1: rename the S2-ABANDON row id in the ledger. Anchored to the row's own
// leading two cells so it can land nowhere else.
const needle = '| `S2-ABANDON` | ABANDON |';
module.exports.mutate = (text) => {
  const count = text.split(needle).length - 1;
  if (count !== 1) throw new Error(`F1 needle occurs ${count} times, expected 1`);
  return {
    out: text.replace(needle, '| `S2-ABANDONED` | ABANDON |'),
    assert: (after) => {
      const applied = after.split('`S2-ABANDONED`').length - 1;
      if (applied !== 1 || after.includes('| `S2-ABANDON` |')) throw new Error('F1 did not apply at the site');
      console.log(`F1 applied on disk: \`S2-ABANDONED\` occurs ${applied} time(s); original row cell gone`);
    },
  };
};
