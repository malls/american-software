// test/contracts.test.js — chain link 3's server half: contract templates and
// generation (AS-42, plan §5.5).
//
// EVERYTHING HERE RUNS OFFLINE AND NEEDS NOTHING EXTERNAL. This is the only
// server suite in the app for which that is true by NATURE rather than by
// mocking: there is no fixture transport, no mock service, no key, and no
// self-skipping group. It passes in the `test` service at network_mode: none
// because nothing on this path ever wanted a network.
//
// FIVE GROUPS. T is the registry (the declaration and its load-time
// invariants), B is the rendered document (the golden output and the escaping
// properties), N is the generation service, P is the HTTP surface, and Y is the
// two boundary claims the plan makes about what this path does NOT depend on.
//
// CARDINALITY BEFORE QUANTIFICATION, everywhere. Every case that iterates the
// registry, the variable list, the body or the output's attributes asserts a
// committed COUNT first — a walk that silently returned nothing would otherwise
// pass every rule below it on an empty set.
import test from 'node:test';
import assert from 'node:assert/strict';
// node:crypto for the declaration digest. test/ is outside the dependency
// scan's world (SKIPPED_DIRS), so this import moves no committed literal, and
// the PRODUCT hashes nothing at runtime.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { openDatabase } from '../lib/db/connection.js';
import { NotFoundError, ValidationError, createRepositories, prepareDatabase } from '../lib/db/database.js';
import {
  DEFAULT_TEMPLATE_ID,
  INDEPENDENT_CONTRACTOR_AGREEMENT_V1,
  TEMPLATES,
  assertTemplate,
  getTemplate,
} from '../lib/contracts/templates.js';
import { escapeHtml, renderContract } from '../lib/contracts/render.js';
import { createContractGeneration } from '../lib/contracts/generation.js';
import { contractRoutes } from '../routes/contracts.js';
import { APP_DIR, configFor, freshDbPath, seedSignedIn, signedInHeaders, withServer } from './helpers/server.js';

const TEMPLATE_ID = 'independent-contractor-agreement@1';

/** THE COMMITTED DIGEST of the shipped declaration. This is what keeps the
 *  version honest: an id that carries a version is only useful if the version
 *  moves when the content does. Change a word of the body, a label, or the
 *  attribution without bumping `@1` and this goes red — which is exactly the
 *  M4 obligation, made mechanical. Recompute it ONLY together with a new id. */
const DECLARATION_DIGEST = '6504d5915a0fcccf2646679fa3dd092857f4de4b486438855932cdede630ddee';

/** The golden fixture's values. `projectDescription` carries an `&` and a `<`
 *  deliberately: it makes B1 a live witness for escaping, so a mutation that
 *  drops the escaper turns TWO cases red rather than one. */
const GOLDEN_VALUES = Object.freeze({
  freelancerName: 'Freda Lancer',
  clientName: 'Client Co',
  projectDescription: 'Website redesign — phase 1: homepage & <nav>.',
  startDate: '2026-09-08',
});

/** THE GOLDEN OUTPUT, byte for byte. One element per line, joined with \n, no
 *  trailing newline, no indentation — indentation inside a <p> would be a
 *  whitespace difference in the document's own text. */
const GOLDEN_HTML = [
  '<article class="contract-doc">',
  '<section class="contract-doc__notice">',
  '<p class="contract-doc__notice-title">Placeholder contract text — not legal advice</p>',
  '<p>This document&#39;s body is placeholder text. It is not legal advice and should not be relied upon until this notice is removed.</p>',
  '<p>Pending a lawyer-agent review of the adapted source template. This warning is part of the document itself and survives print and download.</p>',
  '</section>',
  '<h1 class="contract-doc__title">Independent Contractor Agreement (placeholder)</h1>',
  '<section class="contract-doc__body">',
  '<p>This agreement is between <strong>Freda Lancer</strong> (&quot;Provider&quot;) and <strong>Client Co</strong> (&quot;Client&quot;), effective <strong>September 8, 2026</strong>.</p>',
  '<p><strong>[PLACEHOLDER — scope of work]: </strong><span class="contract-doc__multiline">Website redesign — phase 1: homepage &amp; &lt;nav&gt;.</span></p>',
  '<p><strong>[PLACEHOLDER — payment terms]: </strong>Placeholder text pending legal review. Do not rely on this section.</p>',
  '<p><strong>[PLACEHOLDER — standard terms]: </strong>Placeholder text pending legal review. Do not rely on this section.</p>',
  '</section>',
  '<p class="contract-doc__attribution">Attribution: this body is placeholder text and is not adapted from any third-party source. When adapted template text (Common Paper, CC BY 4.0) replaces it, that attribution appears here.</p>',
  '</article>',
].join('\n');

/** THE FROZEN CLASS-NAME CONTRACT. A contract issued today carries these names
 *  forever; they may be added to, never renamed, or every already-issued
 *  document loses its styling. */
const CLASS_VALUES = [
  'contract-doc',
  'contract-doc__attribution',
  'contract-doc__body',
  'contract-doc__multiline',
  'contract-doc__notice',
  'contract-doc__notice-title',
  'contract-doc__title',
];

/** A minimal VALID declaration, built fresh per call so a case can deform one
 *  field without leaking into the next. Its own validity is asserted in T4 —
 *  cardinality on the instrument before quantifying with it, because a fixture
 *  that was already invalid would make every "is refused" case vacuous. */
