// AS-131 review mutant battery (qa-priya). For each named falsifier: back up the
// file, apply the mutation in place in the worktree, ASSERT it applied at the
// intended site (exactly one occurrence, and the mutated diff names that line),
// run the named test files, record the exact red set, restore (also on any
// exit/signal), then `git diff --exit-code` at the end.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-131';
const APP = `${WT}/apps/chat`;
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-131/mutant-battery.log';
writeFileSync(LOG, `AS-131 mutant battery ${new Date().toISOString()}\n`);
const log = (s) => { console.log(s); appendFileSync(LOG, s + '\n'); };

const backups = new Map();
const restoreAll = () => { for (const [f, c] of backups) writeFileSync(f, c); backups.clear(); };
process.on('exit', restoreAll);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { restoreAll(); process.exit(128); });

const MUTANTS = [
  { id: 'M1', file: 'lib/store.js', from: 'ORDER BY m.id DESC', to: 'ORDER BY m.id ASC', line: 684, tests: ['test/store.test.js', 'test/api.test.js'] },
  { id: 'M2', file: 'lib/store.js', from: '(? = 0 OR m.id < ?)', to: '(? = 0 OR m.id <= ?)', line: 683, tests: ['test/store.test.js', 'test/api.test.js'] },
  { id: 'M3', file: 'lib/store.js', from: '.all(conv.id, cursor, cursor, size + 1)', to: '.all(conv.id, cursor, cursor, size)', line: 687, tests: ['test/store.test.js', 'test/api.test.js'] },
  { id: 'M4', file: 'lib/store.js', from: 'WHERE thread_root_id IN (${marks})', to: 'WHERE thread_root_id IN (${marks}) OR thread_root_id IS NOT NULL', line: 699, tests: ['test/store.test.js', 'test/api.test.js'] },
  { id: 'M5', file: 'server.js', from: "if (q('before') != null) {", to: "if (q('before') != null || q('limit') != null) {", line: 1036, tests: ['test/api.test.js'] },
  { id: 'M6', file: 'lib/store.js',
    from: "    requireVisible(conv, me, conversation);\n    const cursor = Number(before);\n    if (!Number.isInteger(cursor) || cursor < 0) {\n      throw new StoreError(`Invalid before '${before}'.`);\n    }\n",
    to: "    const cursor = Number(before);\n    if (!Number.isInteger(cursor) || cursor < 0) {\n      throw new StoreError(`Invalid before '${before}'.`);\n    }\n    requireVisible(conv, me, conversation);\n",
    line: 668, tests: ['test/store.test.js', 'test/api.test.js'] },
  { id: 'M7', file: 'public/app.js', from: "await post('/api/read', { me: state.me, conversation: conv.id }).catch(() => {});", to: "await post('/api/read', { me: state.me, conversation: conv.id, upTo: state.lastReadSent }).catch(() => {});", line: 755, tests: ['test/api.test.js'] },
  { id: 'M8', file: 'public/live.js', from: 'data.messages.unshift(...fresh);', to: 'data.messages.push(...fresh);', line: 93, tests: ['test/live.test.js'] },
  { id: 'M8b', file: 'public/live.js', from: '.filter((m) => !have.has(m.id));', to: '.filter(() => true);', line: 90, tests: ['test/live.test.js'] },
  { id: 'M9', file: 'public/scroll.js', from: 'pane.scrollTop = savedTop + (pane.scrollHeight - heightBefore);', to: 'pane.scrollTop = savedTop;', line: 64, tests: ['test/scroll.test.js'] },
  { id: 'M10', file: 'public/live.js', from: 'if (!data.hasMore || pages >= maxPages) return false;', to: 'if (pages >= maxPages) return false;', line: 126, tests: ['test/live.test.js'] },
];

const summary = [];
for (const m of MUTANTS) {
  const path = `${APP}/${m.file}`;
  const orig = readFileSync(path, 'utf8');
  backups.set(path, orig);
  const count = orig.split(m.from).length - 1;
  if (count !== 1) { log(`${m.id}: ABORT target occurs ${count} times in ${m.file}`); backups.delete(path); continue; }
  writeFileSync(path, orig.replace(m.from, m.to));
  // Assert the mutation applied at the intended site: read the mutated diff back.
  const diff = spawnSync('git', ['-C', WT, 'diff', '--unified=0', '--', `apps/chat/${m.file}`], { encoding: 'utf8' }).stdout;
  const hunk = diff.match(/@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
  const hunkStart = hunk ? Number(hunk[1]) : -1;
  const atSite = hunkStart >= m.line - 1 && hunkStart <= m.line + 1 && diff.includes('+' + m.to.split('\n')[0].trim().slice(0, 30));
  log(`\n=== ${m.id} ${m.file}:${m.line} ${atSite ? 'APPLIED at site' : 'NOT AT SITE (hunk @' + hunkStart + ')'}\n${diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).join('\n')}`);
  const r = spawnSync('node', ['--test', ...m.tests], { cwd: APP, encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = r.stdout + r.stderr;
  const failing = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
  const counts = { tests: /^# tests (\d+)/m.exec(out)?.[1] ?? /ℹ tests (\d+)/.exec(out)?.[1], fail: /^# fail (\d+)/m.exec(out)?.[1] ?? /ℹ fail (\d+)/.exec(out)?.[1] };
  writeFileSync(`/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-131/mutant-${m.id}.log`, out);
  log(`${m.id}: exit=${r.status} tests=${counts.tests} fail=${counts.fail} RED SET (${failing.length}):\n  ${failing.join('\n  ') || '(none — SURVIVOR)'}`);
  summary.push({ id: m.id, atSite, fail: counts.fail, red: failing });
  writeFileSync(path, orig);
  backups.delete(path);
}
const clean = spawnSync('git', ['-C', WT, 'diff', '--exit-code', '--stat'], { encoding: 'utf8' });
log(`\ngit diff --exit-code after restore: ${clean.status === 0 ? 'CLEAN' : 'DIRTY\n' + clean.stdout}`);
log('\nSUMMARY');
for (const s of summary) log(`${s.id.padEnd(4)} site=${s.atSite} fail=${s.fail} red=${s.red.length}: ${s.red.map((n) => n.slice(0, 70)).join(' | ')}`);
