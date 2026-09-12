// AS-45 cycle 4 mutation harness — developer-lena.
//
// WHY THIS EXISTS. The plan says every command runs inside compose
// (`docker compose run --rm test`). This tick has no reachable docker binary
// (`docker` is not on PATH; the absolute path is not in the tick allowlist),
// so the container cannot be built or run. This harness is the honest
// fallback and its limits are stated where they are used:
//   - it runs the REAL test file `test/dependency-policy.test.js`, unmodified,
//     under the host's node, against a `git archive` extract;
//   - the only edit to the extract is `test/helpers/server.js`, replaced by a
//     stub that exports APP_DIR alone (the real helper imports app.js ->
//     express, which is not installed on the host). APP_DIR is computed by the
//     same expression, so the scan sees the same tree.
//   - `dependency-policy.test.js` reads only files from disk; it makes no HTTP
//     request and starts no server, so nothing it asserts depends on the
//     container. The rest of the suite DOES, and is not run here.
//
// Usage:
//   node harness.mjs extract <ref|WORKTREE> <destName>
//   node harness.mjs mutate  <destName> <file> <fromLiteral> <toLiteral> <expectFrom> <expectTo>
//   node harness.mjs run     <destName>
//   node harness.mjs count   <destName> <file> <literal>

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const REPO = '/Users/forrest/Code/american-software-company';
const WT = join(REPO, '.worktrees/AS-45');
const SCRATCH = join(REPO, 'scratchpad/developer-lena');

const STUB = `// SCRATCH STUB (developer-lena, AS-45 cycle 4). The real helper imports
// app.js -> express, which is not installed on the host. dependency-policy
// .test.js consumes only APP_DIR, whose value is computed identically here.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
`;

const [, , cmd, ...args] = process.argv;
const dest = (name) => join(SCRATCH, name);
const app = (name) => join(dest(name), 'apps/invoicing');

/** Occurrence-accurate count of a literal — the `grep -oF … | wc -l` shape.
 *  Never a line count. */
function occurrences(path, literal) {
  const body = readFileSync(path, 'utf8');
  let n = 0;
  let i = body.indexOf(literal);
  while (i !== -1) { n += 1; i = body.indexOf(literal, i + literal.length); }
  return n;
}

if (cmd === 'extract') {
  const [ref, name] = args;
  rmSync(dest(name), { recursive: true, force: true });
  mkdirSync(dest(name), { recursive: true });
  const tar = ref === 'WORKTREE'
    ? execFileSync('git', ['-C', WT, 'archive', '--format=tar', 'HEAD', 'apps/invoicing'], { maxBuffer: 1 << 28 })
    : execFileSync('git', ['-C', WT, 'archive', '--format=tar', ref, 'apps/invoicing'], { maxBuffer: 1 << 28 });
  const tmp = join(SCRATCH, `${name}.tar`);
  writeFileSync(tmp, tar);
  execFileSync('tar', ['-x', '-f', tmp, '-C', dest(name)]);
  rmSync(tmp);
  writeFileSync(join(app(name), 'test/helpers/server.js'), STUB);
  console.log(`extracted ${ref} -> ${dest(name)} (helpers/server.js stubbed)`);
} else if (cmd === 'worktree-dirty') {
  // Copy the WORKING TREE (uncommitted edits included), not a commit.
  const [name] = args;
  rmSync(dest(name), { recursive: true, force: true });
  mkdirSync(join(dest(name), 'apps'), { recursive: true });
  execFileSync('cp', ['-R', join(WT, 'apps/invoicing'), join(dest(name), 'apps/invoicing')]);
  writeFileSync(join(app(name), 'test/helpers/server.js'), STUB);
  console.log(`copied worktree working tree -> ${dest(name)} (helpers/server.js stubbed)`);
} else if (cmd === 'count') {
  const [name, file, literal] = args;
  console.log(occurrences(join(app(name), file), literal));
} else if (cmd === 'mutate') {
  const [name, file, from, to, expFrom, expTo] = args;
  const path = join(app(name), file);
  const before = occurrences(path, from);
  if (before !== Number(expFrom)) {
    console.error(`ABORT: baseline occurrences of FROM = ${before}, expected ${expFrom}`);
    process.exit(2);
  }
  const body = readFileSync(path, 'utf8');
  if (!body.includes(from)) { console.error('ABORT: FROM literal absent'); process.exit(2); }
  writeFileSync(path, body.replace(from, to));
  const after = occurrences(path, to);
  if (after !== Number(expTo)) {
    console.error(`ABORT: post-mutation occurrences of TO = ${after}, expected ${expTo}`);
    process.exit(2);
  }
  console.log(`ASSERT APPLIED: '${to}' ${0} -> ${after} in ${file} (FROM was ${before})`);
} else if (cmd === 'run') {
  const [name] = args;
  const r = spawnSync(process.execPath, ['--test', join(app(name), 'test/dependency-policy.test.js')], {
    encoding: 'utf8', maxBuffer: 1 << 28,
  });
  const out = `${r.stdout}${r.stderr}`;
  const grab = (re) => (out.match(re) ?? [, '?'])[1];
  console.log(`EXIT ${r.status}`);
  console.log(`tests ${grab(/tests (\d+)/m)} / pass ${grab(/pass (\d+)/m)} / fail ${grab(/fail (\d+)/m)}`);
  const failing = [...out.matchAll(/^(?:not ok \d+ - |✖ )(.+?)(?: \(\d+\.\d+ms\))?$/gm)].map((m) => m[1]);
  console.log(`FAILING CASE SET (${failing.length}): ${JSON.stringify(failing)}`);
  for (const line of out.split('\n')) {
    if (/AssertionError|expected \d+ —|P4 examined|found in \[|error: '/.test(line)) console.log(`  | ${line.trim()}`);
  }
  writeFileSync(join(SCRATCH, `${name}.log`), out);
  console.log(`(full log: scratchpad/developer-lena/${name}.log)`);
} else {
  console.error('unknown command'); process.exit(1);
}
void dirname;
