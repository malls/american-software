// run-mutants.mjs — F1..F4 in sequence: apply, counted compose run (--build),
// restore, prove the restore. Prints one summary line per mutant with the
// failing test names extracted from the log; writes mutants-summary.txt.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company';
const WT = `${ROOT}/.worktrees/AS-58`;
const PAD = `${ROOT}/scratchpad/agent-developer-marcus/AS-58`;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['F1', 'F2', 'F3', 'F4'];

const run = (argv, opts = {}) => spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
const restore = () => {
  run(['git', '-C', WT, 'checkout', '--', 'apps/invoicing']);
  const clean = run(['git', '-C', WT, 'diff', '--exit-code']);
  return clean.status === 0;
};
process.on('SIGINT', () => { restore(); process.exit(130); });
process.on('SIGTERM', () => { restore(); process.exit(143); });

const summary = [];
for (const id of ids) {
  const applied = run(['node', `${PAD}/mutate.mjs`, id]);
  if (applied.status !== 0) { summary.push(`${id}: APPLY FAILED ${applied.stderr}`); restore(); continue; }
  const diff = run(['git', '-C', WT, 'diff', '--stat']).stdout.trim();
  const log = `${PAD}/${id.toLowerCase()}.log`;
  const r = run(['node', `${ROOT}/apps/chat/bin/compose-run.mjs`, '--project', `asc-impl-as58-${id.toLowerCase()}`, '--cwd', `${WT}/apps/invoicing`, '--log', log]);
  const restored = restore();
  const out = `${r.stdout}\n${r.stderr}`;
  const receipt = (out.match(/^\s*(built: .*|tests=.*|leak check: .*)$/gm) ?? []).map((s) => s.trim()).join(' | ');
  let failing = [];
  try {
    const text = readFileSync(log, 'utf8');
    const tail = text.split('✖ failing tests:')[1] ?? '';
    failing = [...tail.matchAll(/^✖ (.*?) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]);
  } catch {}
  summary.push(`${id}: applied [${diff.split('\n')[0].trim()}] | ${receipt} | restored=${restored} | red set (${failing.length}): ${failing.map((f) => JSON.stringify(f)).join(', ')}`);
  console.log(summary[summary.length - 1]);
}
writeFileSync(`${PAD}/mutants-summary.txt`, summary.join('\n') + '\n');
console.log('DONE');
