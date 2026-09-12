// mutants.mjs — AS-46 plan §8 recipes, each on a FRESH scratch copy of the
// worktree (never the worktree itself). For every mutant: assert the pattern
// count before, apply, assert the count after (occurrence-accurate, anchored),
// run the suite with --build in an isolated compose project, record the exact
// failing set, tear down. usage: node mutants.mjs [name ...]
import { readFileSync, writeFileSync, appendFileSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-46';
const SCRATCH = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-46/mut';
const APP = join(SCRATCH, 'apps/invoicing');
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/developer-lena/AS-46/mutants.log';
const DOCKER = '/usr/local/bin/docker';

const count = (text, needle) => text.split(needle).length - 1;

function freshTree() {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(join(SCRATCH, 'docs/design'), { recursive: true });
  cpSync(join(WT, 'apps'), join(SCRATCH, 'apps'), { recursive: true });
  cpSync(join(WT, 'docs/design/tokens'), join(SCRATCH, 'docs/design/tokens'), { recursive: true });
  cpSync(join(WT, '.dockerignore'), join(SCRATCH, '.dockerignore'));
}

/** Replace `from` with `to` in `file`; `from` must occur exactly `expect` times. */
function replaceExact(file, from, to, expect) {
  const path = join(APP, file);
  const before = readFileSync(path, 'utf8');
  const n = count(before, from);
  if (n !== expect) throw new Error(`${file}: expected ${expect} occurrence(s) of the anchor, found ${n}`);
  const after = before.split(from).join(to);
  writeFileSync(path, after);
  const remaining = count(readFileSync(path, 'utf8'), from);
  const planted = to === '' ? null : count(readFileSync(path, 'utf8'), to);
  return `applied: '${from.slice(0, 60)}' ${n} -> ${remaining}${planted === null ? '' : `; '${to.slice(0, 40)}' now ${planted}`}`;
}

function runSuite(name, env = {}) {
  const project = `asc-inv-as46-mut-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const composeFile = join(APP, 'compose.yaml');
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const res = spawnSync(DOCKER, ['compose', '-p', project, '-f', composeFile, 'run', '--build', '--rm', ...envArgs, 'test'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  spawnSync(DOCKER, ['compose', '-p', project, '-f', composeFile, 'down', '--rmi', 'local', '--remove-orphans'], { encoding: 'utf8' });
  const built = /Image \S+ Built/.test(out);
  const lines = out.split('\n');
  const summary = lines.filter((l) => /^ℹ (tests|pass|fail|skipped)/.test(l)).map((l) => l.replace('ℹ ', '')).join(' ');
  // failing titles: the "failing tests" tail lists each once
  const tailAt = lines.findIndex((l) => /^✖ failing tests:/.test(l));
  const failing = (tailAt === -1 ? [] : lines.slice(tailAt + 1)).filter((l) => /^✖ /.test(l)).map((l) => l.replace(/^✖ /, '').replace(/ \([0-9.]+ms\)$/, ''));
  // first assertion message per failing test
  const messages = [];
  if (tailAt !== -1) {
    for (let i = tailAt + 1; i < lines.length; i += 1) {
      if (/^✖ /.test(lines[i])) {
        const msg = lines.slice(i + 1, i + 4).map((l) => l.trim()).filter(Boolean)[0] ?? '';
        messages.push(msg.slice(0, 160));
      }
    }
  }
  return { exit: res.status, built, summary, failing, messages };
}

const T = (s) => s; // title helper for readability

const MUTANTS = {
  F1: {
    predicted: 'case 6 and case 4 (plan); observed set recorded',
    apply: () => replaceExact('views/invoice-form.ejs', 'name="lineItems[<%= row.index %>][unitPrice]" value="<%= row.unitPrice %>"', 'name="lineItems[<%= row.index %>][unitPrice]"', 2),
  },
  F2: {
    predicted: 'case 18 + the dependency-policy concept-row case; exactly two',
    apply: () => replaceExact('views/invoice-form.ejs', 'value="<%= row.description %>"', 'value="<%- row.description %>"', 2),
  },
  'F3a': {
    predicted: 'the concept-row case only, naming views/invoice-form.ejs',
    apply: () => replaceExact('views/invoice-form.ejs', '    <link rel="stylesheet" href="/app.css" />\n', '    <link rel="stylesheet" href="/app.css" />\n    <%# amount %>\n', 1),
  },
  'F3a-neg': {
    predicted: 'GREEN except the standing seam red (case 25) — the view model is a member',
    apply: () => replaceExact('lib/screens/invoice-form-view.js', "import { DEFAULT_CURRENCY, formatMinorUnits, parseMajorUnits } from '../db/money.js';\n", "import { DEFAULT_CURRENCY, formatMinorUnits, parseMajorUnits } from '../db/money.js';\n// amount\n", 1),
  },
  'F3b': {
    predicted: 'the concept-row case, naming lib/screens/invoice-form-view.js as unexpected',
    apply: () => replaceExact('test/dependency-policy.test.js', "      'lib/screens/invoice-form-view.js',\n      'lib/stripe/custody.js',", "      'lib/stripe/custody.js',", 1),
  },
  'F3b-stale': {
    predicted: 'the concept-row case red as STALE: an allowlisted file (lib/views.js) with zero hits',
    apply: () => replaceExact('test/dependency-policy.test.js', "      'lib/screens/invoice-form-view.js',\n      'lib/stripe/custody.js',", "      'lib/screens/invoice-form-view.js',\n      'lib/stripe/custody.js',\n      'lib/views.js',", 1),
  },
  F4: {
    predicted: 'case 8 only',
    apply: () => replaceExact('routes/invoices.js', "return res.redirect(303, `${editPath(invoice.id)}?error=send`);", 'return res.redirect(303, editPath(invoice.id));', 1),
  },
  'F5-null': {
    predicted: 'case 13 (null half) and case 2 (reaches GATED via null)',
    apply: () => replaceExact('lib/screens/invoice-form-view.js', "  if (account === null || account.ready === false) state = 'S4-GATED-STRIPENOTREADY';", "  if (account !== null && account.ready === false) state = 'S4-GATED-STRIPENOTREADY'; // MUTANT-F5", 1),
  },
  'F5-ready': {
    predicted: 'case 13 (two not-ready halves; null stays green within it), case 14, case 2 precedence',
    apply: () => replaceExact('lib/screens/invoice-form-view.js', "  if (account === null || account.ready === false) state = 'S4-GATED-STRIPENOTREADY';", "  if (account === null) state = 'S4-GATED-STRIPENOTREADY'; // MUTANT-F5", 1),
  },
  F6: {
    predicted: 'case 24 only (the max-safe vector); case 19 stays green',
    apply: () => replaceExact('lib/db/money.js', "  const whole = Number(wholeDigits);\n  const cents = Number(fraction.padEnd(MINOR_DIGITS, '0'));\n  const minor = whole * MINOR_PER_MAJOR + cents;", "  const minor = Math.round(Number(text) * MINOR_PER_MAJOR); // MUTANT-F6 wholeDigits/fraction unused\n  void wholeDigits; void fraction;", 1),
  },
  F7: {
    predicted: 'case 24 on the cardinality assertion (27), before any vector runs',
    apply: () => replaceExact('test/invoice-screen.test.js', "  ['12.', null],\n", '', 1),
  },
  F8: {
    predicted: 'case 25 (message names connect-strip) and case 13 (href count 1 -> 0)',
    apply: () => replaceExact('views/invoice-form.ejs', 'href="/connect-stripe"', 'href="/connect-strip"', 1),
  },
  F9: {
    predicted: 'case 26 in the set, plus every case that POSTs /invoices/new; full set recorded',
    apply: () => {
      const path = join(APP, 'routes/invoices.js');
      let s = readFileSync(path, 'utf8');
      const start = s.indexOf('  // ─── SCREEN 4 (AS-46');
      const end = s.indexOf('  // ─── THE API (AS-43) — unchanged');
      if (start === -1 || end === -1 || end < start) throw new Error('F9 anchors');
      const block = s.slice(start, end);
      s = s.slice(0, start) + s.slice(end);
      const after = "    return editPath(invoice.id);\n  }));\n\n  // The readiness gate, then the pipeline through step 4.";
      if (count(s, after) !== 1) throw new Error('F9 insertion anchor');
      s = s.replace(after, `    return editPath(invoice.id);\n  }));\n\n${block}  // The readiness gate, then the pipeline through step 4.`);
      writeFileSync(path, s);
      const lines = readFileSync(path, 'utf8').split('\n');
      const at = (needle) => lines.findIndex((l) => l.includes(needle)) + 1;
      return `applied: screen block now at line ${at("router.get('/invoices/new'")}, POST /invoices/:id at line ${at("router.post('/invoices/:id', form")}`;
    },
  },
  F10: {
    predicted: 'case 22 (three sub-assertions) and case 2 (unknown-intent loop)',
    apply: () => replaceExact('lib/screens/invoice-form-view.js', "const intent = typeof form.intent === 'string' && INTENTS.includes(form.intent) ? form.intent : null;", "const intent = typeof form.intent === 'string' && INTENTS.includes(form.intent) ? form.intent : 'save'; // MUTANT-F10", 1),
  },
  F11: {
    predicted: 'cases 10, 11 and the partition case (plan); observed set recorded',
    apply: () => {
      const path = join(APP, 'views/invoice-form.ejs');
      const s = readFileSync(path, 'utf8');
      const start = s.indexOf('            <% if (duplicate !== null) { %>');
      const elseAt = s.indexOf('            <% } else { %>\n              <div class="form-actions">\n                <button type="submit" name="intent" value="add-client"');
      if (start === -1 || elseAt === -1) throw new Error('F11 anchors');
      const removed = s.slice(start, elseAt);
      const out = `${s.slice(0, start)}            <% if (false) { %>\n${s.slice(elseAt)}`;
      writeFileSync(path, out);
      return `applied: removed ${removed.split('\n').length} lines of the duplicate branch; 'name="duplicateId"' now ${count(out, 'name="duplicateId"')} (was ${count(s, 'name="duplicateId"')})`;
    },
  },
  // --- rebase/recount battery (tick 5) ---
  R5: {
    predicted: "the new state-id case only, naming invoice-form.ejs 2 !== 1; identical markup so every other case green",
    apply: () => replaceExact("views/invoice-form.ejs", "<% if (gated) { %>", "<% if (state === 'S4-GATED-STRIPENOTREADY') { %>", 1),
  },
  "R-route": {
    predicted: "G1 and G1b (deepEqual against a 21-entry list; found count still 22); G2/G3 green because they derive from found",
    apply: () => replaceExact("test/route-surface.test.js", "const ALL_ROUTES = [\n  'GET /',\n  'GET /connect-stripe',\n", "const ALL_ROUTES = [\n  'GET /',\n", 1),
  },
  "R-tags": {
    predicted: "the dependency-policy P-case on the VIEW_START_TAGS floor (332 -> 330) only: the deleted line is copy with no data",
    apply: () => replaceExact("views/invoice-form.ejs", "              <p>No clients yet — add one below.</p>\n", "", 1),
  },
};

