// AS-49 mutation driver (agent:developer-lena). Every mutant runs on a FRESH
// scratch extraction of the branch tip (git archive -> /tmp/as49-mut/<id>),
// never in the worktree. Each recipe: extract, mutate, ASSERT the anchor count
// before and after (site-anchored), run the full `test` (and optionally
// `contract`) service with --build under its own project name, collect the
// exact red set, write a per-mutant log, tear the project down.
//
// Usage: node mutate.mjs <id>[,<id>...] | node mutate.mjs anchors
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DOCKER = '/usr/local/bin/docker';
const WORKTREE = '/Users/forrest/Code/american-software-company/.worktrees/AS-49';
const TIP = 'a3619a8';
const ROOT = '/tmp/as49-mut';
const OUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-49/mutants';
mkdirSync(OUT, { recursive: true });

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};

function extract(id) {
  const dir = path.join(ROOT, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = path.join(ROOT, `${id}.tar`);
  let r = sh('git', ['-C', WORKTREE, 'archive', '--format=tar', '-o', tar, TIP]);
  if (r.status !== 0) throw new Error(`git archive failed: ${r.out}`);
  r = sh('tar', ['-xf', tar, '-C', dir]);
  if (r.status !== 0) throw new Error(`tar failed: ${r.out}`);
  rmSync(tar);
  return dir;
}

const countOf = (file, needle) => readFileSync(file, 'utf8').split(needle).length - 1;

// Each recipe: { file, anchor (must be unique = 1 before), apply(text) -> text,
// after: [[needle, expectedCount], ...] checks, services: ['test'] | ['test','contract'] }
const RECIPES = {
  F1: {
    file: 'routes/auth.js',
    anchor: "router.post('/signup', form, enter('sign-up', (body) => accounts.signUp({",
    apply: (t, a) => t.replace(a, a.replace('accounts.signUp({', 'accounts.signIn({')),
    after: [["enter('sign-up', (body) => accounts.signIn({", 1], ["enter('sign-up', (body) => accounts.signUp({", 0]],
  },
  F2: {
    file: 'lib/connect/onboarding.js',
    anchor: 'repos.connectedAccounts.create({ freelancerId, stripeAccountId });',
    apply: (t, a) => t.replace(a, '/* F2 mutant: row create deleted */'),
    after: [['repos.connectedAccounts.create({ freelancerId, stripeAccountId });', 0], ['F2 mutant', 1]],
  },
  F3: {
    file: 'lib/webhooks/receiver.js',
    anchor: 'repos.connectedAccounts.updateReadiness(object.id, readinessFromAccount(object, iso(event.created)));',
    apply: (t, a) => t.replace(a, '/* F3 mutant: updateReadiness deleted */'),
    after: [['repos.connectedAccounts.updateReadiness(object.id', 0], ['F3 mutant', 1]],
  },
  F4: {
    file: 'lib/contracts/generation.js',
    anchor: 'const renderedHtml = renderContract(template, variables);',
    apply: (t, a) => t.replace(a, "const renderedHtml = renderContract(template, { ...variables, clientName: 'nobody' });"),
    after: [["renderContract(template, { ...variables, clientName: 'nobody' });", 1]],
  },
  F5: {
    file: 'routes/invoices.js',
    // Anchor to the create-draft handler: the createDraft( line followed by the
    // return editPath line (the update handler's return line is identical text).
    anchor: null,
    apply: (t) => {
      const re = /(createDraft\([^\n]*\n\s*)return editPath\(invoice\.id\);/;
      if (!re.test(t)) throw new Error('F5 anchor (createDraft line followed by return editPath) not found');
      return t.replace(re, '$1return detailPath(invoice.id);');
    },
    before: [['return editPath(invoice.id);', 2], ['return detailPath', 2]],
    after: [['return editPath(invoice.id);', 1], ['return detailPath', 3]],
  },
  F6: {
    file: 'lib/invoices/lifecycle.js',
    anchor: "if (invoice.status === 'draft') {",
    apply: (t, a) => t.replace(a, "if (invoice.status === 'never') {"),
    after: [["if (invoice.status === 'never') {", 1], ["if (invoice.status === 'draft') {", 0]],
  },
  F7: {
    file: 'lib/invoices/lifecycle.js',
    anchor: "if (through === 'send' && invoice.sentAt === null) {",
    apply: (t, a) => t.replace(a, "if (false && through === 'send' && invoice.sentAt === null) {"),
    after: [["if (false && through === 'send' && invoice.sentAt === null) {", 1]],
  },
  F8: {
    file: 'lib/webhooks/receiver.js',
    anchor: "'invoice.paid': invoiceRow,",
    apply: (t, a) => t.replace(a, '/* F8 mutant: invoice.paid handler deleted */'),
    after: [["'invoice.paid': invoiceRow,", 0], ['F8 mutant', 1]],
  },
  F9: {
    file: 'lib/webhooks/receiver.js',
    anchor: "if (!repos.stripeEvents.recordOnce(event.id, event.type)) return { outcome: 'duplicate' };",
    apply: (t, a) => t.replace(a, 'repos.stripeEvents.recordOnce(event.id, event.type);'),
    after: [["return { outcome: 'duplicate' }", 0], ['repos.stripeEvents.recordOnce(event.id, event.type);', 1]],
  },
  F10: {
    file: 'lib/webhooks/signature.js',
    anchor: 'if (supplied.length === expected.length && timingSafeEqual(supplied, expected)) return { timestamp };',
    apply: (t, a) => t.replace(a, 'return { timestamp };'),
    after: [['timingSafeEqual(supplied, expected)', 0]],
  },
  F10b: {
    // Instrument mutant, no source edit: E1's double built with the wrong secret.
    file: 'test/e2e-loop.test.js',
    anchor: null,
    apply: (t) => {
      const re = /(the twelve steps', async \(\) => \{\n  const double = createStripeDouble\(\{ webhookSecret: )SECRET( \}\);)/;
      if (!re.test(t)) throw new Error('F10b anchor (E1 title line + createStripeDouble) not found');
      return t.replace(re, "$1'whsec_other'$2");
    },
    // Six sites (E0..E5 each build one); the plan's "5" was a miscount.
    before: [['createStripeDouble({ webhookSecret: SECRET })', 6]],
    after: [['createStripeDouble({ webhookSecret: SECRET })', 5], ["the twelve steps', async () => {\n  const double = createStripeDouble({ webhookSecret: 'whsec_other' });", 1]],
  },
  F11: {
    file: 'lib/invoices/lifecycle.js',
    anchor: 'metadata: { local_invoice_id: invoice.id },',
    apply: (t, a) => t.replace(a, `${a}\n        transfer_data: { destination: acct },`),
    after: [['transfer_data: { destination: acct },', 1]],
  },
  F12: {
    file: 'lib/db/repositories/invoices.js',
    anchor: "if (incomingRank < currentRank) return outcome('stale');",
    apply: (t, a) => t.replace(a, '/* F12 mutant: stale rank check deleted */'),
    after: [["if (incomingRank < currentRank) return outcome('stale');", 0], ['F12 mutant', 1]],
  },
  'F-ALLOW': {
    file: 'lib/stripe/custody.js',
    anchor: null,
    apply: (t) => {
      // Insert a tenth row right after the first row of ALLOWED_ENDPOINTS.
      const re = /(export const ALLOWED_ENDPOINTS = (?:Object\.freeze\()?\[\n)/;
      if (!re.test(t)) throw new Error('F-ALLOW anchor (ALLOWED_ENDPOINTS opener) not found');
      return t.replace(re, "$1  { method: 'GET', path: '/v1/customers/{id}', scope: 'connected', reason: 'mutant' },\n");
    },
    before: [["reason: 'mutant'", 0]],
    after: [["reason: 'mutant'", 1]],
  },
  'F-SHAPE': {
    file: 'test/helpers/stripe-double.js',
    // The one invoice literal lives in newInvoice(); `object: 'invoice',` is unique.
    anchor: "object: 'invoice',",
    apply: (t, a) => t.replace(a, `${a}\n      invented_key: 1,`),
    after: [['invented_key: 1,', 1]],
    services: ['test', 'contract'],
  },
  'F-V2': {
    file: 'test/harness.test.js',
    // Put the harness back to master's text (19 entries, literal 19) with the
    // new e2e file still on disk: the implementation's natural first red.
    anchor: "  'e2e-loop.test.js',\n",
    apply: (t, a) => t.replace(a, '').replace('assert.equal(found.length, 20, `expected exactly 20 test files', 'assert.equal(found.length, 19, `expected exactly 19 test files'),
    after: [["'e2e-loop.test.js'", 0], ['found.length, 19', 1], ['found.length, 20', 0]],
  },
};

function applyMutation(dir, id) {
  const r = RECIPES[id];
  const file = path.join(dir, 'apps/invoicing', r.file);
  const before = readFileSync(file, 'utf8');
  const checks = [];
  if (r.anchor) {
    const c = countOf(file, r.anchor);
    checks.push(`before: anchor count ${c} (expected 1)`);
    if (c !== 1) throw new Error(`${id}: anchor count before = ${c}, expected 1`);
  }
  for (const [needle, n] of r.before ?? []) {
    const c = countOf(file, needle);
    checks.push(`before: "${needle.slice(0, 60)}" = ${c} (expected ${n})`);
    if (c !== n) throw new Error(`${id}: before-check "${needle}" = ${c}, expected ${n}`);
  }
  const after = r.apply(before, r.anchor);
  if (after === before) throw new Error(`${id}: mutation did not change the file`);
  writeFileSync(file, after);
  for (const [needle, n] of r.after ?? []) {
    const c = countOf(file, needle);
    checks.push(`after: "${needle.slice(0, 60)}" = ${c} (expected ${n})`);
    if (c !== n) throw new Error(`${id}: after-check "${needle}" = ${c}, expected ${n}`);
  }
  const diff = sh('diff', ['-u', '--label', `${r.file} (tip)`, '--label', `${r.file} (${id})`, '-', file], { input: before }).out;
  return { checks, diff };
}

function compose(project, composeFile, service) {
  const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
  const run = sh(DOCKER, ['compose', '-p', project, '-f', composeFile, 'run', '--rm', '--build', service], { env });
  const down = sh(DOCKER, ['compose', '-p', project, '-f', composeFile, '--profile', 'tools', 'down', '-v', '--rmi', 'local'], { env });
  return { run, down };
}

function summarize(out) {
  const lines = out.split('\n');
  const built = lines.filter((l) => /Image .* Built/.test(l)).map((l) => l.trim());
  const totals = lines.filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l)).map((l) => l.trim()).join(' ');
  // node --test repeats every red under a trailing "failing tests:" banner; stop there.
  const cut = lines.findIndex((l) => /^✖ failing tests:/.test(l));
  const reds = (cut === -1 ? lines : lines.slice(0, cut)).filter((l) => /^✖ /.test(l)).map((l) => l.replace(/ \([\d.]+ms\)$/, '').trim());
  // First error line after each red for the message.
  const messages = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(message|error):/.test(lines[i]) || /Error \[|AssertionError|expected:|actual:/.test(lines[i])) messages.push(lines[i].trim());
  }
  return { built, totals, reds, messages: messages.slice(0, 80) };
}

async function runMutant(id) {
  const r = RECIPES[id];
  const dir = extract(id);
  const { checks, diff } = applyMutation(dir, id);
  const composeFile = path.join(dir, 'apps/invoicing/compose.yaml');
  const project = `asc-impl-as49-mut-${id.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const report = [`# ${id}`, `scratch ${dir}, project ${project}`, ...checks, '', '## diff', diff, ''];
  for (const service of r.services ?? ['test']) {
    const { run, down } = compose(project, composeFile, service);
    writeFileSync(path.join(OUT, `${id}-${service}.log`), run.out);
    const s = summarize(run.out);
    report.push(`## ${service}: exit ${run.status}; ${s.built.join(' | ') || 'NO BUILD LINE'}; ${s.totals}`);
    report.push(`red set (${s.reds.length}):`);
    for (const x of s.reds) report.push(`  ${x}`);
    report.push('messages:');
    for (const m of s.messages) report.push(`  ${m}`);
    report.push(`down exit ${down.status}`);
    report.push('');
  }
  writeFileSync(path.join(OUT, `${id}.md`), report.join('\n'));
  console.log(report.join('\n'));
  rmSync(dir, { recursive: true, force: true });
}

const arg = process.argv[2];
if (arg === 'anchors') {
  const dir = extract('anchors');
  for (const [id, r] of Object.entries(RECIPES)) {
    const file = path.join(dir, 'apps/invoicing', r.file);
    if (!existsSync(file)) { console.log(`${id}: MISSING ${r.file}`); continue; }
    if (r.anchor) console.log(`${id}: anchor count ${countOf(file, r.anchor)} in ${r.file}`);
    else console.log(`${id}: (regex/custom anchor) in ${r.file}`);
    for (const [needle, n] of r.before ?? []) console.log(`${id}: before "${needle.slice(0, 50)}" = ${countOf(file, needle)} (want ${n})`);
  }
  rmSync(dir, { recursive: true, force: true });
} else {
  for (const id of arg.split(',')) await runMutant(id);
}