function fixture(overrides = {}) {
  return {
    id: 'fixture-agreement@1',
    title: 'Fixture Agreement',
    sourceTemplate: null,
    attribution: 'Attribution: fixture text, adapted from nothing.',
    notice: { title: 'Fixture notice', paragraphs: ['Fixture warning paragraph.'] },
    variables: [{ name: 'who', source: 'form', type: 'text', label: 'Who', required: true }],
    body: [[{ text: 'Hello ' }, { slot: 'who' }, { text: '.' }]],
    ...overrides,
  };
}

/** Every attribute in a rendered document, as `name="value"` pairs. Nothing
 *  user-supplied can produce one of these: `"` is escaped to &quot;, so a value
 *  cannot close a quoted attribute — which is what B5 proves structurally. */
const attributesOf = (html) => html.match(/[a-zA-Z-]+="[^"]*"/g) ?? [];

/** A migrated database and repositories, closed after `fn` — AWAITED, because a
 *  synchronous finally would close the handle out from under an async body. */
async function withRepos(fn) {
  const { db } = prepareDatabase({ dbPath: freshDbPath() });
  try {
    return await fn(createRepositories(db), db);
  } finally {
    db.close();
  }
}

/** Repositories plus a freelancer, one of their clients, and the generation
 *  service under test. */
async function withGeneration(fn) {
  return withRepos(async (repos) => {
    const freelancer = repos.freelancers.create({ email: 'f@example.test', displayName: 'Freda Lancer' });
    const client = repos.clients.create(freelancer.id, { name: 'Client Co', email: 'client@example.test' });
    return fn({ repos, freelancer, client, generation: createContractGeneration({ repos }) });
  });
}

const FORM_INPUT = () => ({
  projectDescription: GOLDEN_VALUES.projectDescription,
  startDate: GOLDEN_VALUES.startDate,
});

/** Row counts read on a SECOND connection to the same file — the db.test.js
 *  idiom. The repositories expose no count method (app code has no use for
 *  one), and a count is exactly what "creates nothing" needs. */
function countContracts(config) {
  const db = openDatabase(config.dbPath);
  try {
    return db.prepare('SELECT count(*) AS n FROM contracts').get().n;
  } finally {
    db.close();
  }
}

/** THE SEEDED FREELANCER'S SESSION. POST /contracts sits below the auth
 *  boundary and no case here is about signing in, so the helper seeds a session
 *  ROW (no KDF) and every request carries its cookie and an Origin the
 *  same-origin check accepts. */
const auth = { headers: {} };

async function withContractApp(fn) {
  const config = configFor();
  await withServer(config, async (base, app, deps) => {
    const { repos } = deps;
    const { freelancer, cookie } = seedSignedIn(repos, { email: 'f@example.test', displayName: 'Freda Lancer' });
    const client = repos.clients.create(freelancer.id, { name: 'Client Co', email: 'client@example.test' });
    auth.headers = signedInHeaders(base, cookie);
    await fn({ base, app, config, repos, freelancer, client });
  });
}

const postForm = (url, fields) =>
  fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...auth.headers },
    body: typeof fields === 'string' ? fields : new URLSearchParams(fields).toString(),
  });

/** The built app's routes, by walking the router tree — the auth.test.js walk,
 *  narrowed to this task's surface. */
function discoverRoutes(app) {
  const found = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) found.push(`${method.toUpperCase()} ${layer.route.path}`);
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(app.router.stack);
  return found.sort();
}

// =============================================================================
// T — the registry
// =============================================================================

test('T1: the registry holds exactly one template, and its id carries the version', () => {
  assert.equal(TEMPLATES.size, 1, 'cardinality before quantification — one template closes the chain, a second does not');
  assert.deepEqual([...TEMPLATES.keys()], [TEMPLATE_ID]);
  assert.equal(DEFAULT_TEMPLATE_ID, TEMPLATE_ID);
  assert.match(DEFAULT_TEMPLATE_ID, /^[a-z][a-z0-9-]*@\d+$/, 'the VERSION rides in the id — that is what makes an issued contract reproducible');
  assert.equal(getTemplate(DEFAULT_TEMPLATE_ID), INDEPENDENT_CONTRACTOR_AGREEMENT_V1);
  const names = INDEPENDENT_CONTRACTOR_AGREEMENT_V1.variables.map((v) => v.name);
  assert.equal(names.length, 4, 'cardinality before quantification');
  assert.deepEqual(names, ['freelancerName', 'clientName', 'projectDescription', 'startDate']);
  assert.ok(Object.isFrozen(INDEPENDENT_CONTRACTOR_AGREEMENT_V1.body), 'the declaration is deep-frozen, so no caller can edit the shipped text');
});

test('T2: every declared variable is referenced by the body, and every body slot is declared', () => {
  const declaration = INDEPENDENT_CONTRACTOR_AGREEMENT_V1;
  const declared = declaration.variables.map((v) => v.name).sort();
  const segments = declaration.body.flat();
  const slots = [...new Set(segments.filter((s) => s.slot !== undefined).map((s) => s.slot))].sort();
  assert.equal(declared.length, 4, 'cardinality before quantification');
  assert.equal(segments.length, 13, 'cardinality of the body walk before quantification');
  assert.equal(slots.length, 4);
  assert.deepEqual(slots, declared);
  // And BOTH directions are a module-load assertion, not a review obligation.
  // A slot with no declaration is a render-time crash…
  assert.throws(
    () => assertTemplate(fixture({ body: [[{ slot: 'undeclared' }]] })),
    /body names slot undeclared, which is not declared/,
  );
  // …and a declared-but-unreferenced variable is a form field that goes nowhere.
  assert.throws(
    () => assertTemplate(fixture({
      variables: [
        { name: 'who', source: 'form', type: 'text', label: 'Who', required: true },
        { name: 'orphan', source: 'form', type: 'text', label: 'Orphan', required: true },
      ],
    })),
    /variable orphan is declared but never referenced/,
  );
});

