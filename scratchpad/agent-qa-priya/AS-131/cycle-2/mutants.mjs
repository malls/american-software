// AS-131 review cycle 2 mutant battery (qa-priya). Runs in the SCRATCH worktree
// /private/tmp/AS-131-mutant (detached at b90f2fa) — never in .worktrees/AS-131.
// For each falsifier: back up, apply the mutation, ASSERT it applied at the
// intended site (exactly one occurrence; the mutated diff's hunk covers the
// expected line and carries the replacement text), run the named test files,
// record the EXACT red set (names of ✖ tests from the "failing tests" block),
// restore (also on exit/signal), then `git diff --exit-code` at the end.
// M11 is the cycle-1 criterion-12 falsifier; M1..M10 are the cycle-0 set,
// re-run at the new tip to check the recorded red sets are reproduced.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const WT = '/private/tmp/AS-131-mutant';
const APP = `${WT}/apps/chat`;
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-131/cycle-2';
const LOG = `${OUT}/mutant-battery.log`;
const head = spawnSync('git', ['-C', WT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
writeFileSync(LOG, `AS-131 cycle-2 mutant battery ${new Date().toISOString()} scratch=${WT} HEAD=${head}\n`);
const log = (s) => { console.log(s); appendFileSync(LOG, s + '\n'); };

const backups = new Map();
const restoreAll = () => { for (const [f, c] of backups) writeFileSync(f, c); backups.clear(); };
process.on('exit', restoreAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { restoreAll(); process.exit(128); });

// Expected red sets = what cycle 1 recorded (scratchpad/agent-qa-priya/AS-131/mutant-battery.log).
const S = {
  storeWalk: 'AS-131: getMessagesPage walks a 5-root conversation newest-first in ascending pages, with hasMore/nextBefore',
  storeThreads: 'AS-131: page threads carry every reply of each page root and no reply of any other root',
  storeGate: 'AS-131: page mode validates before/limit only after the visibility gate — hidden probes stay byte-identical',
  apiWalk: 'api: AS-131 — ?before=&limit= walks a 5-root conversation newest-first with hasMore/nextBefore; empty conversation terminal shape',
  apiThreads: 'api: AS-131 — page threads are scoped to the page roots; limit/before validation is 400 on a visible channel',
  apiWatermark: 'api: AS-131 — the read watermark is conversation-wide: a page-mode open + POST /api/read without upTo leaves zero unread',
  apiParity: 'api: AS-131 — hidden channel in page mode 404s byte-identically to a nonexistent id, even with a malformed cursor',
  apiLimit: 'api: AS-24 — GET /api/messages honors ?limit= (CLI history --limit parity)',
  liveMerge: 'AS-131 live: mergeOlderPage prepends id-ordered, dedupes, adopts the cursor, and replaces only the page roots’ threads',
  liveEnsure: 'AS-131 live: ensureLoaded pages back until the target is loaded, stops on hasMore:false, and caps at 20 pages',
  liveOrphan: 'AS-131 live: a reply whose root is outside the loaded pages is not loaded — findLoaded/isLoaded fall through so ensureLoaded pages the root in (criterion 12, F1)',
  scrollDelta: 'scroll: prependPreservingScroll — scrollTop moves by exactly the height delta (300 -> 900, 0 -> 600)',
  scrollSticky: 'scroll: prependPreservingScroll — never consults the sticky-bottom rule, and no growth means no movement',
};

const MUTANTS = [
  // M11 — criterion 12 falsifier: restore the reply-only check in findLoaded.
  { id: 'M11', file: 'public/live.js',
    from: 'if (hit) return data.messages.some((m) => m.id === hit.threadRootId) ? hit : null;',
    to: 'if (hit) return hit;',
    line: 119, tests: ['test/live.test.js'], expect: [S.liveOrphan] },
  { id: 'M1', file: 'lib/store.js', from: 'ORDER BY m.id DESC', to: 'ORDER BY m.id ASC', line: 684, tests: ['test/store.test.js', 'test/api.test.js'],
    expect: [S.apiWalk, S.apiThreads, S.apiWatermark, S.storeWalk, S.storeThreads] },
  { id: 'M2', file: 'lib/store.js', from: '(? = 0 OR m.id < ?)', to: '(? = 0 OR m.id <= ?)', line: 683, tests: ['test/store.test.js', 'test/api.test.js'],
    expect: [S.apiWalk, S.apiThreads, S.storeWalk, S.storeThreads] },
  { id: 'M3', file: 'lib/store.js', from: '.all(conv.id, cursor, cursor, size + 1)', to: '.all(conv.id, cursor, cursor, size)', line: 687, tests: ['test/store.test.js', 'test/api.test.js'],
    expect: [S.apiWalk, S.storeWalk] },
  { id: 'M4', file: 'lib/store.js', from: 'WHERE thread_root_id IN (${marks})', to: 'WHERE thread_root_id IN (${marks}) OR thread_root_id IS NOT NULL', line: 699, tests: ['test/store.test.js', 'test/api.test.js'],
    expect: [S.apiThreads, S.apiWatermark, S.storeThreads] },
  { id: 'M5', file: 'server.js', from: "if (q('before') != null) {", to: "if (q('before') != null || q('limit') != null) {", line: 1036, tests: ['test/api.test.js'],
    expect: [S.apiLimit] },
  { id: 'M6', file: 'lib/store.js',
    from: "    requireVisible(conv, me, conversation);\n    const cursor = Number(before);\n    if (!Number.isInteger(cursor) || cursor < 0) {\n      throw new StoreError(`Invalid before '${before}'.`);\n    }\n",
    to: "    const cursor = Number(before);\n    if (!Number.isInteger(cursor) || cursor < 0) {\n      throw new StoreError(`Invalid before '${before}'.`);\n    }\n    requireVisible(conv, me, conversation);\n",
    line: 668, tests: ['test/store.test.js', 'test/api.test.js'], expect: [S.apiParity, S.storeGate] },
  { id: 'M7', file: 'public/app.js', from: "await post('/api/read', { me: state.me, conversation: conv.id }).catch(() => {});", to: "await post('/api/read', { me: state.me, conversation: conv.id, upTo: state.lastReadSent }).catch(() => {});", line: 755, tests: ['test/api.test.js'],
    expect: [S.apiWatermark] },
  { id: 'M8', file: 'public/live.js', from: 'data.messages.unshift(...fresh);', to: 'data.messages.push(...fresh);', line: 93, tests: ['test/live.test.js'],
    expect: [S.liveMerge, S.liveEnsure] },
  { id: 'M8b', file: 'public/live.js', from: '.filter((m) => !have.has(m.id));', to: '.filter(() => true);', line: 90, tests: ['test/live.test.js'],
    expect: [S.liveMerge] },
  { id: 'M9', file: 'public/scroll.js', from: 'pane.scrollTop = savedTop + (pane.scrollHeight - heightBefore);', to: 'pane.scrollTop = savedTop;', line: 64, tests: ['test/scroll.test.js'],
    expect: [S.scrollDelta, S.scrollSticky] },
  { id: 'M10', file: 'public/live.js', from: 'if (!data.hasMore || pages >= maxPages) return false;', to: 'if (pages >= maxPages) return false;', line: 126, tests: ['test/live.test.js'],
    expect: [S.liveEnsure] },
];

const summary = [];
for (const m of MUTANTS) {
  const path = `${APP}/${m.file}`;
  const orig = readFileSync(path, 'utf8');
  backups.set(path, orig);
  const count = orig.split(m.from).length - 1;
  if (count !== 1) { log(`${m.id}: ABORT target occurs ${count} times in ${m.file}`); backups.delete(path); continue; }
  const idx = orig.indexOf(m.from);
  const lineAt = orig.slice(0, idx).split('\n').length;
  writeFileSync(path, orig.replace(m.from, m.to));
  // Assert the mutation applied at the intended site: read the mutated diff back.
  const diff = spawnSync('git', ['-C', WT, 'diff', '--unified=0', '--', `apps/chat/${m.file}`], { encoding: 'utf8' }).stdout;
  const hunks = [...diff.matchAll(/@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/g)].map((h) => [Number(h[1]), Number(h[2] ?? 1)]);
  const plusLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const hunkCovers = hunks.some(([s, n]) => lineAt >= s && lineAt <= s + Math.max(n, 1));
  const textPresent = m.to.split('\n').filter(Boolean).every((t) => plusLines.some((l) => l.includes(t.trim())));
  const atSite = hunks.length === 1 && hunkCovers && textPresent && Math.abs(lineAt - m.line) <= 2;
  log(`\n=== ${m.id} ${m.file}:${lineAt} (expected ~${m.line}) ${atSite ? 'APPLIED at site' : 'NOT AT SITE'} hunks=${JSON.stringify(hunks)}\n${diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).join('\n')}`);
  const r = spawnSync('node', ['--test', ...m.tests], { cwd: APP, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = r.stdout + r.stderr;
  // Red set: the names in the trailing "✖ failing tests:" block (spec reporter).
  const block = out.split('✖ failing tests:')[1] || '';
  const failing = [...block.matchAll(/^✖ (.+?) \(\d+(?:\.\d+)?ms\)$/gm)].map((x) => x[1]);
  const counts = { tests: /ℹ tests (\d+)/.exec(out)?.[1], fail: /ℹ fail (\d+)/.exec(out)?.[1] };
  writeFileSync(`${OUT}/mutant-${m.id}.log`, out);
  const exp = new Set(m.expect), got = new Set(failing);
  const missing = [...exp].filter((n) => !got.has(n)), extra = [...got].filter((n) => !exp.has(n));
  const verdict = !atSite ? 'NOT-AT-SITE' : failing.length === 0 ? 'SURVIVOR' : (missing.length === 0 && extra.length === 0) ? 'EXACT' : 'DIFFERENT';
  log(`${m.id}: exit=${r.status} tests=${counts.tests} fail=${counts.fail} RED SET (${failing.length}) ${verdict}:\n  ${failing.join('\n  ') || '(none)'}` +
      (missing.length ? `\n  MISSING vs recorded: ${missing.join(' | ')}` : '') + (extra.length ? `\n  EXTRA vs recorded: ${extra.join(' | ')}` : ''));
  summary.push({ id: m.id, atSite, fail: counts.fail, red: failing.length, verdict });
  writeFileSync(path, orig);
  backups.delete(path);
}
const clean = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--stat'], { encoding: 'utf8' });
log(`\ngit diff --exit-code after restore: ${clean.status === 0 ? 'CLEAN' : 'DIRTY\n' + clean.stdout}`);
log('\nSUMMARY (cardinality first)');
for (const s of summary) log(`${s.id.padEnd(4)} site=${s.atSite} fail=${s.fail} red=${s.red} ${s.verdict}`);
