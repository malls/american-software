// AS-135 mutant battery. Usage: node mutants.mjs <scratch-worktree-root> [M1,M2,...]
// For each mutant: restore the scratch tree, assert the anchor text occurs
// exactly once in the target file, write the mutation, assert the mutated text
// is present and the anchor gone, run the FULL host suite in the scratch copy,
// record the exact red set, restore. Ends with `git diff --exit-code`.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = process.argv[2];
const only = process.argv[3] ? process.argv[3].split(',') : null;
if (!root) throw new Error('scratch root required');
const chat = join(root, 'apps', 'chat');
const LOG = join(HERE, 'mutants.log');

const MP = 'public/message-pane.js';
const MUTANTS = [
  { id: 'control', file: null },
  {
    id: 'M1', file: MP, why: 'replace the main-pane insert with a full replaceChildren rebuild',
    find: "renderPreservingScroll(mainPane, () => insertMessageNode(mainPane, nodeFor(msg, { inThread: false })));",
    repl: "renderPreservingScroll(mainPane, () => mainPane.replaceChildren(...data.messages.map((m) => nodeFor(m, { inThread: false }))));",
  },
  {
    id: 'M2', file: MP, why: 'append unconditionally (no id-order walk)',
    find: 'if (before) pane.insertBefore(node, before);\n  else pane.appendChild(node);',
    repl: 'pane.appendChild(node);',
  },
  {
    id: 'M3', file: MP, why: 'drop the messageIdOf duplicate lookup',
    find: 'if (id == null || findMessage(pane, id)) return false;',
    repl: 'if (id == null) return false;',
  },
  {
    id: 'M4', file: MP, why: 'skip the .empty-note removal',
    find: 'if (note) pane.removeChild(note);',
    repl: 'if (note && false) pane.removeChild(note);',
  },
  {
    id: 'M5', file: MP, why: 'patch the first .message child instead of #msg-<root>',
    find: 'const root = findMessage(pane, rootId);\n  if (!root) return false;',
    repl: "const root = findByClass(pane.children, 'message');\n  if (!root) return false;",
  },
  {
    id: 'M5b', file: MP, why: 'invert the plural rule in replyLabel',
    find: "return `${count} ${count === 1 ? 'reply' : 'replies'}`;",
    repl: "return `${count} ${count === 1 ? 'replies' : 'reply'}`;",
  },
  {
    id: 'M6', file: MP, why: 'drop the currentThreadRoot === threadRootId check',
    find: 'insertThread: currentThreadRoot === msg.threadRootId,',
    repl: 'insertThread: true,',
  },
  {
    id: 'M6b', file: MP, why: 'patch even when the root is unloaded (orphan)',
    find: 'if (!root) return { insertMain: false, patchRoot: null, insertThread: false }; // orphan reply: root not loaded',
    repl: 'if (!root) return { insertMain: false, patchRoot: { id: msg.threadRootId, count: 0 }, insertThread: currentThreadRoot === msg.threadRootId };',
  },
  {
    id: 'M7', file: MP, why: 'main-pane insert outside renderPreservingScroll',
    find: "renderPreservingScroll(mainPane, () => insertMessageNode(mainPane, nodeFor(msg, { inThread: false })));",
    repl: 'insertMessageNode(mainPane, nodeFor(msg, { inThread: false }));',
  },
  {
    id: 'M7b', file: MP, why: 'thread-pane insert outside renderPreservingScroll',
    find: "renderPreservingScroll(threadPane, () => insertMessageNode(threadPane, nodeFor(msg, { inThread: true })));",
    repl: 'insertMessageNode(threadPane, nodeFor(msg, { inThread: true }));',
  },
  {
    id: 'M8', file: 'public/app.js', why: "restore renderConversation({ scroll: 'preserve' }) in handleFrame",
    find: '      renderFrame(msg);\n      noteRead(msg.id);',
    repl: "      renderConversation({ scroll: 'preserve' });\n      noteRead(msg.id);",
  },
  {
    id: 'M9-prepend', file: 'public/scroll.js', why: 'AS-131 M9 re-run: drop the height delta in prependPreservingScroll',
    find: 'pane.scrollTop = savedTop + (pane.scrollHeight - heightBefore);',
    repl: 'pane.scrollTop = savedTop;',
  },
  {
    id: 'M9', file: 'public/live.js', why: 'R5: restore plain assignment (drop the orphan union)',
    find: 'const seen = new Set(pageList.map((m) => m.id));\n      const merged = pageList.concat(orphans.filter((m) => !seen.has(m.id))).sort((a, b) => a.id - b.id);\n      data.threads[root.id] = merged;\n      root.replyCount = merged.length;',
    repl: 'data.threads[root.id] = pageList;',
  },
];

const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const restore = () => {
  const r = git('checkout', '--', '.');
  if (r.status !== 0) throw new Error('restore failed: ' + r.stderr);
};
const count = (hay, needle) => hay.split(needle).length - 1;
const log = (s) => { console.log(s); appendFileSync(LOG, s + '\n'); };

function runSuite() {
  const r = spawnSync(process.execPath, ['--test'], { cwd: chat, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const pick = (k) => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1];
  const reds = [...out.matchAll(/^✖ (.*) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]);
  return { counts: `${pick('tests')}/${pick('pass')}/${pick('fail')}/${pick('skipped')}`, reds, out };
}

process.on('SIGINT', () => { restore(); process.exit(130); });
process.on('SIGTERM', () => { restore(); process.exit(143); });

log(`\n== AS-135 mutant battery ${new Date().toISOString()} scratch=${root} tip=${git('rev-parse', '--short', 'HEAD').stdout.trim()}`);
for (const m of MUTANTS) {
  if (only && !only.includes(m.id)) continue;
  restore();
  if (m.file) {
    const p = join(chat, m.file);
    const src = readFileSync(p, 'utf8');
    const n = count(src, m.find);
    if (n !== 1) { log(`${m.id}: ABORT anchor occurs ${n}x in ${m.file}`); continue; }
    writeFileSync(p, src.replace(m.find, m.repl));
    const after = readFileSync(p, 'utf8');
    if (count(after, m.repl) < 1 || count(after, m.find) !== 0) { log(`${m.id}: ABORT mutation not applied at site`); restore(); continue; }
    const stat = git('diff', '--numstat').stdout.trim().split('\n');
    log(`${m.id} (${m.file}: ${m.why}) — site asserted; numstat: ${stat.join(' | ')}`);
  }
  const { counts, reds, out } = runSuite();
  writeFileSync(join(HERE, `mutant-${m.id}.log`), out);
  log(`${m.id}: ${counts} reds=${reds.length}${reds.length ? '\n    - ' + reds.join('\n    - ') : ''}`);
  restore();
}
const clean = git('diff', '--exit-code');
log(`final git diff --exit-code: ${clean.status === 0 ? 'clean' : 'DIRTY'}`);
