// qa-priya AS-106 review: host mutants M2-M10 against the scratch copy.
// Each mutant: anchored pattern (must match exactly once, at the intended site),
// apply, assert applied, run the full suite, record failing set, restore from the
// worktree original, assert byte-identical restore.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-106/apps/chat';
const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-106/scratch/apps/chat';
const BASELINE_RED = new Set(['deploy-shape: every tracked path under apps/chat is an image input or declared not one']);

const MUTANTS = [
  { id: 'M2', file: 'compose.yaml', desc: 'delete network_mode: none from the test service',
    find: /    profiles: \["tools"\]\n    network_mode: none\n    command: \["node", "--test"\]/, repl: '    profiles: ["tools"]\n    command: ["node", "--test"]',
    predicted: ['deploy-shape: the test service has no network (AS-106 network_mode: none)'] },
  { id: 'M3', file: 'lib/compose-run.js', desc: 'isAllowedProject returns ok unconditionally',
    find: /export function isAllowedProject\(name, \{ productionNames = \[\], runningProjects = \[\] \} = \{\}\) \{\n/, repl: (m) => m + '  return { ok: true };\n',
    predicted: ['T1', 'T2'] },
  { id: 'M4', file: 'lib/compose-run.js', desc: 'buildDownArgs drops --rmi local',
    find: /export function buildDownArgs\(project\) \{\n  return \['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'\];/,
    repl: "export function buildDownArgs(project) {\n  return ['compose', '-p', project, 'down', '-v', '--remove-orphans'];",
    predicted: ['T4'] },
  { id: 'M5', file: 'lib/compose-run.js', desc: 'down guarded by runStatus === 0 (inside runCounted)',
    find: /  let downStatus;\n  try \{\n    downStatus = exec\(\[docker, \.\.\.buildDownArgs\(project\)\], \{ cwd, env: runEnv \}\)\.status;/,
    repl: "  let downStatus;\n  try {\n    if (runStatus === 0) downStatus = exec([docker, ...buildDownArgs(project)], { cwd, env: runEnv }).status;",
    predicted: ['T5b', 'T5c'] },
  { id: 'M6', file: 'lib/compose-run.js', desc: 'post-teardown leak check skipped (leaks always empty, inside runCounted)',
    find: /  const leaks = \[\.\.\.leftNets, \.\.\.leftImgs\];\n  const receipt = parseReceipt\(output\);/,
    repl: '  const leaks = [];\n  const receipt = parseReceipt(output);',
    predicted: ['T6'] },
  { id: 'M7', file: 'lib/compose-run.js', desc: 'parseReceipt defaults built to true',
    find: /  return \{\n    built: builtLine !== null,\n    builtLine: builtLine \? builtLine\.trim\(\) : null,/,
    repl: '  return {\n    built: true,\n    builtLine: builtLine ? builtLine.trim() : null,',
    predicted: ['T7b'] },
  { id: 'M8', file: 'lib/compose-run.js', desc: 'classifyNetworks puts every asc-* in leftover',
    find: /    if \(productionNames\.includes\(project\)\) out\.production\.push\(network\);\n    else if \(runningProjects\.includes\(project\)\) out\.live\.push\(network\);\n    else out\.leftover\.push\(/,
    repl: '    out.leftover.push(',
    predicted: ['T8'] },
  { id: 'M9', file: 'lib/compose-run.js', desc: 'preflight ceiling comparison < becomes <=',
    find: /  return \{ ok: count < ceiling, count, ceiling, classified \};/,
    repl: '  return { ok: count <= ceiling, count, ceiling, classified };',
    predicted: ['T9a'] },
  { id: 'M10', file: 'lib/compose-run.js', desc: 'runCheck downs each leftover',
    find: /  const classified = classifyNetworks\(networks, running, productionNames\);\n  return \{ exit: classified\.leftover\.length \? 1 : 0,/,
    repl: "  const classified = classifyNetworks(networks, running, productionNames);\n  for (const l of classified.leftover) exec([docker, ...buildDownArgs(l.project)]);\n  return { exit: classified.leftover.length ? 1 : 0,",
    predicted: ['T10b'] },
];

const only = process.argv[2] ? process.argv[2].split(',') : null;
for (const m of MUTANTS) {
  if (only && !only.includes(m.id)) continue;
  const path = `${S}/${m.file}`;
  const original = readFileSync(`${W}/${m.file}`, 'utf8');
  if (readFileSync(path, 'utf8') !== original) throw new Error(`${m.id}: scratch ${m.file} not pristine before mutation`);
  const matches = original.match(new RegExp(m.find.source, 'g')) || [];
  if (matches.length !== 1) throw new Error(`${m.id}: pattern matched ${matches.length} times, want exactly 1`);
  const mutated = original.replace(m.find, m.repl);
  if (mutated === original) throw new Error(`${m.id}: mutation produced no change`);
  writeFileSync(path, mutated);
  if (readFileSync(path, 'utf8') !== mutated) throw new Error(`${m.id}: mutation did not apply on disk`);
  const applied = mutated.split('\n').filter((l, i) => original.split('\n')[i] !== l).slice(0, 3);
  let red = [];
  try {
    const r = spawnSync(process.execPath, ['--test'], { cwd: S, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0' } });
    const out = (r.stdout || '') + (r.stderr || '');
    writeFileSync(`/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya/AS-106/mutant-${m.id}.log`, out);
    const seen = new Set();
    for (const line of out.split('\n')) {
      const mm = /^✖ (.+?) \(\d/.exec(line);
      if (mm && !seen.has(mm[1])) { seen.add(mm[1]); red.push(mm[1]); }
    }
    const summary = /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(out);
    red = red.filter((n) => !BASELINE_RED.has(n));
    const short = red.map((n) => (/^(T\d+[ab]?)\b/.exec(n) || [null, n])[1]);
    const exact = JSON.stringify([...short].sort()) === JSON.stringify([...m.predicted].sort());
    console.log(`${m.id} ${m.desc}\n  first changed line: ${JSON.stringify(applied[0])}\n  suite: tests ${summary?.[1]} pass ${summary?.[2]} fail ${summary?.[3]} (baseline red excluded: ${BASELINE_RED.size})\n  red set: ${JSON.stringify(short)}\n  predicted: ${JSON.stringify(m.predicted)} -> ${exact ? 'EXACT' : 'DIFFERS'}${red.length === 0 ? '  *** SURVIVOR ***' : ''}`);
  } finally {
    writeFileSync(path, original);
    if (readFileSync(path, 'utf8') !== original) throw new Error(`${m.id}: restore failed`);
    console.log('  restored: byte-identical to worktree');
  }
}
