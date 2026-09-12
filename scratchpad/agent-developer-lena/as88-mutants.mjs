// AS-88 mutation battery. Each mutant runs on a fresh `git archive` of the
// branch head (never the worktree), is asserted applied at the intended site
// (occurrence count of an anchored string goes 1 -> 0, replacement 0 -> 1),
// and the exact failing-test set is recorded.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-88';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/as88-mutants.log';
const HEAD = execFileSync('git', ['-C', WT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const W = 'apps/chat/watch/advance-watcher.mjs';

const MUTANTS = [
  { id: 'M1', ac: 'AC-1', file: W, desc: "delete '-p', composeProject from argv",
    from: "spawnFn(dockerBin, ['compose', '-p', composeProject, '--progress', 'plain', 'up', '-d', '--build'], {",
    to:   "spawnFn(dockerBin, ['compose', '--progress', 'plain', 'up', '-d', '--build'], {",
    expect: ['AS-87 runDockerCompose argv: compose is spawned with --progress plain, never quiet', "AS-88 runDockerCompose names the caller's project: -p carries composeProject, not a literal"] },
  { id: 'M1b', ac: 'AC-1', file: W, desc: "argv carries the literal 'asc-chat' instead of composeProject",
    from: "spawnFn(dockerBin, ['compose', '-p', composeProject, '--progress',",
    to:   "spawnFn(dockerBin, ['compose', '-p', 'asc-chat', '--progress',",
    expect: ["AS-88 runDockerCompose names the caller's project: -p carries composeProject, not a literal"] },
  { id: 'M2', ac: 'AC-2', file: W, desc: 'delete the guard at the top of runDockerCompose',
    from: "  if (typeof composeProject !== 'string' || composeProject.trim() === '') {\n    throw new Error('runDockerCompose: composeProject is required — the deploy names its compose project explicitly (AS-88)');\n  }\n  return new Promise((resolve_) => {",
    to:   "  return new Promise((resolve_) => {",
    expect: ['AS-88 runDockerCompose refuses an implicit project: no composeProject -> throws before opening the log or spawning'] },
  { id: 'M3', ac: 'AC-3', file: W, desc: "hard-code composeProject: 'asc-chat' in performDeploy's deploy({...})",
    from: "        timeoutMs: deployTimeoutMs,\n        log,\n        composeProject,\n        onSpawn: (proc) => {",
    to:   "        timeoutMs: deployTimeoutMs,\n        log,\n        composeProject: 'asc-chat',\n        onSpawn: (proc) => {",
    expect: ['AS-88 performDeploy passes composeProject through to deploy() and names it in the DEPLOY building line'] },
  { id: 'M4', ac: 'AC-4', file: W, desc: 'delete the envIntent block in makeDeployOps',
    from: "  const envIntent = (env.COMPOSE_PROJECT_NAME ?? '').trim();\n  if (envIntent !== '' && envIntent !== composeProject) {\n    throw new Error(\n      `makeDeployOps: COMPOSE_PROJECT_NAME=${envIntent} is set but the deploy scrubs its environment and would target '${composeProject}'; ` +\n        `pass composeProject: '${envIntent}' explicitly or unset the variable (AS-88, AS-75 review F8)`,\n    );\n  }\n",
    to:   "",
    expect: ['AS-88 makeDeployOps refuses a COMPOSE_PROJECT_NAME the scrub would discard (AS-75 review F8)'] },
  { id: 'M5', ac: 'AC-5', file: W, desc: 'drop the equality clause: refuse any non-empty COMPOSE_PROJECT_NAME',
    from: "  if (envIntent !== '' && envIntent !== composeProject) {",
    to:   "  if (envIntent !== '') {",
    expect: ['AS-88 makeDeployOps accepts an agreeing or empty COMPOSE_PROJECT_NAME'] },
  { id: 'M6', ac: 'AC-6', file: W, desc: 'add a COMPOSE_PROJECT_NAME pass-through to the deploy env allowlist',
    from: "          COMPOSE_DOCKER_CLI_BUILD: '1',\n          CHAT_BUILD_ID: desiredId,\n        },",
    to:   "          COMPOSE_DOCKER_CLI_BUILD: '1',\n          CHAT_BUILD_ID: desiredId,\n          COMPOSE_PROJECT_NAME: env.COMPOSE_PROJECT_NAME,\n        },",
    expect: ['AS-75 makeDeployOps: a stale container is rebuilt with the right env, and success means the RUNNING id changed'] },
  { id: 'M7', ac: 'AC-7', file: W, desc: 'give makeDeployOps composeProject a default of PRODUCTION_COMPOSE_PROJECT',
    from: "  isPidAlive = pidAlive,\n  lockOps,\n  composeProject,\n}) {",
    to:   "  isPidAlive = pidAlive,\n  lockOps,\n  composeProject = PRODUCTION_COMPOSE_PROJECT,\n}) {",
    expect: ['AS-88 makeDeployOps requires composeProject: no default, throws at construction'] },
  { id: 'M8', ac: 'AC-8', file: W, desc: "delete composeProject: PRODUCTION_COMPOSE_PROJECT from makeWatcher's wiring",
    from: "        pid,\n        isPidAlive,\n        composeProject: PRODUCTION_COMPOSE_PROJECT,\n      });\n    log(`DEPLOY-POLL every",
    to:   "        pid,\n        isPidAlive,\n      });\n    log(`DEPLOY-POLL every",
    expect: ['AS-88 makeWatcher: deploys to the production project — start() without injected deploy ops builds them with PRODUCTION_COMPOSE_PROJECT'] },
  { id: 'M9', ac: 'AC-9', file: W, desc: "PRODUCTION_COMPOSE_PROJECT = 'asc-chat2'",
    from: "export const PRODUCTION_COMPOSE_PROJECT = 'asc-chat';",
    to:   "export const PRODUCTION_COMPOSE_PROJECT = 'asc-chat2';",
    expect: ['deploy-shape: PRODUCTION_COMPOSE_PROJECT is the `name:` compose.yaml declares', 'AS-88 makeWatcher: deploys to the production project — start() without injected deploy ops builds them with PRODUCTION_COMPOSE_PROJECT'] },
];

function count(hay, needle) {
  if (needle === '') return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'as88-mut-'));
  const tar = execFileSync('git', ['-C', WT, 'archive', '--format=tar', HEAD, 'apps/chat'], { maxBuffer: 1 << 28 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar, maxBuffer: 1 << 28 });
  return dir;
}

