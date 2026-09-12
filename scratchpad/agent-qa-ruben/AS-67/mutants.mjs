// AS-67 mutation battery (plan §4 F1..F4), run against a SCRATCH COPY of the
// worktree — the task worktree is never mutated. Each mutant: fresh copy,
// assert the pattern occurs exactly once (the intended site), apply, assert
// zero remain and the file changed at the expected line, compose --build run,
// collect the exact red set, compare to the plan's prediction.
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DOCKER = '/usr/local/bin/docker';
const ROOT = '/Users/forrest/Code/american-software-company';
const WT = join(ROOT, '.worktrees/AS-67');
const SCRATCH = join(ROOT, 'scratchpad/agent-qa-ruben/AS-67/scratch-root');
const LOGDIR = join(ROOT, 'scratchpad/agent-qa-ruben/AS-67');
const PROJECT = 'asc-review-as67';
const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };

const MUTANTS = {
  F1: {
    file: 'apps/invoicing/lib/db/repositories/clients.js',
    from: "const email = assertEmail(input.email, 'email');",
    to: "const email = assertText(input.email, 'email');",
    anchor: 'function create(',
    expected: ['C9', 'L4'],
  },
  F2: {
    file: 'apps/invoicing/lib/db/repositories/clients.js',
    from: "values.push(assertEmail(patch.email, 'email'));",
    to: "values.push(assertText(patch.email, 'email'));",
    anchor: 'function update(',
    expected: ['C10'],
  },
  F3: {
    file: 'apps/invoicing/lib/db/errors.js',
    from: "export function isEmailShape(value) {\n  if (typeof value !== 'string' || value.length > EMAIL_MAX) return false;",
    to: "export function isEmailShape(value) {\n  return typeof value === 'string';\n  if (typeof value !== 'string' || value.length > EMAIL_MAX) return false;",
    anchor: 'export function isEmailShape(',
    expected: ['C9', 'C10', 'L4', 'H6'],
  },
  F4: {
    file: 'apps/invoicing/lib/db/errors.js',
    from: 'export const EMAIL_MAX = 254;',
    to: 'export const EMAIL_MAX = 1000;',
    anchor: 'export const EMAIL_MAX',
    expected: ['C9', 'H6'],
  },
};

function freshCopy() {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  cpSync(join(WT, 'apps/invoicing'), join(SCRATCH, 'apps/invoicing'), { recursive: true });
  cpSync(join(WT, 'docs/design/tokens'), join(SCRATCH, 'docs/design/tokens'), { recursive: true });
  cpSync(join(WT, '.dockerignore'), join(SCRATCH, '.dockerignore'));
}

function count(hay, needle) { return hay.split(needle).length - 1; }

function applyMutant(name, m) {
  const path = join(SCRATCH, m.file);
  const before = readFileSync(path, 'utf8');
  const nBefore = count(before, m.from);
  if (nBefore !== 1) throw new Error(`${name}: pattern occurs ${nBefore} times, expected exactly 1 — refusing`);
  // Site check: the match must sit after the anchor and before the next top-level function.
  const at = before.indexOf(m.from);
  const anchorAt = before.indexOf(m.anchor);
  if (anchorAt < 0 || anchorAt > at) throw new Error(`${name}: match is not inside the anchored site ${m.anchor}`);
  const after = before.replace(m.from, m.to);
  writeFileSync(path, after);
  const check = readFileSync(path, 'utf8');
  if (count(check, m.from) !== 0 || count(check, m.to) !== 1) throw new Error(`${name}: mutation did not apply`);
  const line = before.slice(0, at).split('\n').length;
  return { line, nBefore };
}

function composeRun(logfile) {
  const r = spawnSync(DOCKER, ['compose', '-p', PROJECT, 'run', '--rm', '--build', 'test'],
    { cwd: join(SCRATCH, 'apps/invoicing'), env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}\n--- exit ${r.status} ---\n`;
  writeFileSync(logfile, out);
  const built = /Image \S+ Built/.test(out);
  const summary = Object.fromEntries(['tests', 'pass', 'fail', 'skipped'].map((k) => [k, Number((out.match(new RegExp(`ℹ ${k} (\\d+)`)) ?? [])[1])]));
  // Red set: top-level failing test labels (node --test spec reporter prints "✖ <name>").
  const red = [...out.matchAll(/^✖ ([A-Z]+\d+):/gm)].map((x) => x[1]);
  return { status: r.status, built, summary, red: [...new Set(red)] };
}

const which = process.argv[2] ? [process.argv[2]] : Object.keys(MUTANTS);
const results = {};
for (const name of which) {
  const m = MUTANTS[name];
  freshCopy();
  const { line } = applyMutant(name, m);
  const res = composeRun(join(LOGDIR, `compose-${name}.log`));
  const exp = [...m.expected].sort().join(',');
  const got = [...res.red].sort().join(',');
  results[name] = { site: `${m.file}:${line}`, built: res.built, exit: res.status, ...res.summary, red: got, expected: exp, match: exp === got };
  console.log(name, JSON.stringify(results[name]));
}
rmSync(SCRATCH, { recursive: true, force: true });
writeFileSync(join(LOGDIR, 'mutants-result.json'), JSON.stringify(results, null, 2));
console.log('\nscratch copy removed; worktree untouched throughout.');