test('T3: the shipped declaration matches its committed digest', () => {
  // The guard THIS task introduces, in its own direction: content may not move
  // without the version moving with it. The digest is over the whole frozen
  // declaration, so a changed label or attribution counts as much as body text.
  const digest = createHash('sha256').update(JSON.stringify(INDEPENDENT_CONTRACTOR_AGREEMENT_V1)).digest('hex');
  assert.equal(
    digest,
    DECLARATION_DIGEST,
    'the declaration changed without its id being bumped — a new body is a NEW template (…@2), never an edit to @1, '
      + 'or every already-issued contract stops reproducing',
  );
  assert.equal(INDEPENDENT_CONTRACTOR_AGREEMENT_V1.id, TEMPLATE_ID);
});

test('T4: a template declaring a source whose attribution omits the licence is refused', () => {
  // CARDINALITY ON THE INSTRUMENT FIRST: an already-invalid fixture would make
  // every "is refused" case below vacuous.
  assert.equal(assertTemplate(fixture()).id, 'fixture-agreement@1', 'the fixture itself is a VALID declaration');
  const source = { name: 'Common Paper', licence: 'CC BY 4.0', url: 'https://commonpaper.test/' };
  // Deficient: a source IS declared, and the attribution never names its licence.
  assert.throws(
    () => assertTemplate(fixture({ sourceTemplate: source, attribution: 'Attribution: adapted from a template by Common Paper.' })),
    /attribution does not name the declared licence "CC BY 4\.0"/,
  );
  // Sufficient: the same source, credited. This is what M4 must produce.
  assert.equal(
    assertTemplate(fixture({
      sourceTemplate: source,
      attribution: 'Adapted from a template by Common Paper, licensed under CC BY 4.0. Changes have been made.',
    })).id,
    'fixture-agreement@1',
  );
  // And `sourceTemplate` may not be merely omitted: the declaration must SAY
  // whether the body derives from a third party.
  const withoutKey = fixture();
  delete withoutKey.sourceTemplate;
  assert.throws(() => assertTemplate(withoutKey), /sourceTemplate must be declared explicitly/);
  // The shipped one declares no source, and says so.
  assert.equal(INDEPENDENT_CONTRACTOR_AGREEMENT_V1.sourceTemplate, null);
});

test('T5: a template with a blank attribution is refused', () => {
  for (const attribution of ['', '   ', undefined, null, 42]) {
    assert.throws(() => assertTemplate(fixture({ attribution })), /attribution must be a non-empty string/, String(attribution));
  }
  assert.ok(INDEPENDENT_CONTRACTOR_AGREEMENT_V1.attribution.length > 0);
});

test('T6: getTemplate refuses an unknown id with NotFoundError', () => {
  assert.throws(() => getTemplate('independent-contractor-agreement@2'), NotFoundError);
  assert.throws(() => getTemplate('independent-contractor-agreement'), (err) => {
    assert.ok(err instanceof NotFoundError);
    assert.equal(err.entity, 'template');
    return true;
  }, 'the FAMILY name alone is not a template — the version is part of the identity');
  assert.throws(() => getTemplate(undefined), NotFoundError);
});

test('T7: every declared variable carries a known source and type, and required belongs to form-sourced alone', () => {
  const variables = INDEPENDENT_CONTRACTOR_AGREEMENT_V1.variables;
  assert.equal(variables.length, 4, 'cardinality before quantification');
  for (const variable of variables) {
    assert.ok(['record', 'form'].includes(variable.source), `${variable.name}.source`);
    assert.ok(['text', 'multiline', 'date'].includes(variable.type), `${variable.name}.type`);
    assert.equal(typeof variable.label, 'string');
    assert.ok(variable.label.length > 0, `${variable.name}.label`);
    if (variable.source === 'form') assert.equal(typeof variable.required, 'boolean', `${variable.name}.required`);
    else assert.equal(variable.required, undefined, `record-sourced ${variable.name} must not declare required`);
  }
  assert.deepEqual(variables.filter((v) => v.source === 'record').map((v) => v.name), ['freelancerName', 'clientName']);
  assert.deepEqual(variables.filter((v) => v.source === 'form').map((v) => v.name), ['projectDescription', 'startDate']);
  // The validator refuses the three ways this can go wrong.
  const one = (overrides) => fixture({ variables: [{ name: 'who', source: 'form', type: 'text', label: 'Who', required: true, ...overrides }] });
  assert.throws(() => assertTemplate(one({ source: 'database' })), /who\.source must be one of/);
  assert.throws(() => assertTemplate(one({ type: 'html' })), /who\.type must be one of/);
  assert.throws(() => assertTemplate(one({ required: undefined })), /form-sourced who must declare required/);
  assert.throws(
    () => assertTemplate(fixture({ variables: [{ name: 'who', source: 'record', type: 'text', label: 'Who', required: true }] })),
    /record-sourced who must not declare required/,
  );
});

// =============================================================================
// B — the rendered document
// =============================================================================

test('B1: the rendered document is byte-identical to the committed golden output', () => {
  assert.equal(renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, GOLDEN_VALUES), GOLDEN_HTML);
  assert.equal(GOLDEN_HTML.endsWith('\n'), false, 'no trailing newline — the stored document is exact');
  assert.equal(GOLDEN_HTML.split('\n').length, 15, 'cardinality: one element per line');
});

