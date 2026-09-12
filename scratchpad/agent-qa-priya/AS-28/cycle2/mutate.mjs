// AS-28 cycle-2 mutant runner (qa-priya). Operates ONLY on the cycle-2 scratch
// copy (taken from the worktree at 2c96c27). Per mutant: site-assert the
// anchor (exactly once AND at the expected line), apply, re-read and assert
// the mutation landed, run `node --test`, record the exact failing-test set,
// restore from the worktree original and assert byte equality.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCRATCH = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-28/cycle2/scratch/apps/chat';
const WORKTREE = '/Users/forrest/Code/american-software-company/.worktrees/AS-28/apps/chat';
const SVG = 'public/favicon.svg';

const MUTANTS = {
  // ---- plan-named falsifiers (AC-1, AC-2, AC-3 a..f) ----
  M1_AC1_drop_static_entry: {
    file: 'server.js',
    edits: [{ from: "  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],\n", to: '', line: 40 }],
  },
  M2_AC2_drop_link_line: {
    file: 'public/index.html',
    edits: [{ from: '  <link rel="icon" type="image/svg+xml" href="/favicon.svg">\n', to: '', line: 8 }],
  },
  M3a_fill_FF0000: {
    file: SVG,
    edits: [{ from: '<path fill="#1C41E3"', to: '<path fill="#FF0000"', line: 5 }],
  },
  M3b_strip_every_hex_filewide: {
    file: SVG,
    edits: [
      { from: '#1C41E3 = --color-accent-500, #FFFFFF = --color-ink-white', to: 'accent-500 and ink-white', line: 4 },
      { from: '<path fill="#1C41E3"', to: '<path fill="none"', line: 5 },
      { from: '<circle fill="#FFFFFF" cx="9"', to: '<circle fill="none" cx="9"', line: 6 },
      { from: '<circle fill="#FFFFFF" cx="16"', to: '<circle fill="none" cx="16"', line: 7 },
      { from: '<circle fill="#FFFFFF" cx="23"', to: '<circle fill="none" cx="23"', line: 8 },
    ],
  },
  // cycle-1 survivor, re-run cold
  M3c_named_colors_comment_intact: {
    file: SVG,
    edits: [
      { from: '<path fill="#1C41E3"', to: '<path fill="red"', line: 5 },
      { from: '<circle fill="#FFFFFF" cx="9"', to: '<circle fill="lime" cx="9"', line: 6 },
      { from: '<circle fill="#FFFFFF" cx="16"', to: '<circle fill="lime" cx="16"', line: 7 },
      { from: '<circle fill="#FFFFFF" cx="23"', to: '<circle fill="lime" cx="23"', line: 8 },
    ],
  },
  // cycle-1 survivor, re-run cold
  M3d_8digit_hex: {
    file: SVG,
    edits: [{ from: '<path fill="#1C41E3"', to: '<path fill="#1C41E3FF"', line: 5 }],
  },
  M3e_every_paint_attr_removed: {
    file: SVG,
    edits: [
      { from: '<path fill="#1C41E3" d=', to: '<path d=', line: 5 },
      { from: '<circle fill="#FFFFFF" cx="9"', to: '<circle cx="9"', line: 6 },
      { from: '<circle fill="#FFFFFF" cx="16"', to: '<circle cx="16"', line: 7 },
      { from: '<circle fill="#FFFFFF" cx="23"', to: '<circle cx="23"', line: 8 },
    ],
  },
  M3f_style_attr_with_palette_fills_intact: {
    file: SVG,
    edits: [{ from: '<circle fill="#FFFFFF" cx="9"', to: '<circle fill="#FFFFFF" style="fill:red" cx="9"', line: 6 }],
  },

  // ---- qa-priya cycle-2 probes: doors neither cycle 1 nor the rework named ----
  // P1: a single-quoted paint attribute. The guard's regex reads only "..."
  // values; a fifth palette paint keeps the >=4 floor satisfied.
  P1_single_quoted_fill_plus_palette_stroke: {
    file: SVG,
    edits: [
      { from: '<path fill="#1C41E3" d=', to: '<path fill="#1C41E3" stroke="#1C41E3" d=', line: 5 },
      { from: '<circle fill="#FFFFFF" cx="9"', to: "<circle fill='red' cx=\"9\"", line: 6 },
    ],
  },
  // P1b: the same single-quoted fill ALONE (no extra stroke) — does the floor
  // catch it by count?
  P1b_single_quoted_fill_alone: {
    file: SVG,
    edits: [{ from: '<circle fill="#FFFFFF" cx="9"', to: "<circle fill='red' cx=\"9\"", line: 6 }],
  },
  // P2: colour through a <style> element, palette fills intact (the guard
  // claims to shut this door).
  P2_style_element: {
    file: SVG,
    edits: [{ from: '  <path fill="#1C41E3"', to: '  <style>circle{fill:red}</style>\n  <path fill="#1C41E3"', line: 5 }],
  },
  // P3: colour through SMIL — <set> repaints the path at t=0 in any SMIL-
  // capable renderer; not a paint attribute, not a style.
  P3_smil_set_fill: {
    file: SVG,
    edits: [{ from: '<path fill="#1C41E3" d="M6 3h20a4 4 0 0 1 4 4v13a4 4 0 0 1-4 4H14l-7 6v-6H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z"/>',
              to: '<path fill="#1C41E3" d="M6 3h20a4 4 0 0 1 4 4v13a4 4 0 0 1-4 4H14l-7 6v-6H6a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z"><set attributeName="fill" to="red"/></path>', line: 5 }],
  },
  // P4: a comment smuggling a paint (should be stripped: NOT count toward the
  // floor). Pair it with dropping one real paint so the floor is the only thing
  // that can go red.
  P4_comment_paint_plus_one_real_removed: {
    file: SVG,
    edits: [
      { from: '#1C41E3 = --color-accent-500, #FFFFFF = --color-ink-white', to: 'fill="#1C41E3" fill="#FFFFFF"', line: 4 },
      { from: '<circle fill="#FFFFFF" cx="9"', to: '<circle cx="9"', line: 6 },
    ],
  },
  // P5: artwork made invisible with palette intact (fill-opacity is not a
  // paint) — expected to SURVIVE; recorded to bound what AC-3 claims.
  P5_fill_opacity_zero: {
    file: SVG,
    edits: [{ from: '<path fill="#1C41E3" d=', to: '<path fill="#1C41E3" fill-opacity="0" d=', line: 5 }],
  },
  // P6: CORRECT artwork the guard might reject — a wrapping <g fill="none">
  // (legitimate SVG, no colour introduced).
  P6_legit_fill_none_group: {
    file: SVG,
    edits: [
      { from: '  <path fill="#1C41E3"', to: '  <g fill="none">\n  <path fill="#1C41E3"', line: 5 },
      // line 9 here: the first edit inserted one line above (site assertion runs on the already-edited text)
      { from: '<circle fill="#FFFFFF" cx="23" cy="13" r="2.5"/>\n', to: '<circle fill="#FFFFFF" cx="23" cy="13" r="2.5"/>\n  </g>\n', line: 9 },
    ],
  },
  // P7: CORRECT artwork, short-hex spelling of the same token.
  P7_short_hex_fff: {
    file: SVG,
    edits: [{ from: '<circle fill="#FFFFFF" cx="9"', to: '<circle fill="#fff" cx="9"', line: 6 }],
  },
  // P8: whitespace/newline around = and lowercase hex — correct artwork, must PASS.
  P8_whitespace_and_lowercase: {
    file: SVG,
    edits: [{ from: '<circle fill="#FFFFFF" cx="9"', to: '<circle fill =\n    "#ffffff" cx="9"', line: 6 }],
  },
  // P9: the comment stripper meets a comment that contains "--" inside a
  // quoted string on the same line as a real paint — does artwork survive?
  P9_comment_then_paint_same_line: {
    file: SVG,
    edits: [{ from: '  <circle fill="#FFFFFF" cx="9"', to: '  <!-- a --> <circle fill="#FFFFFF" cx="9"', line: 6 }],
  },
  // P10: 8-digit hex on a CIRCLE (M3d covers the path only).
  P10_8digit_hex_on_circle: {
    file: SVG,
    edits: [{ from: '<circle fill="#FFFFFF" cx="16"', to: '<circle fill="#FFFFFF80" cx="16"', line: 7 }],
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
  const reasons = [...out.matchAll(/^\s+error: (.+)$/gm)].map((m) => m[1]).slice(0, 4);
  return { status: r.status, failing: [...new Set(failing)], totals, reasons };
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
  try {
    for (const e of m.edits) {
      // For a pure insertion the replacement contains the anchor, so "original
      // absent" is the wrong assertion; assert the anchor count did not grow.
      const insertion = e.to.includes(e.from);
      if (!insertion && e.from.trim() && reread.includes(e.from)) throw new Error(`${name}: mutation did NOT apply (original text still present)`);
      if (insertion && reread.split(e.from).length - 1 !== 1) throw new Error(`${name}: insertion duplicated the anchor`);
      if (e.to.trim() && !reread.includes(e.to)) throw new Error(`${name}: mutation did NOT apply (replacement absent)`);
    }
    if (original.equals(Buffer.from(reread))) throw new Error(`${name}: file unchanged after mutation`);
  } catch (err) {
    writeFileSync(path, original);
    throw err;
  }
  console.log(`  mutation applied: ${m.file} differs from worktree original (${original.length} -> ${Buffer.byteLength(reread)} bytes)`);
  try {
    const r = runSuite();
    console.log(`  suite: exit=${r.status} tests=${r.totals.tests} pass=${r.totals.pass} fail=${r.totals.fail}`);
    console.log(`  RED SET (${r.failing.length}): ${r.failing.length ? r.failing.map((f) => `\n    - ${f}`).join('') : '(none — SURVIVOR)'}`);
    if (r.reasons.length) console.log(`  reasons: ${r.reasons.map((x) => `\n    ${x}`).join('')}`);
  } finally {
    writeFileSync(path, original);
    if (!readFileSync(path).equals(original)) throw new Error(`${name}: RESTORE FAILED for ${m.file}`);
    console.log(`  restored: ${m.file} byte-equal to worktree original`);
  }
}
