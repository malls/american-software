// AS-87 cycle-2 review: apply named mutations to scratch copies and ASSERT each applied at the intended site.
import { readFileSync, writeFileSync } from 'node:fs';
const dir = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/as87c2-scratch';
const WATCHER = '/Users/forrest/Code/american-software-company/.worktrees/AS-87/apps/chat/watch/advance-watcher.mjs';

function mutate(file, edits) {
  let src = readFileSync(`${dir}/${file}`, 'utf8');
  // every scratch copy imports the worktree's watcher by absolute path
  const imp = "'../watch/advance-watcher.mjs'";
  if (!src.includes(imp)) throw new Error(`${file}: import site not found`);
  src = src.replace(imp, `'${WATCHER}'`);
  for (const [from, to, label] of edits) {
    const n = src.split(from).length - 1;
    if (n !== 1) throw new Error(`${file} ${label}: expected exactly 1 site for ${JSON.stringify(from)}, found ${n}`);
    src = src.replace(from, to);
    if (!src.includes(to)) throw new Error(`${file} ${label}: replacement did not land`);
  }
  writeFileSync(`${dir}/${file}`, src);
  console.log(`${file}: ${edits.length} mutation(s) applied at the intended site(s)`);
}

// M9 (plan, cycle-1 finding F1): restore the `app` subdirectory -> compose derives project `app`, teardown names something else.
mutate('m9.test.js', [[
  "  const app = join(dir, project);\n",
  "  const app = join(dir, 'app');\n",
  'M9',
]]);

// N2-a: first evaluate() refuses with no-git (git ls-tree fails) -> must fail fast, not hang.
mutate('n2-nogit.test.js', [[
  "    run: (bin, args) => (args[0] === 'ls-tree'\n      ? { code: 0,",
  "    run: (bin, args) => (args[0] === 'ls-tree'\n      ? { code: 128,",
  'N2-nogit',
]]);

// N2-b: first evaluate() throws inside evaluateInner (fetchJson rejects) -> AS-84 belt returns {noop, error}; must fail fast.
mutate('n2-error.test.js', [[
  "    fetchJson: async () => ({ build: { id: served } }),\n",
  "    fetchJson: async () => { throw new Error('probe exploded'); },\n",
  'N2-error',
]]);

// M10 (reviewer's, past the list): teardown forgets --rmi local -> the image assertion of AC-11 must go red on its own.
mutate('m10-normi.test.js', [[
  "['compose', '-p', project, 'down', '--rmi', 'local', '-v', '--remove-orphans']",
  "['compose', '-p', project, 'down', '-v', '--remove-orphans']",
  'M10',
]]);
