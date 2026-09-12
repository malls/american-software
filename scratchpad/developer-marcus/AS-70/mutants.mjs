// AS-70 falsification recipes (plan §7). Each recipe: git-archive extract OUTSIDE
// the worktree, mutate, assert applied on disk AND in the built image with an
// occurrence-accurate count, run the suite with --build in an isolated project,
// record the failing set against the PREDICTION WRITTEN HERE BEFORE THE RUN,
// tear down with `down --rmi local`.
//
// Usage: node mutants.mjs <recipe> [<recipe>...]   (from the repo root)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/forrest/Code/american-software-company';
const WORKTREE = join(ROOT, '.worktrees/AS-70');
const DOCKER = '/usr/local/bin/docker';
const OUT = join(ROOT, 'scratchpad/developer-marcus/AS-70/mut');
const SCRATCH = '/tmp/asc-as70-mut';

const count = (text, needle) => text.split(needle).length - 1;
const countRe = (text, re) => (text.match(re) ?? []).length;

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function extract(ref, dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = spawnSync('git', ['-C', WORKTREE, 'archive', ref, 'apps/invoicing', 'docs/design/tokens', '.dockerignore'], { maxBuffer: 64 * 1024 * 1024 });
  if (tar.status !== 0) throw new Error(`git archive ${ref} failed: ${tar.stderr}`);
  const un = spawnSync('tar', ['-x', '-C', dir], { input: tar.stdout });
  if (un.status !== 0) throw new Error(`tar failed: ${un.stderr}`);
}

/** Replace exactly once; refuse if the anchor is absent or ambiguous. */
function replaceOnce(path, from, to) {
  const text = readFileSync(path, 'utf8');
  const n = count(text, from);
  if (n !== 1) throw new Error(`anchor occurs ${n} times in ${path}, expected exactly 1: ${from.slice(0, 80)}`);
  writeFileSync(path, text.replace(from, to));
}

