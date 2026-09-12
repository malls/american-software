// F2: S3-LOADING's Category cell LOADING -> DEFAULT. Anchored on the id cell.
const needle = '| `S3-LOADING` | LOADING |';
module.exports.mutate = (text) => {
  const count = text.split(needle).length - 1;
  if (count !== 1) throw new Error(`F2 needle occurs ${count} times, expected 1`);
  return {
    out: text.replace(needle, '| `S3-LOADING` | DEFAULT |'),
    assert: (after) => {
      const applied = after.split('| `S3-LOADING` | DEFAULT |').length - 1;
      if (applied !== 1 || after.includes(needle)) throw new Error('F2 did not apply at the site');
      console.log(`F2 applied on disk: S3-LOADING row now DEFAULT (${applied} occurrence); LOADING cell gone`);
    },
  };
};
