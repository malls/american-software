// Applies one AS-72 finding-1 mutant to the worktree's public/app.js and
// asserts it landed AT THE INTENDED SITE (occurrence-accurate anchor +
// line-number check), per the AS-95 sharpening. Exit non-zero if not.
import { readFileSync, writeFileSync } from 'node:fs';

const APP = '/Users/forrest/Code/american-software-company/.worktrees/AS-72/apps/chat/public/app.js';
const name = process.argv[2];
const src = readFileSync(APP, 'utf8');

// The reconcile-poll block. Anchored on all three of its lines together, so
// it can only match the site at app.js:1547-1549.
const RECONCILE = '  setInterval(() => {\n    refreshSidebar().catch(() => {});\n  }, 60_000);\n';
// The age-tick block, app.js:1557-1561.
const AGETICK = '  setInterval(() => {\n    renderLoopStatus();\n    renderLanesBadge();\n    renderLanes();\n  }, 15_000);\n';

const occurrences = (hay, needle) => hay.split(needle).length - 1;
const lineOf = (hay, idx) => hay.slice(0, idx).split('\n').length;

const mutants = {
  // M1: the old guard's blind spot — a nested `setTimeout(fn, 60_000)` in the
  // reconcile body plus a real cadence of 5_000.
  M1: {
    anchor: RECONCILE,
    replacement:
      '  setInterval(() => {\n    refreshSidebar().catch(() => {});\n    setTimeout(() => {}, 60_000);\n  }, 5_000);\n',
    site: 1547,
  },
  // M2: a third interval — presence-checking guards stay green, a
  // complete-contents guard does not.
  M2: {
    anchor: RECONCILE,
    replacement: RECONCILE + '  setInterval(() => refreshSidebar(), 45_000);\n',
    site: 1547,
  },
  // M3: network inside the render-only tick.
  M3: {
    anchor: AGETICK,
    replacement: AGETICK.replace('    renderLanes();\n', "    renderLanes();\n    fetch('/api/lanes');\n"),
    site: 1557,
  },
};

const m = mutants[name];
if (!m) throw new Error(`unknown mutant ${name}`);

const n = occurrences(src, m.anchor);
if (n !== 1) {
  console.error(`ANCHOR MISS: ${name} anchor occurs ${n} times, expected exactly 1`);
  process.exit(1);
}
const at = src.indexOf(m.anchor);
const line = lineOf(src, at);
if (line !== m.site) {
  console.error(`SITE MISS: ${name} anchor at line ${line}, expected ${m.site}`);
  process.exit(1);
}

const out = src.replace(m.anchor, m.replacement);
if (out === src) {
  console.error(`NO-OP: ${name} replacement identical to source`);
  process.exit(1);
}
writeFileSync(APP, out);

// Re-read and prove the mutation is present at the intended site.
const after = readFileSync(APP, 'utf8');
const marker = {
  M1: '    setTimeout(() => {}, 60_000);\n  }, 5_000);',
  M2: '  setInterval(() => refreshSidebar(), 45_000);',
  M3: "    fetch('/api/lanes');",
}[name];
const mn = occurrences(after, marker);
if (mn !== 1) {
  console.error(`VERIFY MISS: ${name} marker present ${mn} times after write`);
  process.exit(1);
}
console.log(`${name} applied at line ${lineOf(after, after.indexOf(marker))} (anchor site ${m.site}), marker count ${mn}`);
