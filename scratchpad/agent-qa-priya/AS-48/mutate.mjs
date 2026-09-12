// Priya's mutation runner for AS-48 review. Usage: node mutate.mjs <recipe>
// Extracts feat/AS-48-read-views HEAD via git archive into a scratch dir (once),
// applies ONE mutation with an asserted occurrence count at the intended site,
// runs the offline suite with --build in an isolated project, records the
// failing test names, restores the file byte-for-byte from the pristine
// extract, and asserts the restore.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/Users/forrest/Code/american-software-company';
const WT = `${REPO}/.worktrees/AS-48`;
const SCRATCH = `${REPO}/scratchpad/agent-qa-priya/AS-48/mutants`;
const PRISTINE = `${SCRATCH}/pristine`;
const WORK = `${SCRATCH}/work`;
const APP = 'apps/invoicing';
const OUT = `${REPO}/scratchpad/agent-qa-priya/AS-48`;
const DOCKER = '/usr/local/bin/docker';

const recipes = {
  F2: { file: 'views/invoice-detail.ejs',
    from: 'View hosted invoice page (Stripe): <code class="link-text"><%= hostedInvoiceUrl %></code>',
    to: 'View hosted invoice page (Stripe): <a href="<%= hostedInvoiceUrl %>">open</a>', expect: 1 },
  F5: { file: 'lib/screens/dashboard-view.js',
    from: "const stripeReady = account !== null && account.ready === true;\n\n  const isPopulated = state === 'S3-DEFAULT-POPULATED';",
    to: "const stripeReady = true;\n\n  const isPopulated = state === 'S3-DEFAULT-POPULATED';", expect: 1 },
  F6: { file: 'lib/screens/invoice-detail-view.js',
    from: 'const canSend = sendable && stripeReady;', to: 'const canSend = sendable;', expect: 1 },
  F8: { file: 'routes/invoices.js',
    from: "if (typeof id !== 'string' || !UUID_SHAPE.test(id)) return fail(res, step, new NotFoundError('invoice'));",
    to: "if (typeof id !== 'string') return fail(res, step, new NotFoundError('invoice'));", expect: 1 },
  F3: { file: 'lib/screens/invoice-detail-view.js',
    from: 'const hostedInvoiceUrl = rendersRow ? invoice.hostedInvoiceUrl ?? null : null;',
    to: 'const hostedInvoiceUrl = null;', expect: 1 },
  F13: { file: 'lib/screens/invoice-detail-view.js',
    from: "if (failure === 'not-found') return 'S5-ERROR-NOTFOUND';\n  if (failure === 'system') return 'S5-ERROR-SYSTEM';\n  if (invoice === null) return 'S5-ERROR-NOTFOUND';\n  if (invoice.status === 'paid') return 'S5-DEFAULT-PAID';",
    to: "if (invoice !== null && invoice.status === 'paid') return 'S5-DEFAULT-PAID';\n  if (failure === 'not-found') return 'S5-ERROR-NOTFOUND';\n  if (failure === 'system') return 'S5-ERROR-SYSTEM';\n  if (invoice === null) return 'S5-ERROR-NOTFOUND';", expect: 1 },
  F9: { file: 'routes/invoices.js',
    from: "  router.get('/invoices/view', redirector('screen-view', detailPath));\n",
    to: "", expect: 1, append: "\n  router.get('/invoices/view', redirector('screen-view', detailPath));\n  // ─── THE API (AS-43)", appendAt: "\n  // ─── THE API (AS-43)" },
};

const name = process.argv[2];
const r = recipes[name];
if (!r) { console.error('unknown recipe', name, Object.keys(recipes)); process.exit(2); }

function sh(cmd, args, opts = {}) {
  const p = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return p;
}

// 1. Extract once.
if (!fs.existsSync(PRISTINE)) {
  fs.mkdirSync(PRISTINE, { recursive: true });
  // Whole tree: the Dockerfile's context is the repo root (tokens.css, .dockerignore).
  const ar = sh('sh', ['-c', `git -C ${WT} archive HEAD | tar -x -C ${PRISTINE}`]);
  if (ar.status !== 0) { console.error(ar.stderr); process.exit(3); }
}
// Fresh work copy per run.
fs.rmSync(WORK, { recursive: true, force: true });
fs.cpSync(PRISTINE, WORK, { recursive: true });

// 2. Mutate, assert applied at the intended site.
const target = path.join(WORK, APP, r.file);
const before = fs.readFileSync(target, 'utf8');
const count = before.split(r.from).length - 1;
if (count !== r.expect) { console.error(`MUTATION NOT ANCHORED: found ${count} occurrences of the from-pattern in ${r.file}, expected ${r.expect}`); process.exit(4); }
let after = before.split(r.from).join(r.to);
if (r.append) {
  const c2 = after.split(r.appendAt).length - 1;
  if (c2 !== 1) { console.error(`append anchor found ${c2} times`); process.exit(4); }
  after = after.replace(r.appendAt, r.append);
}
fs.writeFileSync(target, after);
const applied = fs.readFileSync(target, 'utf8');
const stillThere = applied.split(r.from).length - 1;
const nowThere = r.to ? applied.split(r.to).length - 1 : 0;
console.log(`[${name}] mutation applied at ${r.file}: from-pattern now ${stillThere}, to-pattern now ${nowThere}`);
const diff = sh('diff', ['-u', path.join(PRISTINE, APP, r.file), target]);
console.log(diff.stdout.split('\n').slice(0, 40).join('\n'));

// 3. Run the suite with --build in its own project.
const proj = `asc-review-as48-priya-${name.toLowerCase()}`;
const run = sh(DOCKER, ['compose', '-p', proj, 'run', '--rm', '--build', 'test'], {
  cwd: path.join(WORK, APP), env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' },
});
const log = `${OUT}/mutant-${name}.log`;
fs.writeFileSync(log, (run.stdout || '') + '\n--- STDERR ---\n' + (run.stderr || '') + `\nEXIT=${run.status}\n`);
const all = (run.stdout || '') + (run.stderr || '');
const built = /Image .*Built/.test(all);
const summary = {};
for (const k of ['tests', 'pass', 'fail', 'skipped']) { const m = all.match(new RegExp(`ℹ ${k} (\\d+)`)); summary[k] = m ? +m[1] : null; }
const reds = [...all.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
console.log(`[${name}] built=${built} exit=${run.status} ${JSON.stringify(summary)}`);
console.log(`[${name}] RED (${reds.length}):`);
for (const t of reds) console.log('   - ' + t);

// 4. Tear down the mutant project's image and restore.
sh(DOCKER, ['compose', '-p', proj, 'down', '-v', '--rmi', 'local'], { cwd: path.join(WORK, APP) });
fs.copyFileSync(path.join(PRISTINE, APP, r.file), target);
const restored = fs.readFileSync(target, 'utf8') === before;
console.log(`[${name}] restored=${restored}`);
