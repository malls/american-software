// Mutation plumbing for AS-71 (house technique): apply | restore | hash.
// usage: node mutate.mjs apply <F> | node mutate.mjs restore <F> | node mutate.mjs hash <relpath>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-71';
const LEDGER = 'docs/design/wireframes/02-states-ledger.md';
const DOCKERFILE = 'apps/invoicing/Dockerfile';
const PARSER = 'apps/invoicing/test/helpers/states-ledger.js';

// Each mutant: the file, the exact needle (must occur exactly once so the edit
// lands at the intended site), its replacement, and an occurrence check that
// proves the mutation applied.
const MUTANTS = {
  F1: { file: LEDGER, needle: '| `S2-ABANDON` | ABANDON |', replacement: '| `S2-ABANDONED` | ABANDON |', marker: 'S2-ABANDONED' },
  F2: { file: LEDGER, needle: '| `S3-LOADING` | LOADING |', replacement: '| `S3-LOADING` | DEFAULT |', marker: '| `S3-LOADING` | DEFAULT |' },
  F3: { file: DOCKERFILE, needle: 'COPY docs/design/wireframes/02-states-ledger.md ./vendor/states-ledger.md\n', replacement: '', marker: null },
  F4: {
    file: PARSER,
    // Anchored on the two lines that can only be the data-row push and the
    // zero-rows guard, inside parseStatesLedger.
    needle: "    screens.get(screen).rows.push(row);\n    rows.push({ screen, ...row });\n  }\n\n  if (rows.length === 0) throw new Error('states-ledger: the document yields no rows');\n",
    replacement: '    /* F4: rows never collected */\n  }\n\n  /* F4: zero-rows guard removed */\n',
    marker: '/* F4: rows never collected */',
  },
};

const sha = (text) => createHash('sha256').update(text).digest('hex');
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'hash') {
  console.log(sha(readFileSync(join(WT, arg), 'utf8')), arg);
} else if (cmd === 'apply' || cmd === 'restore') {
  const m = MUTANTS[arg];
  if (!m) throw new Error(`unknown mutant ${arg}`);
  const path = join(WT, m.file);
  const before = readFileSync(path, 'utf8');
  const backup = `/Users/forrest/Code/american-software-company/scratchpad/developer-marcus/AS-71/${arg}.backup`;
  if (cmd === 'apply') {
    const count = before.split(m.needle).length - 1;
    if (count !== 1) throw new Error(`${arg}: needle occurs ${count} times, expected exactly 1 — refusing`);
    writeFileSync(backup, before);
    const after = before.replace(m.needle, m.replacement);
    writeFileSync(path, after);
    const onDisk = readFileSync(path, 'utf8');
    const markerCount = m.marker === null ? null : onDisk.split(m.marker).length - 1;
    const needleGone = onDisk.split(m.needle).length - 1;
    console.log(JSON.stringify({ mutant: arg, file: m.file, applied: onDisk !== before, markerOccurrences: markerCount, needleOccurrencesAfter: needleGone, shaBefore: sha(before), shaAfter: sha(onDisk) }));
  } else {
    const original = readFileSync(backup, 'utf8');
    writeFileSync(path, original);
    const restored = readFileSync(path, 'utf8');
    console.log(JSON.stringify({ mutant: arg, file: m.file, restored: restored === original, sha: sha(restored) }));
  }
} else {
  throw new Error('usage: apply <F> | restore <F> | hash <relpath>');
}