test('B2: every declared variable appears in the output, substituted', () => {
  const html = renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, GOLDEN_VALUES);
  const variables = INDEPENDENT_CONTRACTOR_AGREEMENT_V1.variables;
  assert.equal(variables.length, 4, 'cardinality before quantification');
  const expected = {
    freelancerName: 'Freda Lancer',
    clientName: 'Client Co',
    // The declared type decides the spelling: a date is rendered long-form, and
    // a value carrying markup is rendered escaped.
    projectDescription: 'Website redesign — phase 1: homepage &amp; &lt;nav&gt;.',
    startDate: 'September 8, 2026',
  };
  for (const variable of variables) {
    assert.ok(
      html.includes(expected[variable.name]),
      `${variable.name} was not substituted into the document: expected ${expected[variable.name]}`,
    );
  }
  // And no slot NAME survives into the output — there is no unresolved marker.
  for (const variable of variables) assert.equal(html.includes(`{${variable.name}}`), false);
});

test('B3: a value containing markup is escaped, never emitted as markup', () => {
  const hostile = {
    ...GOLDEN_VALUES,
    freelancerName: '<script>alert(1)</script>',
    clientName: 'x" onload="alert(1)',
    projectDescription: 'A & B <img src=x onerror=alert(1)> \'quoted\'',
  };
  const html = renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, hostile);
  // No element the renderer did not author.
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('&lt;img src=x onerror=alert(1)&gt;'), true, 'the TEXT survives, escaped…');
  assert.equal(/onerror\s*=\s*["']/.test(html), false, '…and never as an attribute');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&#39;quoted&#39;'));
  // No attribute the renderer did not author, either — the property B5 states
  // in general, checked here against a value that is TRYING to create one.
  const attributes = attributesOf(html);
  assert.equal(attributes.length, 7, `a value created an attribute: ${attributes.join(' ')}`);
  assert.equal(html.includes('onload'), true, 'the escaped text still contains the word…');
  assert.equal(/onload\s*=\s*["']/.test(html), false, '…but never as an attribute');
  // The escaper itself, on the five characters it covers.
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml('plain text'), 'plain text');
});

test('B4: template-authored text is escaped by the same path as a value', () => {
  // NOT "user values are escaped" — EVERYTHING is. There is no raw-output path
  // in the renderer, so there is no site an author could reach for.
  const html = renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, GOLDEN_VALUES);
  assert.ok(html.includes('This document&#39;s body is placeholder text'), "the notice's apostrophe is escaped");
  assert.equal(html.includes("document's body"), false);
  assert.ok(html.includes('(&quot;Provider&quot;)'), "the body's own quotes are escaped");
  assert.equal(html.includes('("Provider")'), false);
  // And a declaration whose own text carries markup cannot emit it either.
  const hostile = fixture({ body: [[{ text: '<script>alert(1)</script>' }, { slot: 'who' }]] });
  const out = renderContract(assertTemplate(hostile), { who: 'ok' });
  assert.ok(out.includes('&lt;script&gt;'));
  assert.equal(out.includes('<script'), false);
});

test('B5: every attribute in the output is renderer-authored — no data reaches an attribute', () => {
  // THE STRONGEST OF THE THREE INJECTION PROPERTIES, asserted structurally:
  // attribute-context escaping is the thing people get wrong, and here there is
  // no attribute-context escaping to get wrong because no data reaches one.
  const hostile = {
    ...GOLDEN_VALUES,
    freelancerName: 'a" class="evil',
    clientName: "b' onclick='x",
    projectDescription: 'c" id="x',
    startDate: '2026-12-31',
  };
  for (const [label, values] of [['golden', GOLDEN_VALUES], ['hostile', hostile]]) {
    const attributes = attributesOf(renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, values));
    assert.equal(attributes.length, 7, `${label}: cardinality before quantification — ${attributes.join(' ')}`);
    const names = [...new Set(attributes.map((a) => a.split('=')[0]))];
    assert.deepEqual(names, ['class'], `${label}: the ONLY attribute name this renderer emits is class`);
    const values_ = attributes.map((a) => a.slice(a.indexOf('"') + 1, -1)).sort();
    assert.deepEqual([...new Set(values_)], CLASS_VALUES, `${label}: every attribute value is in the frozen committed set`);
  }
});

test('B6: the output carries the placeholder marking and the attribution line', () => {
  const html = renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, GOLDEN_VALUES);
  // THREE INDEPENDENT MARKERS, so losing one does not silently unmark it.
  assert.ok(html.includes('<h1 class="contract-doc__title">Independent Contractor Agreement (placeholder)</h1>'));
  assert.ok(html.includes('<p class="contract-doc__notice-title">Placeholder contract text — not legal advice</p>'));
  const labels = html.match(/\[PLACEHOLDER — [^\]]+\]/g) ?? [];
  assert.equal(labels.length, 3, `cardinality: three body labels, found ${labels.join(', ')}`);
  // The attribution line, INSIDE the document region — never in page chrome a
  // screen could restyle away, so it survives print and download.
  assert.ok(html.includes(`<p class="contract-doc__attribution">${escapeHtml(INDEPENDENT_CONTRACTOR_AGREEMENT_V1.attribution)}</p>`));
  const article = html.slice(html.indexOf('<article'), html.lastIndexOf('</article>'));
  assert.ok(article.includes('contract-doc__attribution'), 'the attribution is inside the article, not beside it');
  assert.ok(article.includes('contract-doc__notice'), 'so is the warning');
  // And it does NOT credit Common Paper for text Common Paper did not write.
  assert.equal(/adapted from a template by Common Paper/i.test(html), false, 'plan §3.3: attributing our own placeholder text to Common Paper would be false');
});

