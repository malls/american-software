// Scratch: run one §8 recipe on a git-archive extract OUTSIDE the worktree.
//   node recipe.cjs <name> <mutator> [--env K=V] [--cmd "node --test ..."] [--service contract]
//   mutators: none | fraw-a | fraw-b | fraw-c | fraw-dup | fdl-a | fdl-b | fsys |
//             fprint-a | fprint-b | fprint-c | f11b | f8
// Extracts HEAD of the AS-47 worktree to /tmp/as47-<name>, mutates, asserts the
// mutation applied at the intended site, runs the counted compose suite there
// (project asc-as47-<name>), writes the log beside this file. The default path
// goes through apps/chat/bin/compose-run.mjs; --env / --cmd / --service use a
// direct spawn of the same docker binary with the same run -> down -> leak
// sequence, because compose-run only knows the plain `test` service.
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');
const argv = process.argv.slice(2);
const [name, mutator] = argv;
const opt = { env: {}, cmd: null, service: 'test' };
for (let i = 2; i < argv.length; i++) {
  if (argv[i] === '--env') { const [k, v] = argv[++i].split('='); opt.env[k] = v; }
  else if (argv[i] === '--cmd') { opt.cmd = argv.slice(i + 1); break; }
  else if (argv[i] === '--service') opt.service = argv[++i];
}
const DOCKER = '/usr/local/bin/docker';
const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-47';
const ROOT = '/Users/forrest/Code/american-software-company';
const OUT = `/tmp/as47-${name}`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
execSync(`git -C ${WT} archive HEAD apps/invoicing docs/design/tokens .dockerignore | tar -x -C ${OUT}`);
const app = `${OUT}/apps/invoicing`;
const count = (file, re) => (fs.readFileSync(file, 'utf8').match(re) || []).length;
const mutate = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
const tpl = `${app}/views/contract-detail.ejs`;
const css = `${app}/public/app.css`;
const route = `${app}/routes/contracts.js`;
const screenTest = `${app}/test/contract-screens.test.js`;
const applied = (label, before, after, expectBefore, expectAfter) => {
  console.log(`assert-applied ${label}: ${before} -> ${after} (expected ${expectBefore} -> ${expectAfter})`);
  if (before !== expectBefore || after !== expectAfter) throw new Error('mutation did not apply at the intended site');
};
if (mutator === 'none') {
  console.log('no mutation');
} else if (mutator === 'fraw-a') {
  const b = count(tpl, /<%-/g);
  mutate(tpl, (s) => s.replace(/^(\s*)<%- renderedHtml %>$/m, '$1<%= renderedHtml %>'));
  applied('<%- in contract-detail.ejs', b, count(tpl, /<%-/g), 1, 0);
} else if (mutator === 'fraw-b') {
  const b = count(tpl, /<%-/g);
  mutate(tpl, (s) => s.replace('<h1 class="page-title"><%= title %></h1>', '<h1 class="page-title"><%- title %></h1>'));
  applied('<%- in contract-detail.ejs', b, count(tpl, /<%-/g), 1, 2);
  if (count(tpl, /<h1 class="page-title"><%- title %><\/h1>/g) !== 1) throw new Error('marker missing: the h1 site');
} else if (mutator === 'fraw-c') {
  const b = count(tpl, /^\s*<%- renderedHtml %>$/m);
  mutate(tpl, (s) => s.replace(/^(\s*)<%- renderedHtml %>$/m, '$1<div><%- renderedHtml %></div>'));
  applied('whole-line raw site', b, count(tpl, /^\s*<%- renderedHtml %>$/m), 1, 0);
  if (count(tpl, /<div><%- renderedHtml %><\/div>/g) !== 1) throw new Error('marker missing');
  if (count(tpl, /<%-/g) !== 1) throw new Error('raw tag count moved — wrong site');
} else if (mutator === 'fraw-dup') {
  const b = count(tpl, /<%-/g);
  mutate(tpl, (s) => s.replace(/^(\s*<%- renderedHtml %>)$/m, '$1\n$1'));
  applied('<%- in contract-detail.ejs', b, count(tpl, /<%-/g), 1, 2);
} else if (mutator === 'fdl-a') {
  const b = count(route, /req\.query\.download === '1'/g);
  mutate(route, (s) => s.replace("isDownload: req.query.download === '1'", 'isDownload: Boolean(req.query.download)'));
  applied("download === '1' in routes/contracts.js", b, count(route, /req\.query\.download === '1'/g), 1, 0);
  if (count(route, /Boolean\(req\.query\.download\)/g) !== 1) throw new Error('marker missing');
} else if (mutator === 'fdl-b') {
  const b = count(route, /filename="contract-\$\{contract\.id\}\.html"/g);
  mutate(route, (s) => s.replace('filename="contract-${contract.id}.html"', 'filename="contract-${req.params.id}.html"'));
  applied('filename from contract.id (the Content-Disposition line)', b, count(route, /filename="contract-\$\{contract\.id\}\.html"/g), 1, 0);
  if (count(route, /filename="contract-\$\{req\.params\.id\}\.html"/g) !== 1) throw new Error('marker missing');
} else if (mutator === 'fsys') {
  const b = count(screenTest, /db\.exec\('DROP TABLE contracts'\);/g);
  mutate(screenTest, (s) => s.replace("      db.exec('DROP TABLE contracts');\n", ''));
  applied('DROP TABLE contracts in case 25 (scratch edit of the TEST)', b, count(screenTest, /db\.exec\('DROP TABLE contracts'\);/g), 1, 0);
} else if (mutator === 'fprint-a') {
  const b = count(css, /\.contract-doc__notice \{ display: none; \}/g);
  mutate(css, (s) => s.replace('@media print {\n', '@media print {\n  .contract-doc__notice { display: none; }\n'));
  applied('notice hidden inside print', b, count(css, /\.contract-doc__notice \{ display: none; \}/g), 0, 1);
  if (count(css, /@media print \{\n  \.contract-doc__notice/g) !== 1) throw new Error('marker not inside the print block');
} else if (mutator === 'fprint-b') {
  const b = count(css, /@media print \{/g);
  mutate(css, (s) => s + '\n@media print {\n  .doc-region { padding: 0; }\n}\n');
  applied('@media print preludes', b, count(css, /@media print \{/g), 1, 2);
} else if (mutator === 'fprint-c') {
  const b = count(css, /@media \(max-width/g);
  mutate(css, (s) => s + '\n@media (max-width: 600px) {}\n');
  applied('max-width preludes', b, count(css, /@media \(max-width/g), 0, 1);
} else if (mutator === 'f11b') {
  const vm = `${app}/lib/screens/contract-detail-view.js`;
  const b = count(vm, /disposition: 'rendered as S7-ERROR-NOTFOUND'/g);
  mutate(vm, (s) => s.replace("{ id: 'S7-DENIED-NOTOWNER', disposition: 'rendered as S7-ERROR-NOTFOUND' }", "{ id: 'S7-DENIED-NOTOWNER', disposition: 'rendered' }"));
  applied('NOTOWNER disposition', b, count(vm, /disposition: 'rendered as S7-ERROR-NOTFOUND'/g), 1, 0);
  if (count(vm, /id: 'S7-DENIED-NOTOWNER', disposition: 'rendered' \}/g) !== 1) throw new Error('marker missing');
} else if (mutator === 'f8') {
  // The "New contract" anchor moved to AS-127 (tick 7), so F8 now breaks the
  // sign-out form action — the form branch of the same instrument.
  const b = count(tpl, /action="\/signuot"/g);
  mutate(tpl, (s) => s.replace('method="post" action="/signout"', 'method="post" action="/signuot"'));
  applied('signuot action', b, count(tpl, /action="\/signuot"/g), 0, 1);
  if (count(tpl, /action="\/signout"/g) !== 0) throw new Error('the original action survived — wrong site');
} else {
  throw new Error(`unknown mutator ${mutator}`);
}
const log = `${ROOT}/scratchpad/agent-developer-marcus/AS-47/recipe-${name}.log`;
const project = `asc-as47-${name}`;
let out;
if (Object.keys(opt.env).length === 0 && opt.cmd === null && opt.service === 'test') {
  const r = spawnSync('node', [`${ROOT}/apps/chat/bin/compose-run.mjs`, '--project', project, '--cwd', app, '--log', log], { encoding: 'utf8', cwd: ROOT });
  process.stdout.write(r.stdout.split('\n').slice(-8).join('\n') + '\n');
  out = fs.readFileSync(log, 'utf8');
} else {
  // Direct spawn: the same run -> ALWAYS down -> leak-check sequence as
  // compose-run, with the env / command / service it cannot express.
  const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
  const runArgs = ['compose', '-p', project, 'run', '--rm', '--build'];
  for (const [k, v] of Object.entries(opt.env)) runArgs.push('-e', `${k}=${v}`);
  runArgs.push(opt.service);
  if (opt.cmd) runArgs.push(...opt.cmd);
  console.log(`docker ${runArgs.join(' ')}`);
  const r = spawnSync(DOCKER, runArgs, { encoding: 'utf8', cwd: app, env, maxBuffer: 64 * 1024 * 1024 });
  out = (r.stdout || '') + (r.stderr || '');
  const d = spawnSync(DOCKER, ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { encoding: 'utf8', cwd: app, env });
  const nets = spawnSync(DOCKER, ['network', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}_`));
  const imgs = spawnSync(DOCKER, ['images', '--format', '{{.Repository}}:{{.Tag}}'], { encoding: 'utf8' }).stdout.split('\n').filter((n) => n.startsWith(`${project}-`));
  fs.writeFileSync(log, out);
  const built = out.split('\n').filter((l) => /Image .* Built/.test(l)).map((l) => l.trim());
  const sum = (k) => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1];
  console.log(`RECEIPT project=${project}\n  built: ${built.join(' | ') || 'missing'}\n  tests=${sum('tests')} pass=${sum('pass')} fail=${sum('fail')} skipped=${sum('skipped')}\n  run exit=${r.status}\n  down exit=${d.status}\n  leak check: ${nets.length + imgs.length ? 'LEAK ' + [...nets, ...imgs].join(',') : 'clean'}`);
}
const failed = out.split('\n').filter((l) => /^✖/.test(l) && !/^✖ (failing tests:|test\/)/.test(l));
const seen = new Set();
for (const l of failed) seen.add(l.replace(/ \([0-9.]+ms\)$/, ''));
console.log(`RED SET (${seen.size}):`);
for (const l of seen) console.log('  ' + l);
