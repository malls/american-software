// AS-131 mutant battery — runs every plan falsifier (M1–M10) against a
// DETACHED scratch worktree at the branch tip, never the real worktree.
//   node scratchpad/agent-developer-lena/AS-131/mutants.mjs [<M-name> ...]
// Per mutant: reset --hard, apply a single exact-string replacement, ASSERT it
// landed exactly once at the intended file (diff --name-only == that file and
// the mutated text is present), run the full host suite (bare `node --test`,
// cwd apps/chat), record the red set, reset. Output: mutants.log beside this file.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = '/Users/forrest/Code/american-software-company';
const SCRATCH = '/tmp/AS-131-mutant';
const BRANCH = 'feat/AS-131-lazy-load-messages';
const LOG = join(REPO, 'scratchpad/agent-developer-lena/AS-131', process.env.MUTANTS_LOG || 'mutants.log');

const MUTANTS = [
  { name: 'M1', file: 'apps/chat/lib/store.js',
    from: 'ORDER BY m.id DESC', to: 'ORDER BY m.id ASC',
    expect: 'AC1: page order flips -> roots 1,2 instead of 4,5' },
  { name: 'M2', file: 'apps/chat/lib/store.js',
    from: '(? = 0 OR m.id < ?)', to: '(? = 0 OR m.id <= ?)',
    expect: 'AC2: cursor inclusive -> root 4 repeats on page 2' },
  { name: 'M3', file: 'apps/chat/lib/store.js',
    from: '.all(conv.id, cursor, cursor, size + 1)', to: '.all(conv.id, cursor, cursor, size)',
    expect: 'AC3: hasMore always false' },
  { name: 'M4', file: 'apps/chat/lib/store.js',
    from: 'WHERE thread_root_id IN (${marks})', to: 'WHERE thread_root_id IS NOT NULL OR thread_root_id IN (${marks})',
    expect: 'AC4: foreign root keys present in page threads' },
  { name: 'M5', file: 'apps/chat/server.js',
    from: "if (q('before') != null) {", to: "if (q('before') != null || q('limit') != null) {",
    expect: 'AC5: ?limit= routed into page mode -> AS-24 limit test red on threads / keys' },
  { name: 'M6', file: 'apps/chat/lib/store.js',
    from: `    requireVisible(conv, me, conversation);
    const cursor = Number(before);
    if (!Number.isInteger(cursor) || cursor < 0) {
      throw new StoreError(\`Invalid before '\${before}'.\`);
    }`,
    to: `    const cursor = Number(before);
    if (!Number.isInteger(cursor) || cursor < 0) {
      throw new StoreError(\`Invalid before '\${before}'.\`);
    }
    requireVisible(conv, me, conversation);`,
    expect: 'AC6: before validated above the gate -> hidden+before=abc is 400, parity red' },
  { name: 'M7', file: 'apps/chat/public/app.js',
    from: "await post('/api/read', { me: state.me, conversation: conv.id }).catch(() => {});",
    to: "await post('/api/read', { me: state.me, conversation: conv.id, upTo: maxLoadedId(data) }).catch(() => {});",
    expect: 'AC7: open-time mark pinned to the page max -> source pin red' },
  { name: 'M8', file: 'apps/chat/public/live.js',
    from: 'data.messages.unshift(...fresh);', to: 'data.messages.push(...fresh);',
    expect: 'AC8: older rows appended -> order red' },
  { name: 'M8b', file: 'apps/chat/public/live.js',
    from: '.filter((m) => !have.has(m.id));', to: '.filter(() => true);',
    expect: 'AC8: no dedupe -> length red' },
  { name: 'M9', file: 'apps/chat/public/scroll.js',
    from: 'pane.scrollTop = savedTop + (pane.scrollHeight - heightBefore);', to: 'pane.scrollTop = savedTop;',
    expect: 'AC9: restore without delta -> 300 stays 300, red' },
  { name: 'M10', file: 'apps/chat/public/live.js',
    from: 'if (!data.hasMore || pages >= maxPages) return false;', to: 'if (pages >= maxPages) return false;',
    expect: 'AC10: hasMore stop dropped -> runaway fetch count red' },
  { name: 'M11', file: 'apps/chat/public/live.js',
    from: 'if (hit) return data.messages.some((m) => m.id === hit.threadRootId) ? hit : null;', to: 'if (hit) return hit;',
    expect: 'AC12 (F1): reply-only check restored -> orphan reply counts as loaded, red' },
];

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function git(...args) { return sh('git', ['-C', SCRATCH, ...args]); }
function log(line) { appendFileSync(LOG, line + '\n'); console.log(line); }