test('B7: rendering is deterministic — identical inputs produce byte-identical output', () => {
  const once = renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, GOLDEN_VALUES);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, { ...GOLDEN_VALUES }), once);
  }
  // A pure function of its two arguments: no clock, no randomness, no ambient
  // state. A rendered document is a fact about its inputs alone.
  assert.equal(once, GOLDEN_HTML);
});

test('B8: a date renders long-form from its YYYY-MM-DD spelling', () => {
  const on = (startDate) => renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, { ...GOLDEN_VALUES, startDate });
  assert.ok(on('2026-09-08').includes('<strong>September 8, 2026</strong>'));
  assert.ok(on('2026-01-01').includes('<strong>January 1, 2026</strong>'), 'no zero padding in the day');
  assert.ok(on('2026-12-31').includes('<strong>December 31, 2026</strong>'));
  assert.ok(on('2024-02-29').includes('<strong>February 29, 2024</strong>'), 'a real leap day');
  // A 12-entry constant, NOT Intl: no ICU data version and no ambient timezone
  // in a document this app stores forever.
  assert.throws(() => on('2026-02-31'), ValidationError, 'a non-calendar date is refused, not rolled forward to March');
  assert.throws(() => on('08/09/2026'), /must be a date spelled YYYY-MM-DD/);
});

test('B9: a slot with no value throws rather than rendering a blank', () => {
  for (const missing of ['freelancerName', 'clientName', 'projectDescription', 'startDate']) {
    const values = { ...GOLDEN_VALUES };
    delete values[missing];
    assert.throws(() => renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, values), (err) => {
      assert.ok(err instanceof ValidationError, `${missing}: ${err}`);
      assert.equal(err.field, missing);
      return true;
    }, missing);
  }
  assert.throws(() => renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, { ...GOLDEN_VALUES, clientName: '' }), ValidationError);
  assert.throws(() => renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, {}), ValidationError);
  assert.throws(() => renderContract(INDEPENDENT_CONTRACTOR_AGREEMENT_V1, null), ValidationError);
});

// =============================================================================
// N — generation
// =============================================================================

test('N1: record-sourced variables are resolved from the freelancer and client rows, and the MERGED map is stored', async () => {
  await withGeneration(async ({ repos, freelancer, client, generation }) => {
    const contract = generation.generate(freelancer.id, { clientId: client.id, formValues: FORM_INPUT() });
    assert.deepEqual(Object.keys(contract.variables).sort(), ['clientName', 'freelancerName', 'projectDescription', 'startDate']);
    assert.equal(contract.variables.freelancerName, 'Freda Lancer');
    assert.equal(contract.variables.clientName, 'Client Co');
    assert.equal(contract.renderedHtml, GOLDEN_HTML);
    assert.equal(contract.clientId, client.id);
    assert.equal(contract.freelancerId, freelancer.id);
    // WHY THE MERGED MAP IS STORED: renaming the client afterwards must not
    // change what an ALREADY-ISSUED document says.
    repos.clients.update(freelancer.id, client.id, { name: 'Renamed Co' });
    const reread = repos.contracts.getById(freelancer.id, contract.id);
    assert.equal(reread.variables.clientName, 'Client Co', 'the snapshot is the document, not a live join');
    assert.equal(reread.renderedHtml, GOLDEN_HTML);
  });
});

test('N2: a missing required form value is a ValidationError naming the field, never a silent blank', async () => {
  await withGeneration(async ({ repos, freelancer, client, generation }) => {
    for (const [label, formValues] of [
      ['absent', { startDate: GOLDEN_VALUES.startDate }],
      ['empty string', { ...FORM_INPUT(), projectDescription: '' }],
      ['whitespace only', { ...FORM_INPUT(), projectDescription: '   \n  ' }],
      ['no form values at all', {}],
    ]) {
      assert.throws(() => generation.generate(freelancer.id, { clientId: client.id, formValues }), (err) => {
        assert.ok(err instanceof ValidationError, `${label}: ${err}`);
        assert.equal(err.field, 'projectDescription', label);
        // The REQUIRED check, specifically — not the renderer's downstream
        // backstop, which is B9's case and carries a different problem.
        assert.match(err.message, /is required/, label);
        return true;
      }, label);
      assert.deepEqual(repos.contracts.listByFreelancer(freelancer.id), [], `${label}: and nothing was written`);
    }
  });
});

test('N3: an over-long value is a ValidationError naming the field', async () => {
  await withGeneration(async ({ repos, freelancer, client, generation }) => {
    const limit = INDEPENDENT_CONTRACTOR_AGREEMENT_V1.variables.find((v) => v.name === 'projectDescription').maxLength;
    assert.equal(limit, 5000, 'the declared ceiling, read from the declaration rather than restated');
    // At the limit: accepted.
    const ok = generation.generate(freelancer.id, {
      clientId: client.id,
      formValues: { ...FORM_INPUT(), projectDescription: 'x'.repeat(limit) },
    });
    assert.equal(ok.variables.projectDescription.length, limit);
    // One past it: refused, by name.
    assert.throws(
      () => generation.generate(freelancer.id, { clientId: client.id, formValues: { ...FORM_INPUT(), projectDescription: 'x'.repeat(limit + 1) } }),
      (err) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.field, 'projectDescription');
        assert.match(err.message, /at most 5000 characters, got 5001/);
        return true;
      },
    );
    assert.equal(repos.contracts.listByFreelancer(freelancer.id).length, 1, 'only the accepted one was written');
  });
});

