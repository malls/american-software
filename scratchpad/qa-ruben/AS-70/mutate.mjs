#!/usr/bin/env node
// qa-ruben AS-70 mutation battery. One indivisible step per mutant:
//   copy pristine -> mut/<name>; mutate; ASSERT APPLIED on disk (occurrence-
//   accurate count at the intended site); build+run `test` in project
//   asc-rev-as70-<name>; ASSERT APPLIED in the image (same count via grep in
//   the built image); record the failing set; down -v --rmi local; diff the
//   mutated copy against pristine to prove exactly one file moved.
// Predictions are fixed in this table BEFORE any run (see PRED_* below).
// Usage: node mutate.mjs <name> [<name>...]   |   node mutate.mjs --list
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const DOCKER = '/usr/local/bin/docker';
const ROOT = '/Users/forrest/Code/american-software-company/scratchpad/qa-ruben/AS-70/mut';
const PRISTINE = join(ROOT, 'pristine');
const APP = 'apps/invoicing';

const count = (text, needle) => text.split(needle).length - 1;
const countRe = (text, re) => (text.match(re) ?? []).length;

// Case titles (verbatim from screens.test.js / dependency-policy.test.js / auth / health).
const T = {
  ledger: 'screen 2 accounts for all nine of its ledger rows, and exactly four of them render',
  partition: "screen 2's nine ledger rows partition 4 + 2 + 1 + 1 + 1",
  total: 'the Connect view model is a total function of the row and the error flag, and the flag is a boolean',
  notstarted: 'S2-DEFAULT-NOTSTARTED renders for a signed-in freelancer with no connected account',
  nr1: 'S2-RETURN-NOTREADY renders when charges are disabled',
  nr2: 'S2-RETURN-NOTREADY renders when charges are enabled but requirements are still due',
  ready: 'S2-RETURN-READY renders for a ready row, and the screen reads ready rather than re-deriving it',
  nocall: 'the Connect screen makes no Stripe call, writes nothing, and never renders the account id',
  error: 'S2-ERROR-SYSTEM renders at ?error=start, and the parameter value never reaches the page',
  refresh: 'S2-REFRESH and S2-LOADING never render this screen',
  concept: 'the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43, AS-44 and AS-45 put them, and nowhere else',
  landingRoot: 'GET / redirects a signed-in caller to the Connect screen, and renders nothing itself',
  landingSignin: 'a signed-in GET /signin lands on a page that exists',
  landingSignup: 'a successful sign-up with no next lands on a page that exists',
  landingSigninPost: 'a successful sign-in with no next lands on a page that exists',
  h11: 'H11: a garbage cookie is refused exactly like an absent one',
  healthRoot: 'GET / answers a signed-in caller rather than 404ing',
};