function runSuite(label) {
  const r = sh('node', ['--test'], { cwd: join(SCRATCH, 'apps/chat') });
  const pick = (k) => (r.out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1];
  const red = [...r.out.matchAll(/^✖ (.*?) \(\d/gm)].map((m) => m[1]);
  // The reporter lists each failing test twice (inline + summary); dedupe.
  const set = [...new Set(red)];
  writeFileSync(join(REPO, `scratchpad/agent-developer-lena/AS-131/mutant-${label}.log`), r.out);
  return { tests: pick('tests'), pass: pick('pass'), fail: pick('fail'), skipped: pick('skipped'), exit: r.code, red: set };
}

// --- setup: detached scratch worktree at the branch tip ----------------------
const tip = sh('git', ['-C', REPO, 'rev-parse', BRANCH]).out.trim();
if (!existsSync(SCRATCH)) {
  const add = sh('git', ['-C', REPO, 'worktree', 'add', '--detach', SCRATCH, tip]);
  if (add.code !== 0) { console.error(add.out); process.exit(2); }
}
git('checkout', '--detach', tip);
git('reset', '--hard', tip);
writeFileSync(LOG, `# AS-131 mutant battery — scratch ${SCRATCH} detached at ${tip} — ${new Date().toISOString()}\n`);

const only = process.argv.slice(2);
const summary = [];
// Control: unmutated scratch must be green.
if (!only.length) {
  const c = runSuite('control');
  log(`control @${tip.slice(0, 7)}: ${c.tests}/${c.pass}/${c.fail}/${c.skipped} exit=${c.exit} red={${c.red.join('; ')}}`);
  summary.push({ name: 'control', ...c });
}
for (const m of MUTANTS) {
  if (only.length && !only.includes(m.name)) continue;
  git('reset', '--hard', tip);
  const path = join(SCRATCH, m.file);
  const src = readFileSync(path, 'utf8');
  const count = src.split(m.from).length - 1;
  if (count !== 1) { log(`${m.name}: ABORT — anchor found ${count} times in ${m.file}`); continue; }
  writeFileSync(path, src.replace(m.from, m.to));
  // Assert applied at the intended site.
  const changed = git('diff', '--name-only').out.trim().split('\n').filter(Boolean);
  const landed = readFileSync(path, 'utf8').includes(m.to) && !readFileSync(path, 'utf8').includes(m.from);
  const site = changed.length === 1 && changed[0] === m.file && landed;
  const diffStat = git('diff', '--stat').out.trim().split('\n').pop();
  if (!site) { log(`${m.name}: ABORT — mutation did not land at site (changed=${changed.join(',')} landed=${landed})`); git('reset', '--hard', tip); continue; }
  const r = runSuite(m.name);
  log(`${m.name} [${m.file}] applied-at-site=yes (${diffStat}); ${m.expect}`);
  log(`  result ${r.tests}/${r.pass}/${r.fail}/${r.skipped} exit=${r.exit} RED SET (${r.red.length}): ${r.red.map((x) => `"${x}"`).join(', ') || 'NONE — SURVIVOR'}`);
  summary.push({ name: m.name, ...r });
  git('reset', '--hard', tip);
}
const clean = git('diff', '--exit-code').code === 0 && git('status', '--porcelain').out.trim() === '';
log(`scratch clean after battery: ${clean}`);
log('SUMMARY ' + summary.map((s) => `${s.name}=${s.fail}red`).join(' '));
