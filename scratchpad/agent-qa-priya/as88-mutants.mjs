// AS-88 review mutants (qa-priya). Each mutant gets its own copy of the scratch
// git-archive tree; the worktree is never touched. Usage: node as88-mutants.mjs M1 M2 ...
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const S = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-priya';
const PRISTINE = `${S}/as88-scratch/apps/chat`;
const FILE = 'watch/advance-watcher.mjs';

// [id, anchor (must occur exactly once in the pristine file), replacement]
const MUTANTS = {
  M1: [`['compose', '-p', composeProject, '--progress', 'plain', 'up', '-d', '--build']`,
       `['compose', '--progress', 'plain', 'up', '-d', '--build']`],
  M1b: [`['compose', '-p', composeProject, '--progress', 'plain', 'up', '-d', '--build']`,
        `['compose', '-p', 'asc-chat', '--progress', 'plain', 'up', '-d', '--build']`],
  M2: [`  if (typeof composeProject !== 'string' || composeProject.trim() === '') {\n    throw new Error('runDockerCompose: composeProject is required — the deploy names its compose project explicitly (AS-88)');\n  }\n`,
       ``],
  M3: [`        composeProject,\n        onSpawn: (proc) => {`,
       `        composeProject: 'asc-chat',\n        onSpawn: (proc) => {`],
  M4: [`  const envIntent = (env.COMPOSE_PROJECT_NAME ?? '').trim();\n  if (envIntent !== '' && envIntent !== composeProject) {\n    throw new Error(\n      \`makeDeployOps: COMPOSE_PROJECT_NAME=\${envIntent} is set but the deploy scrubs its environment and would target '\${composeProject}'; \` +\n        \`pass composeProject: '\${envIntent}' explicitly or unset the variable (AS-88, AS-75 review F8)\`,\n    );\n  }\n`,
       ``],
  M5: [`if (envIntent !== '' && envIntent !== composeProject) {`,
       `if (envIntent !== '') {`],
  M6: [`          COMPOSE_DOCKER_CLI_BUILD: '1',\n`,
       `          COMPOSE_DOCKER_CLI_BUILD: '1',\n          COMPOSE_PROJECT_NAME: env.COMPOSE_PROJECT_NAME,\n`],
  M7: [`  lockOps,\n  composeProject,\n}) {`,
       `  lockOps,\n  composeProject = PRODUCTION_COMPOSE_PROJECT,\n}) {`],
  M8: [`        isPidAlive,\n        composeProject: PRODUCTION_COMPOSE_PROJECT,\n      });`,
       `        isPidAlive,\n      });`],
  M9: [`export const PRODUCTION_COMPOSE_PROJECT = 'asc-chat';`,
       `export const PRODUCTION_COMPOSE_PROJECT = 'asc-chat2';`],
};

const count = (hay, needle) => hay.split(needle).length - 1;

for (const id of process.argv.slice(2)) {
  const [anchor, repl] = MUTANTS[id];
  const dir = `${S}/mut-${id}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(PRISTINE, dir, { recursive: true });
  const before = readFileSync(`${dir}/${FILE}`, 'utf8');
  const nBefore = count(before, anchor);
  if (nBefore !== 1) throw new Error(`${id}: anchor occurs ${nBefore} times in pristine (need exactly 1)`);
  const after = before.replace(anchor, repl);
  writeFileSync(`${dir}/${FILE}`, after);
  const applied = readFileSync(`${dir}/${FILE}`, 'utf8');
  const nAfter = count(applied, anchor);
  const nRepl = repl === '' ? 0 : count(applied, repl);
  const insertion = repl.includes(anchor); // M6: the anchor survives inside the replacement
  const ok = applied !== before && (insertion ? nRepl === 1 : (nAfter === 0 && (repl === '' || nRepl >= 1)));
  if (!ok) throw new Error(`${id}: mutation NOT applied (anchor after=${nAfter}, repl=${nRepl})`);
  // line number of the site, for the record
  const line = before.slice(0, before.indexOf(anchor)).split('\n').length;
  const r = spawnSync('node', ['--test'], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync(`${S}/mut-${id}.log`, out);
  const summary = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped)/.test(l)).map((l) => l.replace('ℹ ', '')).join(' ');
  const failing = out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, ''));
  const uniq = [...new Set(failing)].filter((n) => !/^test\/.*\.test\.js$/.test(n));
  console.log(`=== ${id} @line ${line} applied(anchor ${nBefore}->${nAfter}) exit ${r.status} | ${summary}`);
  for (const f of uniq) console.log(`   RED: ${f}`);
  rmSync(dir, { recursive: true, force: true });
}