const RECIPES = {
  F7: {
    ref: 'HEAD',
    what: "the money row fires on the VIEW MODEL's lede (plan §7 F7, re-targeted: the copy lives in connect-view.js, not the template)",
    mutate: (app) => replaceOnce(join(app, 'lib/screens/connect-view.js'), "your clients' funds — Stripe", "your clients' money — Stripe"),
    applied: { file: 'lib/screens/connect-view.js', needle: 'money', before: 0, after: 1, ci: true },
    predicted: ['the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43, AS-44 and AS-45 put them'],
  },
  'F7-t': {
    ref: 'HEAD',
    what: 'the money row fires on the TEMPLATE too (raw text, a comment)',
    mutate: (app) => replaceOnce(join(app, 'views/connect-stripe.ejs'), 'Reduced chrome: no nav.', 'Reduced chrome: no nav, no money.'),
    applied: { file: 'views/connect-stripe.ejs', needle: 'money', before: 0, after: 1, ci: true },
    predicted: ['the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43, AS-44 and AS-45 put them'],
  },
  F11: {
    ref: 'HEAD',
    what: "the state table is not decorative: delete the banner.tone === 'warning' block from the template",
    mutate: (app) => replaceOnce(
      join(app, 'views/connect-stripe.ejs'),
      "        <% if (banner.tone === 'warning') { %>\n          <div class=\"banner banner-warning\">\n            <p><%= banner.message %></p>\n          </div>\n        <% } %>\n",
      '',
    ),
    applied: { file: 'views/connect-stripe.ejs', needle: 'banner-warning', before: 1, after: 0 },
    predicted: [
      'S2-RETURN-NOTREADY renders when charges are disabled',
      'S2-RETURN-NOTREADY renders when charges are enabled but requirements are still due',
      "screen 2's nine ledger rows partition 4 + 2 + 1 + 1 + 1",
      'the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43, AS-44 and AS-45 put them',
    ],
  },
  'F11-b': {
    ref: 'HEAD',
    what: "the two transcriptions are compared: S2-REFRESH's disposition -> 'rendered' in the view model",
    mutate: (app) => replaceOnce(
      join(app, 'lib/screens/connect-view.js'),
      "Object.freeze({ id: 'S2-REFRESH', disposition: 'redirect-answered' })",
      "Object.freeze({ id: 'S2-REFRESH', disposition: 'rendered' })",
    ),
    applied: { file: 'lib/screens/connect-view.js', needle: "id: 'S2-REFRESH', disposition: 'rendered'", before: 0, after: 1 },
    // Plan predicted 3. PREDICTED HERE, BEFORE RUNNING: 5 — cases 7 and 13 also
    // compare the set of observed states to CONNECT_STATES, which grows to 5.
    predicted: [
      'screen 2 accounts for all nine of its ledger rows, and exactly four of them render',
      "screen 2's nine ledger rows partition 4 + 2 + 1 + 1 + 1",
      'S2-REFRESH and S2-LOADING never render this screen',
      'the Connect screen makes no Stripe call, writes nothing, and never renders the account id',
      'S2-EMPTY renders no section: the screen has no collection, and shows none',
    ],
  },
  F18: {
    ref: 'HEAD',
    what: "the landing is followed to its terminus: routes/pages.js -> '/nope'",
    mutate: (app) => replaceOnce(join(app, 'routes/pages.js'), "res.redirect(303, '/connect-stripe');", "res.redirect(303, '/nope');"),
    applied: { file: 'routes/pages.js', needle: "'/nope'", before: 0, after: 1 },
    predicted: [
      'GET / redirects a signed-in caller to the Connect screen, and renders nothing itself',
      'a signed-in GET /signin lands on a page that exists',
      'a successful sign-up with no next lands on a page that exists',
      'a successful sign-in with no next lands on a page that exists',
      'H11: a garbage cookie is refused exactly like an absent one',
      'GET / answers a signed-in caller rather than 404ing',
    ],
  },
  F19: {
    ref: 'HEAD',
    what: 'the screen calls Stripe: handleRefresh before the render, swallowed',
    mutate: (app) => replaceOnce(
      join(app, 'routes/connect.js'),
      "  router.get('/connect-stripe', (req, res) => {\n    const account = repos.connectedAccounts.getByFreelancer(actingFreelancerId(req));",
      "  router.get('/connect-stripe', async (req, res) => {\n    try { await onboarding.handleRefresh(actingFreelancerId(req)); } catch {}\n    const account = repos.connectedAccounts.getByFreelancer(actingFreelancerId(req));",
    ),
    applied: { file: 'routes/connect.js', needle: 'handleRefresh(', before: 1, after: 2 },
    predicted: ['the Connect screen makes no Stripe call, writes nothing, and never renders the account id'],
  },
  F20: {
    ref: 'HEAD',
    what: 'the flag is a boolean: === true -> Boolean(...) in the view model (route intact)',
    mutate: (app) => replaceOnce(join(app, 'lib/screens/connect-view.js'), 'const startFailed = input.startFailed === true;', 'const startFailed = Boolean(input.startFailed);'),
    applied: { file: 'lib/screens/connect-view.js', needle: 'Boolean(input.startFailed)', before: 0, after: 1 },
    predicted: ['the Connect view model is a total function of the row and the error flag, and the flag is a boolean'],
  },
  F21: {
    ref: 'HEAD',
    what: "the committed file count catches under-examination: P2b's only -> /^views\\// with expectFiles left at 3",
    mutate: (app) => replaceOnce(
      join(app, 'test/dependency-policy.test.js'),
      "scanConcept('event-handler attribute', /\\son[a-z]+\\s*=/i, [], { only: /^(views|public)\\//, expectFiles: 3 });",
      "scanConcept('event-handler attribute', /\\son[a-z]+\\s*=/i, [], { only: /^views\\//, expectFiles: 3 });",
    ),
    applied: { file: 'test/dependency-policy.test.js', needle: '/^(views|public)\\//', before: 4, after: 3 },
    predicted: ['the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43, AS-44 and AS-45 put them'],
  },
  'F21-master': {
    ref: 'master',
    what: "direction two: the same narrowing on master's `> 0` floor stays GREEN (the recipe measures the fix, not the guard's existence)",
    mutate: (app) => replaceOnce(
      join(app, 'test/dependency-policy.test.js'),
      "scanConcept('event-handler attribute', /\\son[a-z]+\\s*=/i, [], { only: /^(views|public)\\// });",
      "scanConcept('event-handler attribute', /\\son[a-z]+\\s*=/i, [], { only: /^views\\// });",
    ),
    applied: { file: 'test/dependency-policy.test.js', needle: '/^(views|public)\\//', before: 4, after: 3 },
    predicted: [],
  },
  F22: {
    ref: 'HEAD',
    what: 'the view model re-derives ready from the inputs',
    mutate: (app) => replaceOnce(
      join(app, 'lib/screens/connect-view.js'),
      "return account.ready === true ? 'S2-RETURN-READY' : 'S2-RETURN-NOTREADY';",
      "return account.chargesEnabled === true && account.requirementsCurrentlyDue.length === 0 ? 'S2-RETURN-READY' : 'S2-RETURN-NOTREADY';",
    ),
    applied: { file: 'lib/screens/connect-view.js', needle: 'requirementsCurrentlyDue.length', before: 0, after: 1 },
    // Plan predicted 1. PREDICTED HERE, BEFORE RUNNING: 2 — case 3's table rows
    // are bare { ready: true } / { ready: false } objects with no inputs to
    // re-derive from, so the re-derivation renders NOTREADY for { ready: true }.
    predicted: [
      'S2-RETURN-READY renders for a ready row, and the screen reads ready rather than re-deriving it',
      'the Connect view model is a total function of the row and the error flag, and the flag is a boolean',
    ],
  },
  F23: {
    ref: 'HEAD',
    what: 'a dangling control on READY: plant the Dashboard anchor in the success branch',
    mutate: (app) => replaceOnce(
      join(app, 'views/connect-stripe.ejs'),
      "          <div class=\"banner banner-success\">\n            <p><%= banner.message %></p>\n          </div>\n",
      "          <div class=\"banner banner-success\">\n            <p><%= banner.message %></p>\n          </div>\n          <a href=\"/\">Continue to Dashboard</a>\n",
    ),
    // The needle is the planted ELEMENT, not the phrase: the template's header
    // comment already says "Continue to Dashboard" once (explaining why READY
    // has no control), so the phrase alone cannot tell the comment from the anchor.
    applied: { file: 'views/connect-stripe.ejs', needle: '<a href="/">Continue to Dashboard</a>', before: 0, after: 1 },
    predicted: [
      'S2-RETURN-READY renders for a ready row, and the screen reads ready rather than re-deriving it',
      'the concepts live exactly where AS-38, AS-39, AS-40, AS-41, AS-42, AS-43, AS-44 and AS-45 put them',
    ],
  },
};

