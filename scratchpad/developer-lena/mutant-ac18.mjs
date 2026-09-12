// AS-100 cycle 5 — the AC-18 mutant, driven in place with a guaranteed restore.
// Backup -> mutate -> ASSERT THE MUTATION LANDED AT THE INTENDED SITE (print the
// applied-site diff with line numbers) -> run -> restore in `finally`.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = '/Users/forrest/Code/american-software-company/.worktrees/AS-100/apps/chat';
const TARGET = `${ROOT}/public/lanes.js`;
const BACKUP = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/lanes.js.orig';

const original = readFileSync(TARGET, 'utf8');
copyFileSync(TARGET, BACKUP);

// The intended site: the stale-open branch inside describeLive — the ONLY
// `if (openTypes) {` in the file. Anchoring on the whole block (not on a loose
// substring) is the AS-95 sharpening: a pattern that can hit only one place.
const SITE = `  if (openTypes) {
    const since = stampUTC(last.ts ?? sub.startedAt);
    return {
      stageTimer: \`\${stage} — no signal since \${since} (tick box expired)\`,
      subAgent: \`\${actor} · no signal since \${since}\`,
      liveTone: 'alert',
    };
  }`;
const MUTANT = `  if (openTypes) {
    const since = stampUTC(last.ts ?? sub.startedAt);
    return {
      stageTimer: \`\${stage} running for \${fmtAge(ageSince(sub.startedAt, nowMs))}\`,
      subAgent: \`\${actor} · working\`,
      liveTone: 'live',
    };
  }`;

const hits = original.split(SITE).length - 1;
if (hits !== 1) throw new Error(`site matched ${hits} times, refusing to mutate`);

const mutated = original.replace(SITE, MUTANT);
let out;
try {
  writeFileSync(TARGET, mutated);

  // Assert it landed, and SAY WHERE: line numbers + the mutated lines.
  const now = readFileSync(TARGET, 'utf8');
  if (now === original) throw new Error('mutation did not apply');
  const lines = now.split('\n');
  const at = lines.findIndex((l) => l.includes('if (openTypes) {'));
  console.log(`applied at ${TARGET}:${at + 1} (describeLive stale-open branch)`);
  for (let i = at; i < at + 8; i += 1) console.log(`  ${i + 1}\t${lines[i]}`);

  try {
    out = execFileSync('node', ['--test', 'test/lanes-label.test.js'], { cwd: ROOT, encoding: 'utf8' });
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`;
  }
} finally {
  copyFileSync(BACKUP, TARGET);
}

const red = [...out.matchAll(/^✖ (.+?) \(/gm)].map((m) => m[1]);
console.log('\nRED SET:');
for (const r of new Set(red)) console.log(`  - ${r}`);
console.log((out.match(/^ℹ (tests|pass|fail) \d+$/gm) || []).join('\n'));