const MUTANTS = {
  // --- plan recipes --------------------------------------------------------
  f7: {
    file: 'views/connect-stripe.ejs', // NOTE: the copy lives in the VIEW MODEL, not the template — see f7 below
    skip: 'copy is in lib/screens/connect-view.js; use f7vm',
  },
  f7vm: {
    file: 'lib/screens/connect-view.js',
    apply: (t) => t.replace("your clients' funds — Stripe", "your clients' money — Stripe"),
    asserts: [[/money/gi, 0, 1]],
    predicted: [T.concept],
    note: "F7 (re-sited): the plan put the lede in the template; the diff puts copy in the view model. The money row scans raw text over lib/screens too (plan AC 21), so the predicted red is still exactly the concept-row case.",
  },
  f11: {
    file: 'views/connect-stripe.ejs',
    apply: (t) => t.replace(/        <% if \(banner\.tone === 'warning'\) \{ %>\n          <div class="banner banner-warning">\n            <p><%= banner\.message %><\/p>\n          <\/div>\n        <% \} %>\n/, ''),
    asserts: [['banner-warning', 1, 0]],
    predicted: [T.nr1, T.nr2, T.partition, T.concept],
    note: 'F11: delete the warning branch. Four predicted: two NOTREADY HTTP cases, the partition case (marker count 1->0), the concept row (VIEW_START_TAGS -4).',
  },
  f11b: {
    file: 'lib/screens/connect-view.js',
    apply: (t) => t.replace("{ id: 'S2-REFRESH', disposition: 'redirect-answered' }", "{ id: 'S2-REFRESH', disposition: 'rendered' }"),
    asserts: [["'S2-REFRESH', disposition: 'rendered'", 0, 1]],
    predicted: [T.ledger, T.partition, T.refresh],
    note: 'F11-b: the two transcriptions are compared. Three predicted; views health check stays green.',
  },
  f18: {
    file: 'routes/pages.js',
    apply: (t) => t.replace("res.redirect(303, '/connect-stripe');", "res.redirect(303, '/nope');"),
    asserts: [["'/nope'", 0, 1]],
    predicted: [T.landingRoot, T.landingSignin, T.landingSignup, T.landingSigninPost, T.h11, T.healthRoot],
    note: 'F18: the landing is followed to its terminus — exactly the six cases of plan §3.5.',
  },
  f19: {
    file: 'routes/connect.js',
    apply: (t) => t.replace(
      "router.get('/connect-stripe', (req, res) => {\n    const account = repos.connectedAccounts.getByFreelancer(actingFreelancerId(req));",
      "router.get('/connect-stripe', async (req, res) => {\n    try { await onboarding.handleRefresh(actingFreelancerId(req)); } catch {}\n    const account = repos.connectedAccounts.getByFreelancer(actingFreelancerId(req));",
    ),
    asserts: [['handleRefresh(', 1, 2]],
    predicted: [T.nocall],
    note: 'F19: the screen calls Stripe. Exactly one predicted: the no-call case (calls === 0 fails; the catch swallows the throw; renders proceed).',
  },
  f20: {
    file: 'lib/screens/connect-view.js',
    apply: (t) => t.replace('const startFailed = input.startFailed === true;', 'const startFailed = Boolean(input.startFailed);'),
    asserts: [['Boolean(input.startFailed)', 0, 1]],
    predicted: [T.total],
    note: "F20: the flag is a boolean. Route's === 'start' intact, so case 8 stays green; exactly one predicted (case 3).",
  },
  f21: {
    file: 'test/dependency-policy.test.js',
    apply: (t) => t.replace("scanConcept('event-handler attribute', /\\son[a-z]+\\s*=/i, [], { only: /^(views|public)\\//, expectFiles: 3 });", "scanConcept('event-handler attribute', /\\son[a-z]+\\s*=/i, [], { only: /^views\\//, expectFiles: 3 });"),
    asserts: [['/^(views|public)\\//', 4, 3]],
    predicted: [T.concept],
    note: 'F21: P2b scoped to views/ only, expectFiles left at 3 -> examined 2, expected 3. Exactly one predicted. Direction two (old floor stays green) is run as f21floor.',
  },
  f21floor: {
    file: 'test/dependency-policy.test.js',
    // Same narrowing as f21, but ALSO revert this row's guard to the old `> 0` floor by
    // passing expectFiles: 2 (what the floor would have accepted). Predicted: NO red —
    // proves the fix, not the guard's existence.
    apply: (t) => t.replace("scanConcept('event-handler attribute', /\\son[a-z]+\\s*=/i, [], { only: /^(views|public)\\//, expectFiles: 3 });", "scanConcept('event-handler attribute', /\\son[a-z]+\\s*=/i, [], { only: /^views\\//, expectFiles: 2 });"),
    asserts: [['/^(views|public)\\//', 4, 3], ['expectFiles: 2', 0, 1]],
    predicted: [],
    note: 'F21 direction two: under-examination with a count that matches what a floor would accept -> green. Shows the red in f21 comes from the committed count, not from the scoping.',
  },
  f22: {
    file: 'lib/screens/connect-view.js',
    apply: (t) => t.replace("return account.ready === true ? 'S2-RETURN-READY' : 'S2-RETURN-NOTREADY';", "return (account.chargesEnabled === true && account.requirementsCurrentlyDue.length === 0) ? 'S2-RETURN-READY' : 'S2-RETURN-NOTREADY';"),
    asserts: [['requirementsCurrentlyDue.length', 0, 1]],
    predicted: [T.ready, T.total],
    note: "F22: the view model re-derives ready. Plan predicts ONE (case 6). I predict TWO: case 3's rows are { ready: true } with NO chargesEnabled/requirementsCurrentlyDue, so the re-derivation throws on .length of undefined / yields NOTREADY -> case 3 red as well. Also the VIEWS sampleLocals row: connectLocals() has account null -> unaffected.",
  },
  f23: {
    file: 'views/connect-stripe.ejs',
    apply: (t) => t.replace('          <div class="banner banner-success">\n            <p><%= banner.message %></p>\n          </div>', '          <div class="banner banner-success">\n            <p><%= banner.message %></p>\n          </div>\n          <a href="/">Continue to Dashboard</a>'),
    // Baseline CORRECTED: the plan's recipe says 'Continue to Dashboard' is 0 -> 1, but the
    // template's header comment already spells the phrase once (1 -> 2). Anchored on the
    // markup instead: the anchor element itself goes 0 -> 1.
    asserts: [['<a href="/">Continue to Dashboard</a>', 0, 1], ['Continue to Dashboard', 1, 2]],
    predicted: [T.ready, T.concept],
    note: 'F23: a dangling control on READY. Two predicted: case 6 (zero-anchor) and the concept row (VIEW_START_TAGS +2). P2a stays green. Plan baseline (0) was wrong: the EJS comment carries the phrase.',
  },
  // --- reviewer's own ------------------------------------------------------
  r1_expectfiles_refusal: {
    file: 'test/dependency-policy.test.js',
    apply: (t) => t.replace("scanConcept('script or style element', /<(script|style)\\b/i, [], { only: /^(views|public)\\//, expectFiles: 3 });", "scanConcept('script or style element', /<(script|style)\\b/i, [], { only: /^(views|public)\\// });"),
    asserts: [['expectFiles: 3', 4, 3]],
    predicted: [T.concept],
    note: 'R1: the expectFiles refusal branch has no committed red. Drop expectFiles from one scoped row -> the "must commit to a file count" assertion fires. Exactly one predicted.',
  },
  r2_route_presence: {
    file: 'routes/connect.js',
    apply: (t) => t.replace("startFailed: req.query.error === 'start'", "startFailed: req.query.error !== undefined"),
    asserts: [["req.query.error !== undefined", 0, 1]],
    predicted: [T.error],
    note: "R2: the route passes presence, not the closed enum. ?error=ASC70MARK, ?error=START, ?error=start&error=start now select ERROR -> case 8 red. Case 7 stays green (its ?error= inputs are 'start'). Exactly one predicted.",
  },
  r3_precedence_flip: {
    file: 'lib/screens/connect-view.js',
    apply: (t) => t.replace("  if (startFailed) return 'S2-ERROR-SYSTEM';\n  if (account === null) return 'S2-DEFAULT-NOTSTARTED';", "  if (account === null) return 'S2-DEFAULT-NOTSTARTED';\n  if (startFailed) return 'S2-ERROR-SYSTEM';"),
    asserts: [["  if (account === null) return 'S2-DEFAULT-NOTSTARTED';\n  if (startFailed) return 'S2-ERROR-SYSTEM';", 0, 1]],
    predicted: [T.total, T.error],
    note: 'R3: precedence flipped (row outranks error when no row). Case 3 (null x true cell) and case 8 (no-row ?error=start) red. Case 7: body 6 becomes NOTSTARTED but body 5 (ready row + error) is still ERROR, so the states set is unchanged -> green (a weakness of case 7 worth noting, not a defect).',
  },
  r4_wrong_tone_class: {
    file: 'views/connect-stripe.ejs',
    apply: (t) => t.replace('<div class="banner banner-warning">', '<div class="banner banner-error">'),
    asserts: [['banner-warning', 1, 0], ['banner-error', 1, 2]],
    predicted: [T.nr1, T.nr2, T.partition],
    note: 'R4: the warning branch renders the error class (a copy-shape slip the constant-per-branch rule invites). NOTREADY cases (banner-warning 0) and the partition case (warning 0, error 2). Concept row unmoved (same tag count).',
  },
  r5_branch_on_state_id: {
    file: 'views/connect-stripe.ejs',
    apply: (t) => t.replace("<% if (banner.tone === 'warning') { %>", "<% if (state === 'S2-RETURN-NOTREADY') { %>"),
    asserts: [["state === 'S2-RETURN-NOTREADY'", 0, 1]],
    predicted: [],
    note: "R5 (orchestrator's probe): make the template branch on a state id. The plan's rule 'the template does not branch on state ids' is prose; the markup is identical so the marker counts hold. Predicted: NOTHING goes red. A survivor by design — records that the rule is not mechanised.",
  },
};

