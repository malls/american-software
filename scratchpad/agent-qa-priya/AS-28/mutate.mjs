// AS-28 mutant runner (qa-priya). Operates ONLY on the scratch copy under
// scratchpad/agent-qa-priya/AS-28/scratch/apps/chat. For each mutant:
//   1. read the scratch file, assert the anchor pattern occurs exactly once
//      AND at the expected line (site assertion, per the AS-95 sharpening),
//   2. apply, re-read, assert the mutated text is present and the original is
//      absent (mutation applied),
//   3. run `node --test`, collect the exact failing-test set,
//   4. restore from the worktree original and assert byte equality.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCRATCH = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-28/scratch/apps/chat';
const WORKTREE = '/Users/forrest/Code/american-software-company/.worktrees/AS-28/apps/chat';

const MUTANTS = {
  M1_AC1_drop_static_entry: {
    file: 'server.js',
    edits: [{ from: "  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],\n", to: '', line: 40 }],
  },
  M2_AC2_drop_link_line: {
    file: 'public/index.html',
    edits: [{ from: '  <link rel="icon" type="image/svg+xml" href="/favicon.svg">\n', to: '', line: 8 }],
  },
  M3a_AC3_fill_FF0000: {
    file: 'public/favicon.svg',
    edits: [{ from: '<path fill="#1C41E3"', to: '<path fill="#FF0000"', line: 5 }],
  },
  M3b_AC3_strip_every_hex: {
    file: 'public/favicon.svg',
    edits: [
      { from: '#1C41E3 = --color-accent-500, #FFFFFF = --color-ink-white', to: 'accent-500 and ink-white', line: 4 },
      { from: '<path fill="#1C41E3"', to: '<path fill="none"', line: 5 },
      { from: '<circle fill="#FFFFFF" cx="9"', to: '<circle fill="none" cx="9"', line: 6 },
      { from: '<circle fill="#FFFFFF" cx="16"', to: '<circle fill="none" cx="16"', line: 7 },
      { from: '<circle fill="#FFFFFF" cx="23"', to: '<circle fill="none" cx="23"', line: 8 },
    ],
  },
  // qa-priya M6 probe: artwork fills become NON-palette named colors; the XML
  // comment (which also carries the two hex strings) is left intact.
  M3c_probe_named_colors_comment_intact: {
    file: 'public/favicon.svg',
    edits: [
      { from: '<path fill="#1C41E3"', to: '<path fill="red"', line: 5 },
      { from: '<circle fill="#FFFFFF" cx="9"', to: '<circle fill="lime" cx="9"', line: 6 },
      { from: '<circle fill="#FFFFFF" cx="16"', to: '<circle fill="lime" cx="16"', line: 7 },
      { from: '<circle fill="#FFFFFF" cx="23"', to: '<circle fill="lime" cx="23"', line: 8 },
    ],
  },
  // qa-priya M6 probe: 8-digit hex with alpha on the fill (#rrggbbaa).
  M3d_probe_8digit_hex: {
    file: 'public/favicon.svg',
    edits: [{ from: '<path fill="#1C41E3"', to: '<path fill="#1C41E3FF"', line: 5 }],
  },
};

const only = process.argv.slice(2);
const names = only.length ? only : Object.keys(MUTANTS);

function lineOf(text, needle) {
  const idx = text.indexOf(needle);
  return idx < 0 ? -1 : text.slice(0, idx).split('\n').length;
}

function runSuite() {
  const r = spawnSync('node', ['--test'], { cwd: SCRATCH, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout + r.stderr;
  const failing = [...out.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]);
  const totals = Object.fromEntries(['tests', 'pass', 'fail'].map((k) => [k, Number((out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1])]));
  return { status: r.status, failing: [...new Set(failing)], totals };
}

for (const name of names) {
  const m = MUTANTS[name];
  const path = `${SCRATCH}/${m.file}`;
  const original = readFileSync(`${WORKTREE}/${m.file}`);
  let text = readFileSync(path, 'utf8');
  if (!original.equals(Buffer.from(text))) throw new Error(`${name}: scratch ${m.file} is not pristine before mutation`);
  console.log(`\n=== ${name} (${m.file}) ===`);
  for (const e of m.edits) {
    const count = text.split(e.from).length - 1;
    const at = lineOf(text, e.from);
    if (count !== 1) throw new Error(`${name}: anchor occurs ${count} times, expected exactly 1: ${JSON.stringify(e.from)}`);
    if (at !== e.line) throw new Error(`${name}: anchor found at line ${at}, expected line ${e.line}`);
    text = text.replace(e.from, e.to);
    console.log(`  site ok: line ${at}: ${JSON.stringify(e.from.trim())} -> ${JSON.stringify(e.to.trim())}`);
  }
  writeFileSync(path, text);
  const reread = readFileSync(path, 'utf8');
  for (const e of m.edits) {
    if (e.from.trim() && reread.includes(e.from)) throw new Error(`${name}: mutation did NOT apply (original text still present)`);
    if (e.to.trim() && !reread.includes(e.to)) throw new Error(`${name}: mutation did NOT apply (replacement absent)`);
  }
  if (original.equals(Buffer.from(reread))) throw new Error(`${name}: file unchanged after mutation`);
  console.log(`  mutation applied: ${m.file} differs from worktree original (${original.length} -> ${Buffer.byteLength(reread)} bytes)`);
  try {
    const r = runSuite();
    console.log(`  suite: exit=${r.status} tests=${r.totals.tests} pass=${r.totals.pass} fail=${r.totals.fail}`);
    console.log(`  RED SET (${r.failing.length}): ${r.failing.length ? r.failing.map((f) => `\n    - ${f}`).join('') : '(none — SURVIVOR)'}`);
  } finally {
    writeFileSync(path, original);
    if (!readFileSync(path).equals(original)) throw new Error(`${name}: RESTORE FAILED for ${m.file}`);
    console.log(`  restored: ${m.file} byte-equal to worktree original`);
  }
}
