// Indivisible mutation step: backup OUTSIDE the tree, mutate, assert applied AT the site,
// run mode.test.js, restore in finally, prove restoration by sha256 + git status --porcelain.
// Usage: node mutate.mjs M1|M2|M3
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-83/apps/chat';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-83';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-83';
const which = process.argv[2];
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const occ = (s, sub) => s.split(sub).length - 1;

const M = {
  M1: {
    file: 'bin/chat.js',
    edit(src) {
      const a = src.indexOf('if (api) {');
      const b = src.indexOf('if (db) return createDirectBackend(db);');
      if (a < 0 || b < 0 || b < a) throw new Error('anchors not found');
      const slice = src.slice(a, b);
      if (occ(slice, "if (result.state === 'up') return createApiBackend(api);") !== 1) throw new Error('site not unique in rule-3 slice');
      const out = src.slice(0, a) + slice.replace("if (result.state === 'up') return createApiBackend(api);", "if (result.state === 'up') return createDirectBackend(db || DEFAULT_DB);") + src.slice(b);
      return out;
    },
    assertApplied(src) {
      const a = src.indexOf('if (api) {');
      const b = src.indexOf('if (db) return createDirectBackend(db);');
      const slice = src.slice(a, b);
      return occ(slice, 'createDirectBackend(db || DEFAULT_DB)') === 2 && occ(slice, 'createApiBackend(') === 0 && occ(src, 'createApiBackend(api)') === 0;
    },
    predicted: ['AS-24 — API-mode writes', 'full command sweep', 'AS-83 — the same slow server inside the budget'],
  },
  M2: {
    file: 'lib/client.js',
    edit(src) {
      const a = src.indexOf('export async function probe');
      const b = src.indexOf('\nexport', a + 1);
      if (a < 0 || b < 0) throw new Error('probe slice not found');
      const slice = src.slice(a, b);
      if (occ(slice, 'isConnDown(e)') !== 1) throw new Error('isConnDown(e) not unique in probe');
      // replace the whole ternary `return isConnDown(e) ? {...down...} : {...ambiguous...};` with unconditional down
      const start = slice.indexOf('return isConnDown(e)');
      const end = slice.indexOf('};', start) + 2; // end of the ambiguous object literal + semicolon
      const replaced = slice.slice(0, start) + "return { state: 'down', reason: errCode(e) };" + slice.slice(end);
      return src.slice(0, a) + replaced + src.slice(b);
    },
    assertApplied(src) {
      const a = src.indexOf('export async function probe');
      const b = src.indexOf('\nexport', a + 1);
      const slice = src.slice(a, b);
      return occ(slice, 'isConnDown(e)') === 0 && occ(src, 'function isConnDown') === 1 && occ(slice, "timed out after") === 0 && occ(slice, "return { state: 'down', reason: errCode(e) };") === 1;
    },
    predicted: ['AS-24 — probe timeout', 'AS-83 — a live server that answers slower'],
  },
  M3: {
    file: 'bin/chat.js',
    edit(src) {
      const a = src.indexOf('function probeBudget()');
      const b = src.indexOf('\n}\n', a) + 3;
      if (a < 0 || b < 3) throw new Error('probeBudget not found');
      const slice = src.slice(a, b);
      if (occ(slice, 'process.env.CHAT_PROBE_TIMEOUT_MS') !== 1) throw new Error('env read not unique in probeBudget');
      return src.slice(0, a) + 'function probeBudget() {\n  return DEFAULT_PROBE_TIMEOUT_MS;\n}\n' + src.slice(b);
    },
    assertApplied(src) {
      const a = src.indexOf('function probeBudget()');
      const b = src.indexOf('\n}\n', a) + 3;
      const slice = src.slice(a, b);
      // knob literal must survive ONLY in comments/usage, not in probeBudget's body
      return occ(slice, 'CHAT_PROBE_TIMEOUT_MS') === 0 && occ(slice, 'return DEFAULT_PROBE_TIMEOUT_MS;') === 1 && occ(src, 'const timeoutMs = probeBudget();') === 1;
    },
    predicted: ['AS-83 — a live server that answers slower', 'AS-83 — CHAT_PROBE_TIMEOUT_MS must be a positive integer'],
  },
};

const m = M[which];
if (!m) throw new Error('unknown mutation ' + which);
const target = `${W}/${m.file}`;
const backup = `${S}/${which}.${m.file.replace('/', '_')}.orig`;
copyFileSync(target, backup);
const before = sha(target);
console.log(`[${which}] target ${m.file} sha BEFORE ${before}`);
let result;
try {
  const mutated = m.edit(readFileSync(target, 'utf8'));
  writeFileSync(target, mutated);
  const applied = m.assertApplied(readFileSync(target, 'utf8'));
  console.log(`[${which}] mutation applied at site: ${applied}`);
  if (!applied) throw new Error('mutation did not apply at the intended site — aborting');
  console.log(`[${which}] diff:\n` + spawnSync('git', ['-C', WT, 'diff', '--', `apps/chat/${m.file}`], { encoding: 'utf8' }).stdout);
  process.chdir(W);
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-reporter-destination=stdout', 'test/mode.test.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!/^# tests \d+/m.test(r.stdout)) throw new Error('no TAP summary found — run output unparsed, result void');
  const lines = r.stdout.split('\n');
  const fails = lines.filter((l) => /^\s*not ok/.test(l)).map((l) => l.replace(/^\s*not ok \d+ - /, ''));
  const summary = lines.filter((l) => /^# (tests|pass|fail)/.test(l));
  // grab the failure reason head for each
  const detail = [];
  for (let i = 0; i < lines.length; i++) if (/^\s*not ok/.test(lines[i])) detail.push(lines.slice(i + 1, i + 40).filter((l) => /message:|exit \d|exit null|timed out|actual:|expected:/.test(l)).slice(0, 4).map((l) => '      ' + l.trim()).join('\n'));
  result = { fails, summary, detail, status: r.status };
} finally {
  copyFileSync(backup, target);
  unlinkSync(backup);
}
const after = sha(target);
const porcelain = spawnSync('git', ['-C', WT, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
console.log(`[${which}] sha AFTER  ${after}  restored=${after === before}  porcelain='${porcelain.trim()}'`);
console.log(`[${which}] summary: ${result.summary.join(' | ')}`);
console.log(`[${which}] RED SET (${result.fails.length}):`);
result.fails.forEach((f, i) => console.log('  - ' + f + '\n' + result.detail[i]));
console.log(`[${which}] predicted (${m.predicted.length}): ${m.predicted.join(' ; ')}`);
const matched = m.predicted.every((p) => result.fails.some((f) => f.includes(p))) && result.fails.length === m.predicted.length;
console.log(`[${which}] exact match to prediction: ${matched}`);