function grepInImage(project, cwd, file, needle, isRegex) {
  // Count occurrences inside the freshly built image (no --build: the same project's image, built seconds ago).
  // Needle travels as an env var and the script as one argv element — no shell, no quoting.
  const script = isRegex
    ? 'const t=require("fs").readFileSync("/app/"+process.env.QF,"utf8");const m=process.env.QN.match(/^\\/(.*)\\/([a-z]*)$/);console.log((t.match(new RegExp(m[1],m[2]))||[]).length)'
    : 'const t=require("fs").readFileSync("/app/"+process.env.QF,"utf8");console.log(t.split(process.env.QN).length-1)';
  const r = spawnSync(DOCKER, ['compose', '-p', project, 'run', '--rm', '--no-deps', '-e', `QF=${file}`, '-e', `QN=${needle}`, 'test', 'node', '-e', script], { cwd, encoding: 'utf8', env: { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' } });
  return (r.stdout ?? '').trim().split('\n').pop();
}

function imageAssert(name) {
  // Rebuild the mutant image and assert the mutation inside it — a separate pass because the
  // battery's own image assert was broken by shell quoting (harness bug, not a guard result).
  const m = MUTANTS[name];
  const dir = join(ROOT, name);
  const cwd = join(dir, APP);
  const project = `asc-rev-as70-${name.replace(/_/g, '-')}-img`;
  const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
  rmSync(dir, { recursive: true, force: true });
  cpSync(PRISTINE, dir, { recursive: true });
  const path = join(cwd, m.file);
  writeFileSync(path, m.apply(readFileSync(path, 'utf8')));
  const b = spawnSync(DOCKER, ['compose', '-p', project, 'build', 'test'], { cwd, env, encoding: 'utf8' });
  const built = /Built/.test(b.stdout + b.stderr) || b.status === 0;
  const results = [];
  for (const [needle, , expAfter] of m.asserts) {
    const isRe = needle instanceof RegExp;
    const got = grepInImage(project, cwd, m.file, isRe ? needle.toString() : needle, isRe);
    results.push(`${JSON.stringify(String(needle)).slice(0, 50)} -> ${got} (exp ${expAfter}) ${String(got) === String(expAfter) ? 'OK' : '!! MISMATCH'}`);
  }
  spawnSync(DOCKER, ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { cwd, env, encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  console.log(`${name} image (build exit ${b.status}${built ? '' : ' NOT BUILT'}): ${results.join(' ; ')}`);
}

function run(name) {
  const m = MUTANTS[name];
  if (!m) throw new Error(`unknown mutant ${name}`);
  if (m.skip) { console.log(`\n### ${name}: SKIPPED — ${m.skip}`); return; }
  const dir = join(ROOT, name);
  const cwd = join(dir, APP);
  const project = `asc-rev-as70-${name.replace(/_/g, '-')}`;
  const env = { ...process.env, DOCKER_BUILDKIT: '1', COMPOSE_DOCKER_CLI_BUILD: '1' };
  console.log(`\n### ${name} — ${m.note}`);
  console.log(`predicted failing set (${m.predicted.length}): ${m.predicted.map((t) => JSON.stringify(t)).join(', ') || '(none)'}`);
  rmSync(dir, { recursive: true, force: true });
  cpSync(PRISTINE, dir, { recursive: true });
  const path = join(cwd, m.file);
  const before = readFileSync(path, 'utf8');
  const after = m.apply(before);
  if (after === before) { console.log(`!! MUTATION DID NOT APPLY (text unchanged) — aborting ${name}`); rmSync(dir, { recursive: true, force: true }); return; }
  writeFileSync(path, after);
  // Assert applied on disk, occurrence-accurate, at the intended site.
  for (const [needle, expBefore, expAfter] of m.asserts) {
    const c = needle instanceof RegExp ? countRe : count;
    const b = c(before, needle); const a = c(after, needle);
    const ok = b === expBefore && a === expAfter;
    console.log(`disk assert ${JSON.stringify(String(needle))}: before=${b} (exp ${expBefore}) after=${a} (exp ${expAfter}) ${ok ? 'OK' : '!! MISMATCH'}`);
    if (!ok) { console.log(`!! aborting ${name}`); rmSync(dir, { recursive: true, force: true }); return; }
  }
  // Build + run.
  const r = spawnSync(DOCKER, ['compose', '-p', project, 'run', '--rm', '--build', 'test'], { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const out = `${r.stdout}\n--- stderr ---\n${r.stderr}`;
  writeFileSync(join(ROOT, `${name}.log`), out);
  const built = out.split('\n').filter((l) => /Image .* Built/.test(l)).map((l) => l.trim());
  const summary = out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped)\b/.test(l.trim())).map((l) => l.trim()).join(' ');
  // Failing set: top-level `not ok` lines, title extracted.
  const failing = [...new Set(out.split('\n').filter((l) => /^not ok \d+ - /.test(l)).map((l) => l.replace(/^not ok \d+ - /, '').trim()))];
  // Assert applied in the image.
  for (const [needle, , expAfter] of m.asserts) {
    const isRe = needle instanceof RegExp;
    const got = grepInImage(project, cwd, m.file, isRe ? needle.toString() : needle, isRe);
    console.log(`image assert ${JSON.stringify(String(needle))}: ${got} (exp ${expAfter}) ${String(got) === String(expAfter) ? 'OK' : '!! MISMATCH'}`);
  }
  console.log(`exit=${r.status} BUILT: ${built.join(' | ') || '(none — RUN VOID)'}`);
  console.log(`SUMMARY: ${summary}`);
  console.log(`observed failing set (${failing.length}): ${failing.map((t) => JSON.stringify(t)).join(', ') || '(none)'}`);
  const missing = m.predicted.filter((t) => !failing.includes(t));
  const extra = failing.filter((t) => !m.predicted.includes(t));
  console.log(`divergence: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)} -> ${missing.length === 0 && extra.length === 0 ? 'MATCH' : 'DIVERGES'}`);
  // Tear down.
  const d = spawnSync(DOCKER, ['compose', '-p', project, 'down', '-v', '--rmi', 'local', '--remove-orphans'], { cwd, env, encoding: 'utf8' });
  console.log(`down exit=${d.status}`);
  // Prove exactly one file differs from pristine, then remove the copy (the diff is kept in the log).
  const diff = spawnSync('diff', ['-rq', PRISTINE, dir], { encoding: 'utf8' });
  const changed = diff.stdout.trim().split('\n').filter(Boolean);
  console.log(`files differing from pristine: ${changed.length} -> ${changed.join('; ')}`);
  const u = spawnSync('diff', ['-u', join(PRISTINE, APP, m.file), path], { encoding: 'utf8' });
  writeFileSync(join(ROOT, `${name}.diff`), u.stdout);
  rmSync(dir, { recursive: true, force: true });
}

const args = process.argv.slice(2);
if (args[0] === '--list') { for (const [k, v] of Object.entries(MUTANTS)) console.log(k, '-', v.note ?? v.skip); process.exit(0); }
if (args[0] === '--image-assert') { for (const name of args.slice(1)) imageAssert(name); process.exit(0); }
for (const name of args) run(name);