test('N4: a malformed or non-calendar date is a ValidationError', async () => {
  await withGeneration(async ({ repos, freelancer, client, generation }) => {
    for (const startDate of ['2026-02-31', '0026-01-01', '08/09/2026', '2026-9-8', '2026-13-01', 'tomorrow', '2026-09-08T00:00:00Z', '']) {
      assert.throws(() => generation.generate(freelancer.id, { clientId: client.id, formValues: { ...FORM_INPUT(), startDate } }), (err) => {
        assert.ok(err instanceof ValidationError, `${startDate}: ${err}`);
        assert.equal(err.field, 'startDate', startDate);
        return true;
      }, startDate);
    }
    // 0026-01-01 is shape-valid and calendar-valid; it is refused because the
    // UTC round-trip on a two-digit year does NOT reproduce year 26 — the trap
    // a naive `new Date(value)` walks into.
    assert.deepEqual(repos.contracts.listByFreelancer(freelancer.id), [], 'nothing malformed reaches the database');
  });
});

test('N5: the stored variables re-render to the stored HTML byte for byte', async () => {
  await withGeneration(async ({ repos, freelancer, client, generation }) => {
    const contract = generation.generate(freelancer.id, {
      clientId: client.id,
      formValues: { projectDescription: 'Line one.\n\nLine two with & and <b>.', startDate: '2027-03-01' },
    });
    const stored = repos.contracts.getById(freelancer.id, contract.id);
    // THE REPRODUCTION INVARIANT. It is what the versioned template id buys,
    // and it would be unprovable under an unversioned one.
    assert.equal(renderContract(getTemplate(stored.templateId), stored.variables), stored.renderedHtml);
    assert.equal(stored.renderedHtml, contract.renderedHtml);
  });
});

test('N6: a client owned by another freelancer is NotFoundError and writes no row', async () => {
  await withGeneration(async ({ repos, freelancer, generation }) => {
    const other = repos.freelancers.create({ email: 'otto@example.test', displayName: 'Otto Ther' });
    const theirs = repos.clients.create(other.id, { name: 'Not Yours', email: 'no@example.test' });
    const notOurs = () => generation.generate(freelancer.id, { clientId: theirs.id, formValues: FORM_INPUT() });
    assert.throws(notOurs, (err) => {
      assert.ok(err instanceof NotFoundError, String(err));
      assert.equal(err.entity, 'client');
      return true;
    });
    // IDENTICAL to a client that does not exist at all: confirming "this id
    // exists but isn't yours" leaks more than confirming nothing.
    assert.throws(
      () => generation.generate(freelancer.id, { clientId: 'no-such-client', formValues: FORM_INPUT() }),
      (err) => err instanceof NotFoundError && err.entity === 'client',
    );
    assert.deepEqual(repos.contracts.listByFreelancer(freelancer.id), []);
    assert.deepEqual(repos.contracts.listByFreelancer(other.id), [], 'and certainly nothing under the other freelancer');
  });
});

test('N7: the stored template id is the versioned id, not the family name', async () => {
  await withGeneration(async ({ repos, freelancer, client, generation }) => {
    const contract = generation.generate(freelancer.id, { clientId: client.id, formValues: FORM_INPUT() });
    assert.equal(contract.templateId, TEMPLATE_ID);
    assert.match(contract.templateId, /@1$/);
    assert.equal(repos.contracts.getById(freelancer.id, contract.id).templateId, TEMPLATE_ID);
    // Naming the version explicitly resolves to the same declaration…
    const explicit = generation.generate(freelancer.id, { clientId: client.id, templateId: TEMPLATE_ID, formValues: FORM_INPUT() });
    assert.equal(explicit.templateId, TEMPLATE_ID);
    // …and an unknown one is refused rather than silently defaulted.
    assert.throws(
      () => generation.generate(freelancer.id, { clientId: client.id, templateId: 'independent-contractor-agreement', formValues: FORM_INPUT() }),
      NotFoundError,
    );
  });
});

test('N8: a record-sourced variable supplied as a form value is a ValidationError', async () => {
  await withGeneration(async ({ repos, freelancer, client, generation }) => {
    // THE SPOOF THAT MATTERS: without this check a request could issue a
    // document in another person's name.
    for (const name of ['freelancerName', 'clientName']) {
      assert.throws(() => generation.generate(freelancer.id, { clientId: client.id, formValues: { ...FORM_INPUT(), [name]: 'Someone Else' } }), (err) => {
        assert.ok(err instanceof ValidationError, `${name}: ${err}`);
        assert.equal(err.field, name);
        assert.match(err.message, /resolved from your own records and cannot be supplied/);
        return true;
      }, name);
    }
    // A nonsense field is refused too, and says so differently.
    assert.throws(() => generation.generate(freelancer.id, { clientId: client.id, formValues: { ...FORM_INPUT(), notes: 'hi' } }), (err) => {
      assert.ok(err instanceof ValidationError);
      assert.equal(err.field, 'notes');
      assert.match(err.message, /unknown field/);
      return true;
    });
    assert.deepEqual(repos.contracts.listByFreelancer(freelancer.id), []);
  });
});

// =============================================================================
// P — the HTTP surface
// =============================================================================

