// run-mutants.mjs — M1..M6 in sequence: apply, counted compose run, restore,
// prove the restore. Prints one summary line per mutant with the failing
// test names extracted from the log.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company';
const WT = `${ROOT}/.worktrees/AS-128`;
const PAD = `${ROOT}/scratchpad/agent-developer-marcus/AS-128`;
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'];

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
  const log = `${PAD}/${id.toLowerCase()}.log`;
  const r = run(['node', `${ROOT}/apps/chat/bin/compose-run.mjs`, '--project', `asc-impl-as128-${id.toLowerCase()}`, '--cwd', `${WT}/apps/invoicing`, '--log', log]);
  const restored = restore();
  const out = `${r.stdout}\n${r.stderr}`;
  const receipt = (out.match(/^\s*(built: .*|tests=.*|leak check: .*)$/gm) ?? []).map((s) => s.trim()).join(' | ');
  let failing = [];
  try {
    const text = readFileSync(log, 'utf8');
    // The spec reporter: the "failing tests:" tail lists each once.
    const tail = text.split('✖ failing tests:')[1] ?? '';
    failing = [...tail.matchAll(/^✖ (.*?) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]);
  } catch {}
  summary.push(`${id}: ${receipt} | restored=${restored} | red set (${failing.length}): ${failing.map((f) => JSON.stringify(f)).join(', ')}`);
  console.log(summary[summary.length - 1]);
}
writeFileSync(`${PAD}/mutants-summary.txt`, summary.join('\n') + '\n');
console.log('DONE');
