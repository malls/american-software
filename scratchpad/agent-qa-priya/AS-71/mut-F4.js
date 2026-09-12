// F4: in parseStatesLedger, drop the two pushes in the data-row branch AND the
// zero-rows throw. Both anchored on their exact surrounding lines inside the
// function body (screens.get(screen).rows.push / rows.push / the throw text).
const pushA = '    screens.get(screen).rows.push(row);\n';
const pushB = '    rows.push({ screen, ...row });\n';
const zero = "  if (rows.length === 0) throw new Error('states-ledger: the document yields no rows');\n";
module.exports.mutate = (text) => {
  for (const [label, n] of [['pushA', pushA], ['pushB', pushB], ['zero', zero]]) {
    const c = text.split(n).length - 1;
    if (c !== 1) throw new Error(`F4 ${label} occurs ${c} times, expected 1`);
  }
  const fnStart = text.indexOf('export function parseStatesLedger');
  if (fnStart < 0 || text.indexOf(pushA) < fnStart || text.indexOf(zero) < fnStart) throw new Error('F4 anchors are not inside parseStatesLedger');
  return {
    out: text.replace(pushA, '').replace(pushB, '').replace(zero, ''),
    assert: (after) => {
      if (after.includes('rows.push(') || after.includes('yields no rows')) throw new Error('F4 did not apply');
      console.log('F4 applied on disk: both rows.push calls and the zero-rows throw removed from parseStatesLedger');
    },
  };
};