function run(name) {
  const recipe = RECIPES[name];
  if (!recipe) throw new Error(`no recipe ${name}`);
  const dir = join(SCRATCH, name);
  const app = join(dir, 'apps/invoicing');
  const project = `asc-as70-${name.toLowerCase()}`;
  const compose = ['compose', '-p', project, '-f', join(app, 'compose.yaml')];
  const log = [];
  const say = (s) => { log.push(s); console.log(s); };

  say(`=== ${name}: ${recipe.what}`);
  extract(recipe.ref, dir);
  const target = join(app, recipe.applied.file);
  const before = recipe.applied.ci ? countRe(readFileSync(target, 'utf8'), new RegExp(recipe.applied.needle, 'gi')) : count(readFileSync(target, 'utf8'), recipe.applied.needle);
  say(`baseline on disk: ${recipe.applied.needle} x${before} in ${recipe.applied.file} (expected ${recipe.applied.before})`);
  if (before !== recipe.applied.before) throw new Error(`${name}: baseline ${before} != ${recipe.applied.before}`);

  recipe.mutate(app);
  const after = recipe.applied.ci ? countRe(readFileSync(target, 'utf8'), new RegExp(recipe.applied.needle, 'gi')) : count(readFileSync(target, 'utf8'), recipe.applied.needle);
  say(`applied on disk: x${after} (expected ${recipe.applied.after})`);
  if (after !== recipe.applied.after) throw new Error(`${name}: mutation not applied as intended (${after})`);
  // The diff of the mutated file, so a survivor can be read against what actually changed.
  const diff = sh('git', ['-C', WORKTREE, 'diff', '--no-index', '--', join(WORKTREE, 'apps/invoicing', recipe.applied.file), target]);
  log.push('--- mutated diff ---\n' + diff.out);

  // Assert applied IN THE IMAGE (build here, --build again on the counted run).
  const grepFlag = recipe.applied.ci ? '-oiF' : '-oF';
  const inImage = sh(DOCKER, [...compose, 'run', '--build', '--rm', 'test', 'sh', '-c', `grep ${grepFlag} "${recipe.applied.needle.replace(/"/g, '\\"')}" /app/${recipe.applied.file} | wc -l`]);
  const imageCount = Number((inImage.out.match(/^\s*(\d+)\s*$/m) ?? [])[1]);
  say(`applied in image: x${imageCount} (expected ${recipe.applied.after}); built: ${/Built/.test(inImage.out)}`);
  if (imageCount !== recipe.applied.after) throw new Error(`${name}: in-image count ${imageCount} != ${recipe.applied.after}\n${inImage.out}`);

  const suite = sh(DOCKER, [...compose, 'run', '--build', '--rm', 'test']);
  const builtLine = suite.out.split('\n').find((l) => /Image .*Built/.test(l)) ?? 'NO BUILT LINE';
  const summary = suite.out.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped)/.test(l)).join(' ');
  // The spec reporter prints each red once inline and again under a trailing
  // "failing tests:" header — dedupe, and drop the header line itself.
  const failed = [...new Set(
    suite.out.split('\n').filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, '')),
  )].filter((t) => t !== 'failing tests:');
  say(`receipt: ${builtLine.trim()} | exit ${suite.status} | ${summary}`);
  say(`observed failing set (${failed.length}):\n  ${failed.join('\n  ')}`);
  const predicted = [...recipe.predicted].sort();
  const observed = [...failed].sort();
  const match = JSON.stringify(predicted) === JSON.stringify(observed);
  say(`predicted (${predicted.length}) ${match ? 'MATCHES' : 'DIFFERS FROM'} observed (${observed.length})`);
  if (!match) {
    say(`  predicted-only: ${predicted.filter((t) => !observed.includes(t)).join(' | ') || '(none)'}`);
    say(`  observed-only:  ${observed.filter((t) => !predicted.includes(t)).join(' | ') || '(none)'}`);
  }
  log.push('--- suite output ---\n' + suite.out);

  const down = sh(DOCKER, [...compose, 'down', '--rmi', 'local']);
  say(`teardown exit ${down.status}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.log`), log.join('\n'));
  return { name, match, predicted, observed, builtLine, summary };
}

const results = process.argv.slice(2).map(run);
console.log('\n=== SUMMARY ===');
for (const r of results) console.log(`${r.name}: ${r.match ? 'as predicted' : 'DIVERGENT'} — ${r.observed.length} red — ${r.builtLine.trim()} — ${r.summary}`);