function runSuite(dir) {
  const r = spawnSync('node', ['--test'], { cwd: join(dir, 'apps', 'chat'), encoding: 'utf8', maxBuffer: 1 << 28 });
  const out = r.stdout + r.stderr;
  const summary = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) {
    const m = new RegExp(`^ℹ ${k} (\\d+)$`, 'm').exec(out);
    summary[k] = m ? Number(m[1]) : null;
  }
  // the "failing tests:" tail lists each failure once as "✖ <name> (ms)"
  const tailIdx = out.indexOf('✖ failing tests:');
  const tail = tailIdx >= 0 ? out.slice(tailIdx) : '';
  const failing = [...tail.matchAll(/^✖ (.+?) \(\d+(?:\.\d+)?ms\)$/gm)].map((m) => m[1]);
  return { status: r.status, summary, failing: [...new Set(failing)].sort() };
}

const lines = [`AS-88 mutation battery on ${HEAD} (${new Date().toISOString()})`, ''];
const log = (l) => { lines.push(l); console.log(l); };

// Control: the UNMUTATED archive. A `git archive` has no .git, so any test that
// shells out to git fails in this environment regardless of mutation; that set
// is subtracted from every mutant's red set below, and reported once here.
let control;
{
  const dir = freshCopy();
  try {
    control = runSuite(dir);
    log(`M0 control (unmutated archive): tests ${control.summary.tests} pass ${control.summary.pass} fail ${control.summary.fail} skipped ${control.summary.skipped} exit ${control.status}`);
    log(`  environment red set (${control.failing.length}, subtracted from every mutant below): ${control.failing.map((f) => `\n    - ${f}`).join('')}`);
    log('');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const only = process.argv.slice(2);
for (const m of MUTANTS) {
  if (only.length && !only.includes(m.id)) continue;
  const dir = freshCopy();
  try {
    const p = join(dir, m.file);
    const before = readFileSync(p, 'utf8');
    const cBefore = count(before, m.from), cToBefore = count(before, m.to);
    if (cBefore !== 1) throw new Error(`${m.id}: anchor matched ${cBefore} times before mutation (need exactly 1)`);
    const after = before.replace(m.from, m.to);
    writeFileSync(p, after);
    const reread = readFileSync(p, 'utf8');
    const cAfter = count(reread, m.from), cToAfter = count(reread, m.to);
    // The anchor is unique (asserted above), so anchor 1->0 with the file
    // changed proves the edit landed at that site and nowhere else. The
    // replacement count is informational: a deletion whose remainder is a
    // substring of the anchor (M2) leaves it unchanged by construction.
    const applied = cAfter === 0 && reread !== before;
    if (!applied) throw new Error(`${m.id}: mutation did NOT apply at the site (from ${cBefore}->${cAfter}, to ${cToBefore}->${cToAfter})`);
    const r = runSuite(dir);
    const red = r.failing.filter((f) => !control.failing.includes(f));
    const exp = [...m.expect].sort();
    const same = JSON.stringify(red) === JSON.stringify(exp);
    const verdict = red.length === 0 ? 'SURVIVED' : same ? 'RED (exact set as predicted)' : 'RED (set differs from prediction)';
    log(`${m.id} [${m.ac}] ${m.desc}`);
    log(`  applied: anchor ${cBefore}->${cAfter}, replacement ${cToBefore}->${cToAfter}`);
    log(`  suite: tests ${r.summary.tests} pass ${r.summary.pass} fail ${r.summary.fail} skipped ${r.summary.skipped} exit ${r.status}`);
    log(`  ${verdict}`);
    log(`  red set net of control (${red.length}): ${red.map((f) => `\n    - ${f}`).join('')}`);
    if (!same) log(`  predicted (${exp.length}): ${exp.map((f) => `\n    - ${f}`).join('')}`);
    log('');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
mkdirSync(join(OUT, '..'), { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');