test('P1: POST /contracts creates one contract and redirects 303 to its detail path', async () => {
  await withContractApp(async ({ base, config, repos, freelancer, client }) => {
    const res = await postForm(`${base}/contracts`, { clientId: client.id, ...FORM_INPUT() });
    assert.equal(res.status, 303, await res.text());
    const rows = repos.contracts.listByFreelancer(freelancer.id);
    assert.equal(rows.length, 1, 'exactly one row');
    assert.equal(countContracts(config), 1, 'and exactly one in the whole file');
    // THE LOCATION HEADER IS THE CONTRACT, asserted WITHOUT dereferencing it:
    // the detail screen is AS-47's and 404s until it lands.
    assert.equal(res.headers.get('location'), `/contracts/${encodeURIComponent(rows[0].id)}`);
    assert.equal(res.headers.get('location').includes('freelancer'), false, 'the redirect carries no identity');
    const stored = repos.contracts.getById(freelancer.id, rows[0].id);
    assert.equal(stored.templateId, TEMPLATE_ID);
    assert.equal(stored.renderedHtml, GOLDEN_HTML);
  });
});

test('P2: an unknown body field is a 400 and creates nothing', async () => {
  await withContractApp(async ({ base, config, repos, freelancer, client }) => {
    for (const extra of [{ notes: 'hello' }, { projectdescription: 'wrong case' }, { 'lineItems[0][description]': 'x' }]) {
      const res = await postForm(`${base}/contracts`, { clientId: client.id, ...FORM_INPUT(), ...extra });
      assert.equal(res.status, 400, `${JSON.stringify(extra)}: ${await res.text()}`);
      assert.match(res.headers.get('content-type'), /text\/plain/);
    }
    // A blank clientId is the route's own refusal, not the service's.
    assert.equal((await postForm(`${base}/contracts`, { ...FORM_INPUT() })).status, 400);
    assert.equal(countContracts(config), 0);
    assert.deepEqual(repos.contracts.listByFreelancer(freelancer.id), []);
  });
});

test('P3: a record-sourced variable in the body is a 400 and creates nothing', async () => {
  await withContractApp(async ({ base, config, repos, freelancer, client }) => {
    for (const name of ['freelancerName', 'clientName']) {
      const res = await postForm(`${base}/contracts`, { clientId: client.id, ...FORM_INPUT(), [name]: 'Someone Else' });
      assert.equal(res.status, 400, name);
      assert.equal(await res.text(), 'ValidationError: create\n');
    }
    assert.equal(countContracts(config), 0);
    assert.deepEqual(repos.contracts.listByFreelancer(freelancer.id), []);
  });
});

test('P4: a clientId owned by another freelancer answers 404 and creates nothing', async () => {
  await withContractApp(async ({ base, config, repos, freelancer }) => {
    const other = repos.freelancers.create({ email: 'otto@example.test', displayName: 'Otto Ther' });
    const theirs = repos.clients.create(other.id, { name: 'Not Yours', email: 'no@example.test' });
    const notOurs = await postForm(`${base}/contracts`, { clientId: theirs.id, ...FORM_INPUT() });
    assert.equal(notOurs.status, 404);
    assert.equal(await notOurs.text(), 'NotFoundError: create\n');
    // BYTE-IDENTICAL to a client that does not exist — S5/S7-DENIED-NOTOWNER
    // render as not-found by design.
    const missing = await postForm(`${base}/contracts`, { clientId: 'no-such-client', ...FORM_INPUT() });
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), 'NotFoundError: create\n');
    assert.equal(countContracts(config), 0);
    assert.deepEqual(repos.contracts.listByFreelancer(freelancer.id), []);
    assert.deepEqual(repos.contracts.listByFreelancer(other.id), []);
  });
});

test('P5: an unknown templateId answers 404 and creates nothing', async () => {
  await withContractApp(async ({ base, config, client }) => {
    for (const templateId of ['independent-contractor-agreement@2', 'independent-contractor-agreement', 'nonsense']) {
      const res = await postForm(`${base}/contracts`, { clientId: client.id, templateId, ...FORM_INPUT() });
      assert.equal(res.status, 404, templateId);
      assert.equal(await res.text(), 'NotFoundError: create\n');
    }
    // Absent means the default, and that DOES create one — the field is
    // optional, not ignored.
    assert.equal((await postForm(`${base}/contracts`, { clientId: client.id, ...FORM_INPUT() })).status, 303);
    assert.equal(countContracts(config), 1);
  });
});

test('P6: a body past the parser limit answers with the parser\'s own status and creates nothing', async () => {
  await withContractApp(async ({ base, config, repos, freelancer, client }) => {
    // Past the 32kb router-scoped limit: it never reaches a handler, so it
    // needs the router's own error middleware to land in the house shape.
    const huge = await postForm(`${base}/contracts`, `clientId=${'x'.repeat(40_000)}`);
    assert.equal(huge.status, 413);
    assert.match(huge.headers.get('content-type'), /text\/plain/);
    assert.match(await huge.text(), /parse-body/);
    // Past the 20-parameter limit: the parser's own status again.
    const manyFields = {};
    for (let i = 0; i < 40; i += 1) manyFields[`f${i}`] = 'x';
    const many = await postForm(`${base}/contracts`, { clientId: client.id, ...FORM_INPUT(), ...manyFields });
    assert.equal(many.status, 413);
    assert.equal(countContracts(config), 0);
    assert.deepEqual(repos.contracts.listByFreelancer(freelancer.id), []);
  });
});

