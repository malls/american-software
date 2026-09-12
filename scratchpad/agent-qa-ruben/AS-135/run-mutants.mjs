// AS-135 review mutant battery (qa-ruben). Runs in the SCRATCH copy only —
// never the worktree. For each mutant: assert exactly one match at the intended
// site, apply, print the mutated diff, run the FULL suite (tap reporter),
// collect the `not ok` set, restore with git checkout, assert the tree is
// clean. Exact red sets vs the plan's predictions go to mutant-table.md.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const SCR = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-135/scratch';
const APP = join(SCR, 'apps/chat');
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-135';
const LOG = join(OUT, 'mutant-battery.log');
const only = process.argv.slice(2);

const MUTANTS = [
  {
    id: 'M1', file: 'public/message-pane.js', predicted: ['T1', 'T7', 'T9'],
    desc: 'main-pane insert replaced by a faithful full rebuild from data (recreated nodes)',
    from: "    renderPreservingScroll(mainPane, () => insertMessageNode(mainPane, nodeFor(msg, { inThread: false })));",
    to: "    renderPreservingScroll(mainPane, () => { const head = [...mainPane.children].filter((c) => messageIdOf(c) == null && !(c.classList && c.classList.contains('empty-note'))); mainPane.replaceChildren(...head, ...data.messages.map((m) => nodeFor(m, { inThread: false }))); });",
  },
  {
    id: 'M2', file: 'public/message-pane.js', predicted: ['T2', 'T7'],
    desc: 'append unconditionally (no backward walk)',
    from: "  for (let i = kids.length - 1; i >= 0; i--) {\n    const cid = messageIdOf(kids[i]);\n    if (cid == null) break; // walked past every message row: land right after the non-message head\n    if (cid < id) break;\n    before = kids[i];\n  }\n",
    to: "",
  },
  {
    id: 'M3', file: 'public/message-pane.js', predicted: ['T3', 'T7'],
    desc: 'drop the messageIdOf dedupe lookup',
    from: "  if (id == null || findMessage(pane, id)) return false;",
    to: "  if (id == null) return false;",
  },
  {
    id: 'M4', file: 'public/message-pane.js', predicted: ['T4'],
    desc: 'skip the .empty-note removal',
    from: "  if (note) pane.removeChild(note);",
    to: "  if (note) { /* mutant: kept */ }",
  },
  {
    id: 'M5', file: 'public/message-pane.js', predicted: ['T5', 'T7'],
    desc: 'patch the first .message child instead of #msg-<root>',
    from: "  const root = findMessage(pane, rootId);\n  if (!root) return false;",
    to: "  const root = findByClass(pane.children, 'message');\n  if (!root) return false;",
  },
  {
    id: 'M5b', file: 'public/message-pane.js', predicted: ['T5'],
    desc: 'invert the plural rule in replyLabel',
    from: "  return `${count} ${count === 1 ? 'reply' : 'replies'}`;",
    to: "  return `${count} ${count === 1 ? 'replies' : 'reply'}`;",
  },
  {
    id: 'M6', file: 'public/message-pane.js', predicted: ['T6'],
    desc: 'drop the currentThreadRoot === threadRootId check (always insertThread)',
    from: "    insertThread: currentThreadRoot === msg.threadRootId,",
    to: "    insertThread: true,",
  },
  {
    id: 'M6b', file: 'public/message-pane.js', predicted: ['T6'],
    desc: 'patch even when the root is unloaded (orphan)',
    from: "  if (!root) return { insertMain: false, patchRoot: null, insertThread: false }; // orphan reply: root not loaded",
    to: "  if (!root) return { insertMain: false, patchRoot: { id: msg.threadRootId, count: (data.threads[msg.threadRootId] || []).length }, insertThread: false };",
  },
  {
    id: 'M7', file: 'public/message-pane.js', predicted: ['T8'],
    desc: 'insert outside renderPreservingScroll (both panes)',
    from: "    renderPreservingScroll(mainPane, () => insertMessageNode(mainPane, nodeFor(msg, { inThread: false })));\n  }\n  if (t.patchRoot) setReplyCount(mainPane, t.patchRoot.id, t.patchRoot.count, linkFor);\n  if (t.insertThread) {\n    renderPreservingScroll(threadPane, () => insertMessageNode(threadPane, nodeFor(msg, { inThread: true })));",
    to: "    insertMessageNode(mainPane, nodeFor(msg, { inThread: false }));\n  }\n  if (t.patchRoot) setReplyCount(mainPane, t.patchRoot.id, t.patchRoot.count, linkFor);\n  if (t.insertThread) {\n    insertMessageNode(threadPane, nodeFor(msg, { inThread: true }));",
  },
  {
    id: 'M8', file: 'public/app.js', predicted: ['T10'],
    desc: 'restore renderConversation({ scroll: "preserve" }) in handleFrame',
    from: "    if (applyMessage(state.lastData, msg)) {\n      renderFrame(msg);\n      noteRead(msg.id);\n    }\n    return;",
    to: "    if (applyMessage(state.lastData, msg)) {\n      renderConversation({ scroll: 'preserve' });\n      noteRead(msg.id);\n    }\n    return;",
  },
  {
    id: 'M9', file: 'public/live.js', predicted: ['AS-135 live (R5)'],
    desc: 'R5: restore plain assignment in mergeOlderPage (drop the union)',
    from: "      if (!orphans.length) {\n        data.threads[root.id] = pageList;\n        continue;\n      }",
    to: "      data.threads[root.id] = pageList;\n      continue;",
  },
  {
    id: 'AS131-M9', file: 'public/scroll.js', predicted: ['scroll: prependPreservingScroll', 'scroll: prependPreservingScroll'],
    desc: 'criterion 11: drop the height delta in prependPreservingScroll',
    from: "  pane.scrollTop = savedTop + (pane.scrollHeight - heightBefore);",
    to: "  pane.scrollTop = savedTop;",
  },
  {
    id: 'X1', file: 'server.js', predicted: ['api: AS-74'],
    desc: 'extra: drop the /message-pane.js STATIC_FILES entry (module on disk, not served)',
    from: "  '/message-pane.js': ['message-pane.js', 'text/javascript; charset=utf-8'],\n",
    to: "",
  },
  {
    id: 'X2', file: 'public/app.js', predicted: ['T10'],
    desc: 'extra: catchUp loop merges without renderFrame (pane never updated on reconnect)',
    from: "    if (applyMessage(state.lastData, m)) {\n      renderFrame(m);\n      changed = true;\n    }",
    to: "    if (applyMessage(state.lastData, m)) {\n      changed = true;\n    }",
  },
  {
    id: 'X3', file: 'public/message-pane.js', predicted: ['T2'],
    desc: 'extra: backward walk ignores the non-message head (lands BEFORE the load-earlier button)',
    from: "    if (cid == null) break; // walked past every message row: land right after the non-message head\n",
    to: "    if (cid == null) { before = kids[i]; break; }\n",
  },
  {
    id: 'X4', file: 'public/app.js', predicted: ['T10'],
    desc: 'extra: renderFrame drops applyAnchor() (permalink target arriving by frame never lands)',
    from: "    linkFor: threadLinkNode,\n  });\n  applyAnchor();\n}",
    to: "    linkFor: threadLinkNode,\n  });\n}",
  },
];