const selected = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MUTANTS);
appendFileSync(LOG, `\n=== battery ${new Date().toISOString()} — ${selected.join(', ')} ===\n`);
for (const name of selected.filter((n) => n !== 'F12')) {
  const mutant = MUTANTS[name];
  if (mutant === undefined) throw new Error(`unknown mutant ${name}`);
  freshTree();
  let applied;
  try {
    applied = mutant.apply();
  } catch (err) {
    appendFileSync(LOG, `${name}: NOT APPLIED — ${err.message}\n`);
    continue;
  }
  const r = runSuite(name);
  const record = [
    `--- ${name}`,
    `  ${applied}`,
    `  predicted: ${mutant.predicted}`,
    `  built: ${r.built} exit: ${r.exit} ${r.summary}`,
    ...r.failing.map((t, i) => `  RED: ${t}\n       ${r.messages[i] ?? ''}`),
  ].join('\n');
  appendFileSync(LOG, `${record}\n`);
  console.log(record);
}
// F12: the vacuity floor, on the UNMUTATED tree.
if (selected.includes('F12') || process.argv.slice(2).length === 0) {
  freshTree();
  const r = runSuite('F12', { ASC_SELFTEST_MUTATE: '1' });
  const record = `--- F12\n  ASC_SELFTEST_MUTATE=1 on the unmutated tree\n  built: ${r.built} exit: ${r.exit} ${r.summary}\n${r.failing.map((t) => `  RED: ${t}`).join('\n')}`;
  appendFileSync(LOG, `${record}\n`);
  console.log(record);
}
rmSync(SCRATCH, { recursive: true, force: true });
