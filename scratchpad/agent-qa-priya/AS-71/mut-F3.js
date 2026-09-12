// F3: delete the ledger COPY line from the Dockerfile. Anchored on the full instruction.
const needle = 'COPY docs/design/wireframes/02-states-ledger.md ./vendor/states-ledger.md\n';
module.exports.mutate = (text) => {
  const count = text.split(needle).length - 1;
  if (count !== 1) throw new Error(`F3 needle occurs ${count} times, expected 1`);
  return {
    out: text.replace(needle, ''),
    assert: (after) => {
      if (after.includes('02-states-ledger.md ./vendor')) throw new Error('F3 did not apply');
      const copies = after.split('\n').filter((l) => /^COPY /.test(l)).length;
      console.log(`F3 applied on disk: ledger COPY gone; ${copies} COPY instructions remain (expect 10)`);
      if (copies !== 10) throw new Error(`expected 10 COPY lines after F3, found ${copies}`);
    },
  };
};