function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}
function count(hay, needle) {
  return hay.split(needle).length - 1;
}
function assertClean(label) {
  const r = sh('git', ['-C', SCR, 'diff', '--exit-code', '--stat']);
  if (r.status !== 0) throw new Error(`${label}: scratch tree NOT clean:\n${r.stdout}`);
}
function runSuite() {
  const r = sh('node', ['--test', '--test-reporter=tap'], { cwd: APP });
  const out = (r.stdout || '') + (r.stderr || '');
  const red = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^not ok \d+ - (.*)$/);
    if (m) red.push(m[1].trim());
  }
  const totals = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) {
    const m = out.match(new RegExp(`^# ${k} (\\d+)`, 'm'));
    totals[k] = m ? Number(m[1]) : null;
  }
  return { red, totals, exit: r.status, out };
}

writeFileSync(LOG, `# AS-135 mutant battery — ${new Date().toISOString()}\nscratch: ${SCR}\n\n`);
assertClean('pre-battery');
const results = [];
for (const m of MUTANTS) {
  if (only.length && !only.includes(m.id)) continue;
  const path = join(APP, m.file);
  const src = readFileSync(path, 'utf8');
  const n = count(src, m.from);
  if (n !== 1) throw new Error(`${m.id}: expected exactly 1 match at site in ${m.file}, found ${n}`);
  writeFileSync(path, src.replace(m.from, m.to));
  const diff = sh('git', ['-C', SCR, 'diff', '--', `apps/chat/${m.file}`]).stdout;
  if (!diff.trim()) throw new Error(`${m.id}: mutation produced no diff`);
  appendFileSync(LOG, `\n## ${m.id} — ${m.desc}\n### mutated diff (asserted: 1 match at site)\n${diff}\n`);
  let res;
  try {
    res = runSuite();
  } finally {
    sh('git', ['-C', SCR, 'checkout', '--', `apps/chat/${m.file}`]);
    assertClean(`${m.id} restore`);
  }
  const t = res.totals;
  appendFileSync(LOG, `### result: exit=${res.exit} tests=${t.tests} pass=${t.pass} fail=${t.fail} skipped=${t.skipped}\n### red set (${res.red.length}):\n${res.red.map((r) => `  - ${r}`).join('\n') || '  (none — SURVIVOR)'}\n`);
  writeFileSync(join(OUT, `mutant-${m.id}.tap.log`), res.out);
  results.push({ id: m.id, desc: m.desc, predicted: m.predicted, red: res.red, totals: t, exit: res.exit });
  console.log(`${m.id}: exit=${res.exit} fail=${t.fail} red=${JSON.stringify(res.red.map((r) => r.slice(0, 60)))}`);
}
writeFileSync(join(OUT, 'mutant-results.json'), JSON.stringify(results, null, 2));
assertClean('post-battery');
console.log('battery done; tree clean');