test('P7: the identity acted on is the session\'s, never a freelancerId in the query string', async () => {
  await withContractApp(async ({ base, repos, freelancer, client }) => {
    const other = repos.freelancers.create({ email: 'otto@example.test', displayName: 'Otto Ther' });
    const res = await postForm(
      `${base}/contracts?freelancerId=${encodeURIComponent(other.id)}&freelancer=${encodeURIComponent(other.id)}`,
      { clientId: client.id, ...FORM_INPUT() },
    );
    assert.equal(res.status, 303, await res.text());
    assert.deepEqual(repos.contracts.listByFreelancer(other.id), [], 'NOT created for the NAMED freelancer');
    const ours = repos.contracts.listByFreelancer(freelancer.id);
    assert.equal(ours.length, 1, 'created for the SESSION\'s freelancer');
    // And the document says the SESSION freelancer's name, not the named one's.
    assert.equal(repos.contracts.getById(freelancer.id, ours[0].id).variables.freelancerName, 'Freda Lancer');
    assert.equal(res.headers.get('location').includes('freelancer'), false);
  });
});

test('P8: no route mutates or deletes a contract', async () => {
  await withContractApp(async ({ base, app, config, repos, freelancer, client }) => {
    // IMMUTABILITY IS IMPLEMENTED AS ABSENCE. Nothing serves a mutating
    // request, so it 404s — there is no handler whose job is to say "no".
    const contractRoutesFound = discoverRoutes(app).filter((r) => r.split(' ')[1].startsWith('/contracts'));
    assert.equal(contractRoutesFound.length, 1, `cardinality before quantification: ${contractRoutesFound.join(', ')}`);
    assert.deepEqual(contractRoutesFound, ['POST /contracts']);

    const created = await postForm(`${base}/contracts`, { clientId: client.id, ...FORM_INPUT() });
    assert.equal(created.status, 303);
    const [row] = repos.contracts.listByFreelancer(freelancer.id);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${base}/contracts/${row.id}`, { method, redirect: 'manual', headers: auth.headers });
      assert.equal(res.status, 404, `${method} /contracts/:id must be served by nothing`);
    }
    // Layer two: the repository exposes no way to change one.
    assert.deepEqual(Object.keys(repos.contracts).sort(), ['create', 'getById', 'listByFreelancer']);
    const after = repos.contracts.getById(freelancer.id, row.id);
    assert.equal(after.renderedHtml, GOLDEN_HTML, 'the issued document is unchanged');
    assert.equal(countContracts(config), 1, 'and nothing was created or deleted by any of that');
  });
});

// =============================================================================
// Y — the boundary claims
// =============================================================================

/** Every file on the contracts path, walked rather than listed by hand so a
 *  file added under lib/contracts/ cannot escape the claim. */
function contractSourceFiles(dir = join(APP_DIR, 'lib', 'contracts'), found = []) {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) contractSourceFiles(path, found);
    else found.push(path);
  }
  return found;
}

test('Y1: nothing in the contracts path names Stripe, in code or in comments', async () => {
  const files = [...contractSourceFiles(), join(APP_DIR, 'routes', 'contracts.js')];
  const names = files.map((p) => relative(APP_DIR, p)).sort();
  // Cardinality before quantification: a walk that found nothing would pass a
  // "no matches" assertion on an empty set.
  assert.equal(names.length, 5, `expected 5 files on the contracts path, found: ${names.join(', ')}`);
  assert.deepEqual(names, [
    'lib/contracts/generation.js',
    'lib/contracts/render.js',
    'lib/contracts/templates.js',
    'lib/contracts/templates/independent-contractor-agreement.js',
    'routes/contracts.js',
  ]);
  // RAW text, comments included. This is the one D1 entity with no payment
  // processor dimension: no custody guard, no connected-account header, no
  // allowlisted call, no readiness gate. Y1 covers ground no global
  // dependency-policy row covers.
  const offenders = [];
  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    assert.ok(text.length > 0, `${relative(APP_DIR, path)} is empty — the scan is reading nothing`);
    const hits = text.match(/stripe/gi) ?? [];
    if (hits.length > 0) offenders.push(`${relative(APP_DIR, path)} (${hits.length})`);
  }
  assert.deepEqual(offenders, [], `the contracts path names Stripe: ${offenders.join(', ')}`);
});

test('Y2: contractRoutes is constructed from repos alone and takes no stripe dependency', async () => {
  await withRepos(async (repos) => {
    // It CONSTRUCTS with no second dependency at all — not "tolerates a missing
    // one": there is nothing to miss.
    const router = contractRoutes(configFor(), { repos });
    assert.equal(typeof router, 'function');
    const routes = router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
    assert.deepEqual(routes, ['POST /contracts']);
    assert.equal(contractRoutes.length, 2, 'the (config, deps) shape every mount line in app.js uses');
  });
  // And app.js hands it exactly that — the asymmetry with its two neighbours is
  // asserted, not left to the eye.
  const appSource = readFileSync(join(APP_DIR, 'app.js'), 'utf8');
  const mounts = appSource.match(/app\.use\(contractRoutes\([^)]*\)\)/g) ?? [];
  assert.equal(mounts.length, 1, `expected exactly one contractRoutes mount, found ${mounts.length}`);
  assert.equal(mounts[0], 'app.use(contractRoutes(config, { repos }))');
  assert.equal(/contractRoutes\([^)]*stripe/.test(appSource), false, 'contractRoutes is never handed a stripe dependency');
  // Its neighbours still take theirs — otherwise this case would pass on an app
  // where the second dependency stopped existing for everyone.
  assert.ok(appSource.includes('app.use(invoiceRoutes(config, { repos, stripe }))'));
});
