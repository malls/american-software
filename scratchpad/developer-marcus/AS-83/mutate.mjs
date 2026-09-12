// AS-83 mutation runner (scratch, not committed).
// usage: node mutate.mjs m1|m2|m3
// Applies one anchored mutation, asserts it applied AT THE INTENDED SITE,
// runs test/mode.test.js only, restores in a finally, and prints the
// before/after sha256 so the restore is proven, not assumed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const APP = '/Users/forrest/Code/american-software-company/.worktrees/AS-83/apps/chat';
const which = process.argv[2];

const sha = (s) => createHash('sha256').update(s).digest('hex');
const count = (hay, needle) => hay.split(needle).length - 1;
const must = (cond, msg) => {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg);
  console.log('  ok: ' + msg);
};

const MUTANTS = {
  // M1 — CLI writes bypass the server (rule 3 returns the direct backend).
  m1: {
    file: 'bin/chat.js',
    apply(src) {
      const OLD = "    if (result.state === 'up') return createApiBackend(api);";
      const NEW = "    if (result.state === 'up') return createDirectBackend(db || DEFAULT_DB);";
      must(count(src, OLD) === 1, `anchor "${OLD.trim()}" occurs exactly once`);
      return src.replace(OLD, NEW);
    },
    verify(src) {
      const a = src.indexOf('  if (api) {');
      const b = src.indexOf('  if (db) return createDirectBackend(db);');
      must(count(src, '  if (api) {') === 1, 'rule-3 block opener occurs once (slice is unambiguous)');
      must(a > -1 && b > a, 'rule-3 slice located');
      const slice = src.slice(a, b);
      must(count(slice, 'createDirectBackend(db || DEFAULT_DB)') === 2, 'rule-3 slice has 2 createDirectBackend(db || DEFAULT_DB)');
      must(count(slice, 'createApiBackend(') === 0, 'rule-3 slice has 0 createApiBackend(');
    },
    predicted: ['AS-24 — API-mode writes land in the server view', 'full command sweep', 'AS-83 — the same slow server inside the budget is up'],
  },
  // M2 — a probe timeout is treated as 'down' (the AS-24 invariant broken).
  m2: {
    file: 'lib/client.js',
    apply(src) {
      const start = src.indexOf('export async function probe');
      const end = src.indexOf('\nconst CONV_KEYS');
      must(start > -1 && end > start, 'probe() body located');
      const body = src.slice(start, end);
      must(count(body, 'isConnDown(e)') === 1, 'isConnDown(e) is called exactly once inside probe()');
      const a = body.indexOf('    return isConnDown(e)');
      const b = body.indexOf('\n  }', a);
      must(a > -1 && b > a, 'the catch-block return located inside probe()');
      const mutatedBody = body.slice(0, a) + "    return { state: 'down', reason: errCode(e) };" + body.slice(b);
      return src.slice(0, start) + mutatedBody + src.slice(end);
    },
    verify(src) {
      const body = src.slice(src.indexOf('export async function probe'), src.indexOf('\nconst CONV_KEYS'));
      must(count(body, 'isConnDown(e)') === 0, 'probe() body no longer calls isConnDown(e)');
      must(count(body, "state: 'down'") === 1, "probe() body returns 'down' unconditionally from the catch");
      must(count(src, 'function isConnDown(err)') === 1, 'the isConnDown definition still exists (mutation hit the call, not the definition)');
    },
    predicted: ['AS-24 — probe timeout (trap)', 'AS-83 — the flake signature'],
  },
  // M3 — the CHAT_PROBE_TIMEOUT_MS knob is ignored and unvalidated.
  m3: {
    file: 'bin/chat.js',
    apply(src) {
      const OLD = '  const timeoutMs = probeBudget();';
      const NEW = '  const timeoutMs = DEFAULT_PROBE_TIMEOUT_MS;';
      must(count(src, OLD) === 1, 'the single probeBudget() call site occurs once');
      return src.replace(OLD, NEW);
    },
    verify(src) {
      const a = src.indexOf('async function resolveBackend');
      const b = src.indexOf('function createDirectBackend');
      must(a > -1 && b > a, 'resolveBackend slice located');
      const slice = src.slice(a, b);
      must(count(slice, 'probeBudget()') === 0, 'resolveBackend no longer calls probeBudget()');
      must(count(slice, 'CHAT_PROBE_TIMEOUT_MS') === 0, 'resolveBackend no longer reads or names the knob');
      must(count(src, 'function probeBudget()') === 1, 'the probeBudget definition still exists (mutation hit the call site)');
    },
    predicted: ['AS-83 — the flake signature', 'AS-83 — CHAT_PROBE_TIMEOUT_MS must be a positive integer'],
  },
};

const m = MUTANTS[which];
if (!m) throw new Error('unknown mutant: ' + which);
const path = APP + '/' + m.file;
const original = readFileSync(path, 'utf8');
const before = sha(original);
console.log(`[${which}] ${m.file} sha BEFORE ${before}`);
console.log(`[${which}] predicted red: ${m.predicted.join(' | ')}`);

try {
  const mutated = m.apply(original);
  if (mutated === original) throw new Error('mutation produced an identical file');
  writeFileSync(path, mutated);
  m.verify(readFileSync(path, 'utf8'));
  console.log(`[${which}] --- running node --test test/mode.test.js ---`);
  const r = spawnSync(process.execPath, ['--test', 'test/mode.test.js'], { cwd: APP, encoding: 'utf8' });
  const lines = r.stdout.split('\n');
  writeFileSync(`/Users/forrest/Code/american-software-company/scratchpad/developer-marcus/AS-83/${which}-raw.txt`, r.stdout);
  console.log(lines.filter((l) => /^(✔|✖|ℹ (tests|pass|fail))/.test(l)).join('\n'));
  console.log(`[${which}] suite exit ${r.status}`);
} finally {
  writeFileSync(path, original);
  console.log(`[${which}] ${m.file} sha AFTER  ${sha(readFileSync(path, 'utf8'))}`);
  console.log(`[${which}] restored equal: ${sha(readFileSync(path, 'utf8')) === before}`);
}
