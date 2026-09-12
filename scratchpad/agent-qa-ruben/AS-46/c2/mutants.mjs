// AS-46 review cycle 2 mutant battery (Ruben). Runs against a scratch archive
// of the branch tip only — never the worktree.
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';

const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-46/c2';
const SRC = `${ROOT}/src`;
const APP = `${SRC}/apps/invoicing`;
const W = '/Users/forrest/Code/american-software-company/.worktrees/AS-46';
const TIP = '7d5751c';
const DOCKER = '/usr/local/bin/docker';
const PROJECT = 'asc-review-as46-c2-mut';

function restore() {
  rmSync(SRC, { recursive: true, force: true });
  mkdirSync(SRC, { recursive: true });
  execFileSync('sh', ['-c', `git -C ${W} archive ${TIP} | tar -x -C ${SRC}`]);
}
const count = (file, needle) => readFileSync(`${APP}/${file}`, 'utf8').split(needle).length - 1;

function runSuite(label) {
  const r = spawnSync(DOCKER, ['compose', '-p', PROJECT, '-f', `${APP}/compose.yaml`, 'run', '--build', '--rm', 'test'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  writeFileSync(`${ROOT}/mut-${label}.log`, out + `\nEXIT=${r.status}\n`);
  const built = /Image \S+ Built/.test(out);
  const failing = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^not ok \d+ - (.*)$/);
    if (m) failing.push(m[1]);
  }
  const sum = {};
  for (const k of ['tests', 'pass', 'fail', 'skipped']) { const m = out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')); sum[k] = m ? Number(m[1]) : null; }
  return { built, failing, sum, exit: r.status };
}

const D1_CASE = 'in add-new picker mode a save or send without a client marks exactly the field the banner counts';
const SLOT_RE = /\n\s*<% if \(clientError !== null\) \{ %>\n\s*<%# A save\/send with no client while adding one[\s\S]*?id="client-error"><%= clientError %><\/span>\n\s*<\/div>\n\s*<% \} %>/;

const MUTANTS = [
  {
    id: 'M1-remove-slot', file: 'views/invoice-form.ejs',
    // Remove the whole add-new error slot (anchored on the id="client-error" span, which exists only there).
    apply: (s) => s.replace(SLOT_RE, '\n            <%# RUBEN-M1 slot removed %>'),
    assert: () => count('views/invoice-form.ejs', 'id="client-error"') === 0 && count('views/invoice-form.ejs', 'RUBEN-M1') === 1 && count('views/invoice-form.ejs', 'clientError !== null') === 1,
    predicted: [D1_CASE, '(dependency-policy VIEW_START_TAGS: 336 -> 332)'],
  },
  {
    id: 'M2-null-in-new-mode', file: 'lib/screens/invoice-form-view.js',
    // The cycle-1 defect re-introduced in the view model with the slot still present.
    apply: (s) => s.replace("if (showErrors && clientIdError !== null) clientError = pickerMode === 'new' ? FIELD_MESSAGE.clientAddFirst : clientIdError;",
      "if (showErrors && clientIdError !== null) clientError = pickerMode === 'new' ? null : clientIdError; /* RUBEN-M2 */"),
    assert: () => count('lib/screens/invoice-form-view.js', 'RUBEN-M2') === 1 && count('lib/screens/invoice-form-view.js', "pickerMode === 'new' ? null : clientIdError") === 1,
    predicted: [D1_CASE],
  },
  {
    id: 'M3-select-copy-in-new-mode', file: 'lib/screens/invoice-form-view.js',
    // The slot renders, but with the select-mode sentence.
    apply: (s) => s.replace("if (showErrors && clientIdError !== null) clientError = pickerMode === 'new' ? FIELD_MESSAGE.clientAddFirst : clientIdError;",
      "if (showErrors && clientIdError !== null) clientError = clientIdError; /* RUBEN-M3 */"),
    assert: () => count('lib/screens/invoice-form-view.js', 'RUBEN-M3') === 1 && count('lib/screens/invoice-form-view.js', 'FIELD_MESSAGE.clientAddFirst') === 0,
    predicted: [D1_CASE],
  },
  {
    id: 'M4-unmarked-slot', file: 'views/invoice-form.ejs',
    // The slot renders the sentence but is not a marked field: banner 1, markers 0.
    apply: (s) => s.replace('<div class="field field--invalid">\n                <span class="field-error" id="client-error">', '<div class="field">\n                <span class="field-error" id="client-error">'),
    assert: () => count('views/invoice-form.ejs', '<div class="field">\n                <span class="field-error" id="client-error">') === 1 && count('views/invoice-form.ejs', 'id="client-error"') === 1,
    predicted: [D1_CASE],
  },
];

const only = process.argv.slice(2);
const results = [];
for (const m of MUTANTS) {
  if (only.length > 0 && !only.includes(m.id)) continue;
  restore();
  const path = `${APP}/${m.file}`;
  const before = readFileSync(path, 'utf8');
  const after = m.apply(before);
  writeFileSync(path, after);
  const applied = after !== before && m.assert();
  console.log(`\n=== ${m.id} (${m.file}) applied=${applied}`);
  if (!applied) { results.push({ id: m.id, applied: false }); continue; }
  const r = runSuite(m.id);
  console.log(`built=${r.built} exit=${r.exit} tests=${r.sum.tests} pass=${r.sum.pass} fail=${r.sum.fail} skipped=${r.sum.skipped}`);
  console.log('RED SET:'); for (const f of r.failing) console.log('  -', f);
  console.log('predicted:', JSON.stringify(m.predicted));
  results.push({ id: m.id, applied, ...r, predicted: m.predicted });
}
restore();
writeFileSync(`${ROOT}/mutants-results.json`, JSON.stringify(results, null, 2));
console.log('\nrestored scratch to', TIP);
