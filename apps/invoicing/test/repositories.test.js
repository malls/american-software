// repositories.test.js — the six repositories, the invoice state machine and the
// DDL backstops behind them (AS-39, plan §2.10 groups F, A, C, K, I, E, X, Z).
//
// Every test opens its own in-memory database, migrates it and builds the
// repositories with a FIXED clock and a COUNTING id generator, so timestamps
// and ids are asserted by value, never by shape (Z covers the shapes when
// neither is injected). The X group bypasses the repositories on purpose: it
// proves the DDL catches what the validators are supposed to catch first, so
// the two layers are shown to agree rather than assumed to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../lib/db/connection.js';
import { migrate } from '../lib/db/migrate.js';
import {
  ForeignKeyViolationError,
  InvalidStateError,
  NotFoundError,
  UniqueViolationError,
  ValidationError,
  createRepositories,
} from '../lib/db/database.js';
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '../lib/db/money.js';

const T0 = '2026-09-01T12:00:00.000Z';
const T1 = '2026-09-01T12:00:01.000Z';
const T2 = '2026-09-01T12:00:02.000Z';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A migrated in-memory database and repositories with a settable clock. */
function harness(t) {
  const db = openDatabase(':memory:');
  migrate(db);
  const clock = { now: T0 };
  let counter = 0;
  const repos = createRepositories(db, { now: () => clock.now, newId: () => `id-${String(++counter).padStart(3, '0')}` });
  t.after(() => db.close());
  return { db, repos, clock };
}

/** Two freelancers, each with one client — the fixture every owner-scoping test needs. */
function seed(repos) {
  const ann = repos.freelancers.create({ email: 'ann@example.com', displayName: 'Ann' });
  const bob = repos.freelancers.create({ email: 'bob@example.com', displayName: 'Bob' });
  const annClient = repos.clients.create(ann.id, { name: 'Zed Corp', email: 'billing@zed.example' });
  const bobClient = repos.clients.create(bob.id, { name: 'Yak Ltd', email: 'ap@yak.example' });
  return { ann, bob, annClient, bobClient };
}

const ITEMS = [
  { description: 'Design', quantity: 2, unitAmountMinor: 5000 },
  { description: 'Build', quantity: 1, unitAmountMinor: 12500 },
];

function draft(repos, freelancerId, clientId, overrides = {}) {
  return repos.invoices.createDraft(freelancerId, { clientId, daysUntilDue: 30, lineItems: ITEMS, ...overrides });
}

/** assert.throws with the class AND the stable code, so a test cannot pass on
 *  the wrong error of the right shape. Returns the error for further asserts. */
function throwsRepositoryError(fn, Class, code) {
  let caught;
  assert.throws(fn, (err) => {
    assert.ok(err instanceof Class, `expected ${Class.name}, got ${err.name}: ${err.message}`);
    assert.equal(err.code, code);
    caught = err;
    return true;
  });
  return caught;
}
const throwsValidation = (fn) => throwsRepositoryError(fn, ValidationError, 'validation');
const throwsNotFound = (fn) => throwsRepositoryError(fn, NotFoundError, 'not_found');
const throwsUnique = (fn) => throwsRepositoryError(fn, UniqueViolationError, 'unique_violation');
const throwsForeignKey = (fn) => throwsRepositoryError(fn, ForeignKeyViolationError, 'foreign_key_violation');
const throwsInvalidState = (fn) => throwsRepositoryError(fn, InvalidStateError, 'invalid_state');

/** A raw statement rejected by the engine with this extended result code. */
function throwsSqlite(fn, errcode) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, 'ERR_SQLITE_ERROR', `expected an engine error, got ${err.name}: ${err.message}`);
    assert.equal(err.errcode, errcode, err.message);
    return true;
  });
}

const count = (db, table, where = '1 = 1', ...params) =>
  db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get(...params).n;

// --- F: freelancers ----------------------------------------------------------------

test('F1: create returns the camelCase row with the injected id and clock', (t) => {
  const { repos } = harness(t);
  const row = repos.freelancers.create({ email: 'Ann@Example.com', displayName: 'Ann' });
  assert.deepEqual(row, { id: 'id-001', email: 'Ann@Example.com', displayName: 'Ann', createdAt: T0, updatedAt: T0 });
});

test('F2: getById returns the row; an unknown id is NotFoundError with code not_found', (t) => {
  const { repos } = harness(t);
  const created = repos.freelancers.create({ email: 'ann@example.com', displayName: 'Ann' });
  assert.deepEqual(repos.freelancers.getById(created.id), created);
  const err = throwsNotFound(() => repos.freelancers.getById('id-999'));
  assert.equal(err.entity, 'freelancer');
  assert.equal(err.id, 'id-999');
});

test('F3: findByEmail is case-insensitive and returns null for no match', (t) => {
  const { repos } = harness(t);
  const created = repos.freelancers.create({ email: 'Ann@Example.com', displayName: 'Ann' });
  assert.deepEqual(repos.freelancers.findByEmail('ann@example.com'), created);
  assert.deepEqual(repos.freelancers.findByEmail('ANN@EXAMPLE.COM'), created);
  assert.equal(repos.freelancers.findByEmail('nobody@example.com'), null);
});

test('F4: a duplicate email, byte for byte, is UniqueViolationError naming the index', (t) => {
  const { db, repos } = harness(t);
  repos.freelancers.create({ email: 'ann@example.com', displayName: 'Ann' });
  const err = throwsUnique(() => repos.freelancers.create({ email: 'ann@example.com', displayName: 'Other' }));
  assert.match(err.constraint, /freelancers_email_unique/);
  assert.equal(count(db, 'freelancers'), 1);
});

test('F5: a duplicate email differing only in case is UniqueViolationError too', (t) => {
  const { db, repos } = harness(t);
  repos.freelancers.create({ email: 'ann@example.com', displayName: 'Ann' });
  throwsUnique(() => repos.freelancers.create({ email: 'ANN@Example.COM', displayName: 'Other' }));
  assert.equal(count(db, 'freelancers'), 1);
});

test('F6: an empty email or displayName is ValidationError naming the field, before any row exists', (t) => {
  const { db, repos } = harness(t);
  assert.equal(throwsValidation(() => repos.freelancers.create({ email: '', displayName: 'Ann' })).field, 'email');
  assert.equal(throwsValidation(() => repos.freelancers.create({ email: '   ', displayName: 'Ann' })).field, 'email');
  assert.equal(throwsValidation(() => repos.freelancers.create({ email: 'a@b', displayName: '' })).field, 'displayName');
  assert.equal(throwsValidation(() => repos.freelancers.create({ email: 'a@b', displayName: 'A', extra: 1 })).field, 'freelancer.extra');
  assert.equal(count(db, 'freelancers'), 0);
});

test('F7: update changes displayName and bumps updatedAt to the advanced clock; unknown id is NotFoundError', (t) => {
  const { repos, clock } = harness(t);
  const created = repos.freelancers.create({ email: 'ann@example.com', displayName: 'Ann' });
  clock.now = T1;
  const updated = repos.freelancers.update(created.id, { displayName: 'Ann Q.' });
  assert.deepEqual(updated, { ...created, displayName: 'Ann Q.', updatedAt: T1 });
  assert.equal(updated.createdAt, T0);
  throwsNotFound(() => repos.freelancers.update('id-999', { displayName: 'X' }));
  throwsValidation(() => repos.freelancers.update(created.id, { displayName: '' }));
  throwsValidation(() => repos.freelancers.update(created.id, { email: 'new@example.com' }));
});

// --- A: connected accounts -----------------------------------------------------------

test('A1: create stores the pair and defaults every readiness field: flags false, nothing due, not ready, never synced', (t) => {
  const { repos } = harness(t);
  const { ann } = seed(repos);
  const account = repos.connectedAccounts.create({ freelancerId: ann.id, stripeAccountId: 'acct_1A' });
  assert.deepEqual(account, {
    id: 'id-005',
    freelancerId: ann.id,
    stripeAccountId: 'acct_1A',
    chargesEnabled: false,
    detailsSubmitted: false,
    payoutsEnabled: false,
    requirementsCurrentlyDue: [],
    requirementsDisabledReason: null,
    syncedAt: null,
    ready: false,
    createdAt: T0,
    updatedAt: T0,
  });
  assert.deepEqual(repos.connectedAccounts.getByFreelancer(ann.id), account);
});

test('A2: a second account for the same freelancer is UniqueViolationError (one account per freelancer in v1)', (t) => {
  const { db, repos } = harness(t);
  const { ann } = seed(repos);
  repos.connectedAccounts.create({ freelancerId: ann.id, stripeAccountId: 'acct_1A' });
  throwsUnique(() => repos.connectedAccounts.create({ freelancerId: ann.id, stripeAccountId: 'acct_2B' }));
  assert.equal(count(db, 'connected_accounts'), 1);
});

test('A3: the same acct_ for another freelancer is UniqueViolationError', (t) => {
  const { db, repos } = harness(t);
  const { ann, bob } = seed(repos);
  repos.connectedAccounts.create({ freelancerId: ann.id, stripeAccountId: 'acct_1A' });
  throwsUnique(() => repos.connectedAccounts.create({ freelancerId: bob.id, stripeAccountId: 'acct_1A' }));
  assert.equal(count(db, 'connected_accounts'), 1);
});

test('A4: an unknown freelancer is ForeignKeyViolationError', (t) => {
  const { db, repos } = harness(t);
  throwsForeignKey(() => repos.connectedAccounts.create({ freelancerId: 'id-999', stripeAccountId: 'acct_1A' }));
  assert.equal(count(db, 'connected_accounts'), 0);
});

test('A5: a malformed account id is ValidationError before any SQL runs', (t) => {
  const { db, repos } = harness(t);
  const { ann } = seed(repos);
  assert.equal(throwsValidation(() => repos.connectedAccounts.create({ freelancerId: ann.id, stripeAccountId: 'cus_1A' })).field, 'stripeAccountId');
  assert.equal(throwsValidation(() => repos.connectedAccounts.create({ freelancerId: ann.id, stripeAccountId: 'acct_' })).field, 'stripeAccountId');
  assert.equal(throwsValidation(() => repos.connectedAccounts.create({ freelancerId: ann.id, stripeAccountId: 'acct_1A', ready: true })).field, 'connectedAccount.ready');
  assert.equal(count(db, 'connected_accounts'), 0);
});

test('A6: updateReadiness writes all six fields, and `ready` is charges on AND nothing due — exactly one of four', (t) => {
  const { repos, clock } = harness(t);
  const { ann } = seed(repos);
  repos.connectedAccounts.create({ freelancerId: ann.id, stripeAccountId: 'acct_1A' });
  clock.now = T1;
  const synced = repos.connectedAccounts.updateReadiness('acct_1A', {
    chargesEnabled: true,
    detailsSubmitted: true,
    payoutsEnabled: false,
    requirementsCurrentlyDue: ['external_account'],
    requirementsDisabledReason: 'requirements.past_due',
    syncedAt: T1,
  });
  assert.equal(synced.chargesEnabled, true);
  assert.equal(synced.detailsSubmitted, true);
  assert.equal(synced.payoutsEnabled, false);
  assert.deepEqual(synced.requirementsCurrentlyDue, ['external_account']);
  assert.equal(synced.requirementsDisabledReason, 'requirements.past_due');
  assert.equal(synced.syncedAt, T1);
  assert.equal(synced.updatedAt, T1);
  assert.equal(synced.createdAt, T0);
  assert.deepEqual(repos.connectedAccounts.getByStripeAccountId('acct_1A'), synced);

  // The truth table: charges × due, four rows, exactly one true.
  const table = [];
  for (const chargesEnabled of [false, true]) {
    for (const due of [['external_account'], []]) {
      const row = repos.connectedAccounts.updateReadiness('acct_1A', {
        chargesEnabled,
        detailsSubmitted: true,
        payoutsEnabled: true,
        requirementsCurrentlyDue: due,
        requirementsDisabledReason: null,
        syncedAt: T2,
      });
      table.push([chargesEnabled, due.length, row.ready]);
    }
  }
  assert.equal(table.length, 4);
  assert.deepEqual(table, [
    [false, 1, false],
    [false, 0, false],
    [true, 1, false],
    [true, 0, true],
  ]);

  // Partial or mistyped readiness is refused whole.
  throwsValidation(() => repos.connectedAccounts.updateReadiness('acct_1A', { chargesEnabled: true }));
  throwsValidation(() =>
    repos.connectedAccounts.updateReadiness('acct_1A', {
      chargesEnabled: 'yes',
      detailsSubmitted: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
      requirementsDisabledReason: null,
      syncedAt: T2,
    }),
  );
  throwsValidation(() =>
    repos.connectedAccounts.updateReadiness('acct_1A', {
      chargesEnabled: true,
      detailsSubmitted: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
      requirementsDisabledReason: null,
      syncedAt: 1756728000,
    }),
  );
});

test('A7: updateReadiness on an unknown acct_ is NotFoundError; getByStripeAccountId and getByFreelancer return null for no match', (t) => {
  const { repos } = harness(t);
  const { ann } = seed(repos);
  const err = throwsNotFound(() =>
    repos.connectedAccounts.updateReadiness('acct_none', {
      chargesEnabled: true,
      detailsSubmitted: true,
      payoutsEnabled: true,
      requirementsCurrentlyDue: [],
      requirementsDisabledReason: null,
      syncedAt: T1,
    }),
  );
  assert.equal(err.id, 'acct_none');
  assert.equal(repos.connectedAccounts.getByStripeAccountId('acct_none'), null);
  assert.equal(repos.connectedAccounts.getByFreelancer(ann.id), null);
  const account = repos.connectedAccounts.create({ freelancerId: ann.id, stripeAccountId: 'acct_1A' });
  assert.deepEqual(repos.connectedAccounts.getByStripeAccountId('acct_1A'), account);
});

// --- C: clients ------------------------------------------------------------------------

test('C1: create returns the owner-scoped row with no Stripe customer yet', (t) => {
  const { repos } = harness(t);
  const ann = repos.freelancers.create({ email: 'ann@example.com', displayName: 'Ann' });
  const client = repos.clients.create(ann.id, { name: 'Zed Corp', email: 'billing@zed.example' });
  assert.deepEqual(client, {
    id: 'id-002',
    freelancerId: ann.id,
    name: 'Zed Corp',
    email: 'billing@zed.example',
    stripeCustomerId: null,
    createdAt: T0,
    updatedAt: T0,
  });
  assert.equal(throwsValidation(() => repos.clients.create(ann.id, { name: '', email: 'x@y' })).field, 'name');
  assert.equal(throwsValidation(() => repos.clients.create(ann.id, { name: 'X', email: '' })).field, 'email');
});

test('C2: getById by another owner is NotFoundError — the same error as a missing id', (t) => {
  const { repos } = harness(t);
  const { ann, bob, annClient } = seed(repos);
  assert.deepEqual(repos.clients.getById(ann.id, annClient.id), annClient);
  const notOwned = throwsNotFound(() => repos.clients.getById(bob.id, annClient.id));
  const missing = throwsNotFound(() => repos.clients.getById(ann.id, 'id-999'));
  assert.equal(notOwned.message, `client not found: ${annClient.id}`);
  assert.equal(missing.message, 'client not found: id-999');
});

test('C3: listByFreelancer returns exactly the owner\'s 2 of 3 clients, ordered by lower(name)', (t) => {
  const { repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const second = repos.clients.create(ann.id, { name: 'alpha studio', email: 'hi@alpha.example' });
  const list = repos.clients.listByFreelancer(ann.id);
  assert.equal(list.length, 2);
  assert.deepEqual(list, [second, annClient]);
  assert.deepEqual(repos.clients.listByFreelancer('id-999'), []);
});

test('C4: findByEmail returns BOTH duplicates, case-insensitively — email is a warning, not a block', (t) => {
  const { repos } = harness(t);
  const { ann, bob, annClient } = seed(repos);
  const twin = repos.clients.create(ann.id, { name: 'Zed Corp (new)', email: 'BILLING@zed.example' });
  repos.clients.create(bob.id, { name: 'Zed Corp', email: 'billing@zed.example' });
  const matches = repos.clients.findByEmail(ann.id, 'Billing@Zed.Example');
  assert.equal(matches.length, 2);
  assert.deepEqual(matches, [annClient, twin]);
  assert.deepEqual(repos.clients.findByEmail(ann.id, 'nobody@zed.example'), []);
});

test('C5: update changes name and/or email, bumps updatedAt, and refuses an empty patch or a foreign owner', (t) => {
  const { repos, clock } = harness(t);
  const { ann, bob, annClient } = seed(repos);
  clock.now = T1;
  const renamed = repos.clients.update(ann.id, annClient.id, { name: 'Zed Corporation' });
  assert.deepEqual(renamed, { ...annClient, name: 'Zed Corporation', updatedAt: T1 });
  clock.now = T2;
  const both = repos.clients.update(ann.id, annClient.id, { name: 'Zed', email: 'ap@zed.example' });
  assert.deepEqual(both, { ...annClient, name: 'Zed', email: 'ap@zed.example', updatedAt: T2 });
  throwsValidation(() => repos.clients.update(ann.id, annClient.id, {}));
  throwsValidation(() => repos.clients.update(ann.id, annClient.id, { stripeCustomerId: 'cus_1' }));
  throwsNotFound(() => repos.clients.update(bob.id, annClient.id, { name: 'Taken' }));
  assert.deepEqual(repos.clients.getById(ann.id, annClient.id), both);
});

test('C6: setStripeCustomerId sets once, is idempotent for the same id, and InvalidStateError for a different one', (t) => {
  const { repos, clock } = harness(t);
  const { ann, annClient } = seed(repos);
  clock.now = T1;
  const set = repos.clients.setStripeCustomerId(ann.id, annClient.id, 'cus_1A');
  assert.deepEqual(set, { ...annClient, stripeCustomerId: 'cus_1A', updatedAt: T1 });
  clock.now = T2;
  assert.deepEqual(repos.clients.setStripeCustomerId(ann.id, annClient.id, 'cus_1A'), set, 'the same id again writes nothing');
  const err = throwsInvalidState(() => repos.clients.setStripeCustomerId(ann.id, annClient.id, 'cus_2B'));
  assert.match(err.message, /cus_1A/);
  assert.deepEqual(repos.clients.getById(ann.id, annClient.id), set);
});

test('C7: the same cus_ on a second client is UniqueViolationError; a malformed id is ValidationError', (t) => {
  const { repos } = harness(t);
  const { ann, bob, annClient, bobClient } = seed(repos);
  repos.clients.setStripeCustomerId(ann.id, annClient.id, 'cus_1A');
  throwsUnique(() => repos.clients.setStripeCustomerId(bob.id, bobClient.id, 'cus_1A'));
  assert.equal(repos.clients.getById(bob.id, bobClient.id).stripeCustomerId, null);
  assert.equal(throwsValidation(() => repos.clients.setStripeCustomerId(bob.id, bobClient.id, 'acct_1A')).field, 'stripeCustomerId');
  throwsNotFound(() => repos.clients.setStripeCustomerId(bob.id, annClient.id, 'cus_3C'));
});

test('C8: create for an unknown freelancer is ForeignKeyViolationError', (t) => {
  const { db, repos } = harness(t);
  throwsForeignKey(() => repos.clients.create('id-999', { name: 'Nobody', email: 'n@example.com' }));
  assert.equal(count(db, 'clients'), 0);
});

// --- K: contracts ----------------------------------------------------------------------

const CONTRACT = { templateId: 'services-v1', variables: { rate: 150, unit: 'hour', nested: { ok: true } }, renderedHtml: '<p>Rendered</p>' };

test('K1: create stores the record and round-trips variables through JSON', (t) => {
  const { repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const contract = repos.contracts.create(ann.id, { clientId: annClient.id, ...CONTRACT });
  assert.deepEqual(contract, {
    id: 'id-005',
    freelancerId: ann.id,
    clientId: annClient.id,
    templateId: 'services-v1',
    createdAt: T0,
    variables: { rate: 150, unit: 'hour', nested: { ok: true } },
    renderedHtml: '<p>Rendered</p>',
  });
  assert.equal(Object.hasOwn(contract, 'updatedAt'), false, 'contracts are immutable: no updatedAt');
});

test('K2: a client of another owner is NotFoundError(\'client\'); variables that are not a plain object are ValidationError', (t) => {
  const { db, repos } = harness(t);
  const { ann, bobClient, annClient } = seed(repos);
  const err = throwsNotFound(() => repos.contracts.create(ann.id, { clientId: bobClient.id, ...CONTRACT }));
  assert.equal(err.entity, 'client');
  assert.equal(err.id, bobClient.id);
  for (const variables of [null, [], 'rate=150', 42, new Date(0)]) {
    assert.equal(throwsValidation(() => repos.contracts.create(ann.id, { clientId: annClient.id, ...CONTRACT, variables })).field, 'variables');
  }
  assert.equal(throwsValidation(() => repos.contracts.create(ann.id, { clientId: annClient.id, ...CONTRACT, renderedHtml: '' })).field, 'renderedHtml');
  assert.equal(count(db, 'contracts'), 0);
});

test('K3: getById is owner-scoped', (t) => {
  const { repos } = harness(t);
  const { ann, bob, annClient } = seed(repos);
  const contract = repos.contracts.create(ann.id, { clientId: annClient.id, ...CONTRACT });
  assert.deepEqual(repos.contracts.getById(ann.id, contract.id), contract);
  throwsNotFound(() => repos.contracts.getById(bob.id, contract.id));
  throwsNotFound(() => repos.contracts.getById(ann.id, 'id-999'));
});

test('K4: listByFreelancer returns summaries newest first, without renderedHtml or variables', (t) => {
  const { repos, clock } = harness(t);
  const { ann, bob, annClient, bobClient } = seed(repos);
  const first = repos.contracts.create(ann.id, { clientId: annClient.id, ...CONTRACT });
  clock.now = T1;
  const second = repos.contracts.create(ann.id, { clientId: annClient.id, ...CONTRACT, templateId: 'services-v2' });
  repos.contracts.create(bob.id, { clientId: bobClient.id, ...CONTRACT });
  const list = repos.contracts.listByFreelancer(ann.id);
  assert.equal(list.length, 2);
  assert.deepEqual(list, [
    { id: second.id, freelancerId: ann.id, clientId: annClient.id, templateId: 'services-v2', createdAt: T1 },
    { id: first.id, freelancerId: ann.id, clientId: annClient.id, templateId: 'services-v1', createdAt: T0 },
  ]);
});

test('K5: contracts have no update — there is no draft, so there is no edit', (t) => {
  const { repos } = harness(t);
  assert.equal(repos.contracts.update, undefined);
  assert.deepEqual(Object.keys(repos.contracts), ['create', 'getById', 'listByFreelancer']);
});

// --- I: invoices -------------------------------------------------------------------------

test('I1: createDraft with two items is a draft in the default currency with totalMinor and positions 0..1', (t) => {
  const { repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  assert.equal(invoice.status, 'draft');
  assert.equal(invoice.currency, DEFAULT_CURRENCY);
  assert.equal(invoice.stripeInvoiceId, null);
  assert.equal(invoice.daysUntilDue, 30);
  assert.equal(invoice.totalMinor, 2 * 5000 + 12500);
  assert.equal(invoice.lineItems.length, 2);
  assert.deepEqual(
    invoice.lineItems.map(({ id, ...rest }) => rest),
    [
      { position: 0, description: 'Design', quantity: 2, unitAmountMinor: 5000 },
      { position: 1, description: 'Build', quantity: 1, unitAmountMinor: 12500 },
    ],
  );
  assert.deepEqual(repos.invoices.getById(ann.id, invoice.id), invoice);
  for (const key of ['hostedInvoiceUrl', 'invoicePdfUrl', 'amountDueMinor', 'amountPaidMinor', 'dueAt', 'finalizedAt', 'sentAt', 'paidAt', 'voidedAt', 'markedUncollectibleAt', 'lastPaymentFailedAt']) {
    assert.equal(invoice[key], null, `${key} is Stripe's to fill in`);
  }
});

test('I2: an unsupported currency is ValidationError, and the DDL never saw it', (t) => {
  const { db, repos } = harness(t);
  const { ann, annClient } = seed(repos);
  assert.equal(throwsValidation(() => draft(repos, ann.id, annClient.id, { currency: 'eur' })).field, 'currency');
  assert.equal(throwsValidation(() => draft(repos, ann.id, annClient.id, { currency: 'USD' })).field, 'currency');
  assert.equal(count(db, 'invoices'), 0);
});

test('I3: the supported set is exactly usd, and the default is in it', () => {
  assert.deepEqual(SUPPORTED_CURRENCIES, ['usd']);
  assert.equal(SUPPORTED_CURRENCIES.length, 1);
  assert.ok(SUPPORTED_CURRENCIES.includes(DEFAULT_CURRENCY));
  assert.ok(Object.isFrozen(SUPPORTED_CURRENCIES));
});

test('I4: zero items, quantity 0, a negative unit, a fractional unit, and daysUntilDue 0 are each ValidationError', (t) => {
  const { db, repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const item = (patch) => [{ ...ITEMS[0], ...patch }];
  assert.equal(throwsValidation(() => draft(repos, ann.id, annClient.id, { lineItems: [] })).field, 'lineItems');
  assert.equal(throwsValidation(() => draft(repos, ann.id, annClient.id, { lineItems: item({ quantity: 0 }) })).field, 'lineItems[0].quantity');
  assert.equal(throwsValidation(() => draft(repos, ann.id, annClient.id, { lineItems: item({ unitAmountMinor: -1 }) })).field, 'lineItems[0].unitAmountMinor');
  assert.equal(throwsValidation(() => draft(repos, ann.id, annClient.id, { lineItems: item({ unitAmountMinor: 19.99 }) })).field, 'lineItems[0].unitAmountMinor');
  assert.equal(throwsValidation(() => draft(repos, ann.id, annClient.id, { lineItems: item({ description: ' ' }) })).field, 'lineItems[0].description');
  assert.equal(throwsValidation(() => draft(repos, ann.id, annClient.id, { lineItems: item({ amount: 1 }) })).field, 'lineItems[0].amount');
  assert.equal(throwsValidation(() => draft(repos, ann.id, annClient.id, { daysUntilDue: 0 })).field, 'daysUntilDue');
  assert.equal(count(db, 'invoices'), 0);
  assert.equal(count(db, 'invoice_line_items'), 0);
});

test('I5: a client of another owner is NotFoundError(\'client\') and nothing is written', (t) => {
  const { db, repos } = harness(t);
  const { ann, bobClient } = seed(repos);
  const err = throwsNotFound(() => draft(repos, ann.id, bobClient.id));
  assert.equal(err.entity, 'client');
  assert.equal(count(db, 'invoices'), 0);
  assert.equal(count(db, 'invoice_line_items'), 0);
});

test('I6: getById is owner-scoped', (t) => {
  const { repos } = harness(t);
  const { ann, bob, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  throwsNotFound(() => repos.invoices.getById(bob.id, invoice.id));
  throwsNotFound(() => repos.invoices.getById(ann.id, 'id-999'));
});

test('I7: listByFreelancer returns summaries newest first, with totalMinor and without lineItems', (t) => {
  const { repos, clock } = harness(t);
  const { ann, bob, annClient, bobClient } = seed(repos);
  const first = draft(repos, ann.id, annClient.id);
  clock.now = T1;
  const second = draft(repos, ann.id, annClient.id, { lineItems: [{ description: 'Retainer', quantity: 1, unitAmountMinor: 99 }] });
  draft(repos, bob.id, bobClient.id);
  const list = repos.invoices.listByFreelancer(ann.id);
  assert.equal(list.length, 2);
  const { lineItems: _second, ...secondSummary } = second;
  const { lineItems: _first, ...firstSummary } = first;
  assert.deepEqual(list, [secondSummary, firstSummary]);
  assert.deepEqual(list.map((row) => row.totalMinor), [99, 22500]);
  assert.ok(list.every((row) => !Object.hasOwn(row, 'lineItems')));
});

test('I8: updateDraft replaces the line items as a set — old positions gone, count exact — and bumps updatedAt', (t) => {
  const { db, repos, clock } = harness(t);
  const { ann, annClient, bobClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  const oldItemIds = invoice.lineItems.map((item) => item.id);
  clock.now = T1;
  const updated = repos.invoices.updateDraft(ann.id, invoice.id, {
    daysUntilDue: 14,
    lineItems: [{ description: 'Everything', quantity: 3, unitAmountMinor: 100 }],
  });
  assert.equal(updated.daysUntilDue, 14);
  assert.equal(updated.updatedAt, T1);
  assert.equal(updated.lineItems.length, 1);
  assert.deepEqual(updated.lineItems.map(({ id, ...rest }) => rest), [{ position: 0, description: 'Everything', quantity: 3, unitAmountMinor: 100 }]);
  assert.equal(updated.totalMinor, 300);
  assert.equal(count(db, 'invoice_line_items', 'invoice_id = ?', invoice.id), 1);
  for (const id of oldItemIds) assert.equal(count(db, 'invoice_line_items', 'id = ?', id), 0);
  // A failing replacement leaves the previous set intact (the transaction rolls back).
  throwsValidation(() => repos.invoices.updateDraft(ann.id, invoice.id, { lineItems: [] }));
  throwsValidation(() => repos.invoices.updateDraft(ann.id, invoice.id, {}));
  throwsValidation(() => repos.invoices.updateDraft(ann.id, invoice.id, { status: 'open' }));
  assert.deepEqual(repos.invoices.getById(ann.id, invoice.id), updated);
  // Moving the draft to another client is allowed while local, but only to one the owner has.
  const otherClient = repos.clients.create(ann.id, { name: 'Other', email: 'o@example.com' });
  assert.equal(repos.invoices.updateDraft(ann.id, invoice.id, { clientId: otherClient.id }).clientId, otherClient.id);
  throwsNotFound(() => repos.invoices.updateDraft(ann.id, invoice.id, { clientId: bobClient.id }));
});

test('I9: updateDraft on an open invoice is InvalidStateError', (t) => {
  const { repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  repos.invoices.attachStripeInvoice(ann.id, invoice.id, 'in_1A');
  repos.invoices.applyStripeSnapshot('in_1A', { status: 'open', finalizedAt: T1 });
  const err = throwsInvalidState(() => repos.invoices.updateDraft(ann.id, invoice.id, { daysUntilDue: 7 }));
  assert.match(err.message, /open/);
  assert.equal(repos.invoices.getById(ann.id, invoice.id).daysUntilDue, 30);
});

test('I10: attachStripeInvoice sets the id once; twice is InvalidStateError, malformed is ValidationError, a duplicate in_ is UniqueViolationError', (t) => {
  const { repos, clock } = harness(t);
  const { ann, annClient } = seed(repos);
  const one = draft(repos, ann.id, annClient.id);
  const two = draft(repos, ann.id, annClient.id);
  clock.now = T1;
  const attached = repos.invoices.attachStripeInvoice(ann.id, one.id, 'in_1A');
  assert.deepEqual(attached, { ...one, stripeInvoiceId: 'in_1A', updatedAt: T1 });
  assert.equal(attached.status, 'draft', 'attaching does not change status; the finalize snapshot does');
  throwsInvalidState(() => repos.invoices.attachStripeInvoice(ann.id, one.id, 'in_2B'));
  throwsInvalidState(() => repos.invoices.attachStripeInvoice(ann.id, one.id, 'in_1A'));
  assert.equal(throwsValidation(() => repos.invoices.attachStripeInvoice(ann.id, two.id, 'inv_1A')).field, 'stripeInvoiceId');
  throwsUnique(() => repos.invoices.attachStripeInvoice(ann.id, two.id, 'in_1A'));
  assert.equal(repos.invoices.getById(ann.id, two.id).stripeInvoiceId, null);
});

test('I11: updateDraft after attach is InvalidStateError — the local draft is frozen while finalization is in progress', (t) => {
  const { repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  repos.invoices.attachStripeInvoice(ann.id, invoice.id, 'in_1A');
  const err = throwsInvalidState(() => repos.invoices.updateDraft(ann.id, invoice.id, { lineItems: [{ description: 'Late', quantity: 1, unitAmountMinor: 1 }] }));
  assert.match(err.message, /in_1A/);
  assert.equal(repos.invoices.getById(ann.id, invoice.id).lineItems.length, 2);
});

test('I12: snapshots draft→open and open→paid are `applied` with their fields written and updatedAt bumped', (t) => {
  const { repos, clock } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  repos.invoices.attachStripeInvoice(ann.id, invoice.id, 'in_1A');
  clock.now = T1;
  const finalized = repos.invoices.applyStripeSnapshot('in_1A', {
    status: 'open',
    hostedInvoiceUrl: 'https://invoice.stripe.com/i/1A',
    invoicePdfUrl: 'https://pay.stripe.com/invoice/1A/pdf',
    amountDueMinor: 22500,
    dueAt: '2026-10-01T12:00:00.000Z',
    finalizedAt: T1,
  });
  assert.equal(finalized.outcome, 'applied');
  assert.equal(finalized.from, 'draft');
  assert.equal(finalized.to, 'open');
  assert.equal(finalized.invoice.status, 'open');
  assert.equal(finalized.invoice.hostedInvoiceUrl, 'https://invoice.stripe.com/i/1A');
  assert.equal(finalized.invoice.invoicePdfUrl, 'https://pay.stripe.com/invoice/1A/pdf');
  assert.equal(finalized.invoice.amountDueMinor, 22500);
  assert.equal(finalized.invoice.dueAt, '2026-10-01T12:00:00.000Z');
  assert.equal(finalized.invoice.finalizedAt, T1);
  assert.equal(finalized.invoice.updatedAt, T1);
  assert.deepEqual(finalized.invoice.lineItems, invoice.lineItems);
  clock.now = T2;
  const paid = repos.invoices.applyStripeSnapshot('in_1A', { status: 'paid', amountPaidMinor: 22500, paidAt: T2 });
  assert.equal(paid.outcome, 'applied');
  assert.equal(paid.from, 'open');
  assert.equal(paid.to, 'paid');
  assert.equal(paid.invoice.status, 'paid');
  assert.equal(paid.invoice.amountPaidMinor, 22500);
  assert.equal(paid.invoice.paidAt, T2);
  assert.equal(paid.invoice.updatedAt, T2);
  assert.equal(paid.invoice.hostedInvoiceUrl, 'https://invoice.stripe.com/i/1A', 'fields not in the snapshot are kept');
  assert.deepEqual(repos.invoices.getById(ann.id, invoice.id), paid.invoice);
});

test('I13: paid then `open` is `stale` — nothing changes, fields and updatedAt identical', (t) => {
  const { repos, clock } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  repos.invoices.attachStripeInvoice(ann.id, invoice.id, 'in_1A');
  repos.invoices.applyStripeSnapshot('in_1A', { status: 'open', finalizedAt: T0, hostedInvoiceUrl: 'https://x/1' });
  clock.now = T1;
  const paid = repos.invoices.applyStripeSnapshot('in_1A', { status: 'paid', paidAt: T1 }).invoice;
  clock.now = T2;
  const late = repos.invoices.applyStripeSnapshot('in_1A', { status: 'open', hostedInvoiceUrl: 'https://x/2', sentAt: T2 });
  assert.equal(late.outcome, 'stale');
  assert.equal(late.from, 'paid');
  assert.equal(late.to, 'open');
  assert.deepEqual(late.invoice, paid);
  assert.deepEqual(repos.invoices.getById(ann.id, invoice.id), paid);
  assert.equal(paid.updatedAt, T1);
  assert.equal(paid.sentAt, null);
  assert.equal(paid.hostedInvoiceUrl, 'https://x/1');
});

test('I14: paid before finalized converges — the draft goes straight to paid, the late finalize is stale, the first url is kept', (t) => {
  const { repos, clock } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  repos.invoices.attachStripeInvoice(ann.id, invoice.id, 'in_1A');
  clock.now = T1;
  const paid = repos.invoices.applyStripeSnapshot('in_1A', {
    status: 'paid',
    hostedInvoiceUrl: 'https://x/from-paid',
    amountPaidMinor: 22500,
    paidAt: T1,
  });
  assert.equal(paid.outcome, 'applied');
  assert.equal(paid.from, 'draft');
  assert.equal(paid.to, 'paid');
  clock.now = T2;
  const finalize = repos.invoices.applyStripeSnapshot('in_1A', {
    status: 'open',
    hostedInvoiceUrl: 'https://x/from-finalize',
    finalizedAt: T2,
  });
  assert.equal(finalize.outcome, 'stale');
  const final = repos.invoices.getById(ann.id, invoice.id);
  assert.equal(final.status, 'paid');
  assert.equal(final.hostedInvoiceUrl, 'https://x/from-paid');
  assert.equal(final.finalizedAt, null);
  assert.equal(final.amountPaidMinor, 22500);
  assert.equal(final.updatedAt, T1);
  assert.deepEqual(finalize.invoice, final);
});

test('I15: the same status is `fields` (sentAt lands); paid vs void is `conflict` and writes nothing', (t) => {
  const { repos, clock } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  repos.invoices.attachStripeInvoice(ann.id, invoice.id, 'in_1A');
  repos.invoices.applyStripeSnapshot('in_1A', { status: 'open', finalizedAt: T0 });
  clock.now = T1;
  const sent = repos.invoices.applyStripeSnapshot('in_1A', { status: 'open', sentAt: T1 });
  assert.equal(sent.outcome, 'fields');
  assert.equal(sent.from, 'open');
  assert.equal(sent.to, 'open');
  assert.equal(sent.invoice.sentAt, T1);
  assert.equal(sent.invoice.finalizedAt, T0);
  assert.equal(sent.invoice.updatedAt, T1);
  clock.now = T2;
  const paid = repos.invoices.applyStripeSnapshot('in_1A', { status: 'paid', paidAt: T2 }).invoice;
  const voided = repos.invoices.applyStripeSnapshot('in_1A', { status: 'void', voidedAt: T2 });
  assert.equal(voided.outcome, 'conflict');
  assert.equal(voided.from, 'paid');
  assert.equal(voided.to, 'void');
  assert.deepEqual(voided.invoice, paid);
  assert.equal(voided.invoice.voidedAt, null);
  assert.deepEqual(repos.invoices.getById(ann.id, invoice.id), paid);
  // And the mirror image: a void invoice told it is paid.
  const other = draft(repos, ann.id, annClient.id);
  repos.invoices.attachStripeInvoice(ann.id, other.id, 'in_2B');
  repos.invoices.applyStripeSnapshot('in_2B', { status: 'void', voidedAt: T2 });
  const back = repos.invoices.applyStripeSnapshot('in_2B', { status: 'paid', paidAt: T2 });
  assert.equal(back.outcome, 'conflict');
  assert.equal(back.invoice.status, 'void');
  assert.equal(back.invoice.paidAt, null);
});

test('I16: an unknown status or key is ValidationError, an unknown in_ is NotFoundError, and getByStripeInvoiceId finds by Stripe id', (t) => {
  const { repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  repos.invoices.attachStripeInvoice(ann.id, invoice.id, 'in_1A');
  assert.equal(throwsValidation(() => repos.invoices.applyStripeSnapshot('in_1A', { status: 'finalized' })).field, 'snapshot.status');
  assert.equal(throwsValidation(() => repos.invoices.applyStripeSnapshot('in_1A', { hostedInvoiceUrl: 'https://x' })).field, 'snapshot.status');
  assert.equal(throwsValidation(() => repos.invoices.applyStripeSnapshot('in_1A', { status: 'open', invoicePdf: 'https://x' })).field, 'snapshot.invoicePdf');
  assert.equal(throwsValidation(() => repos.invoices.applyStripeSnapshot('in_1A', { status: 'open', finalizedAt: 1756728000 })).field, 'snapshot.finalizedAt');
  assert.equal(throwsValidation(() => repos.invoices.applyStripeSnapshot('in_1A', { status: 'open', amountDueMinor: 12.5 })).field, 'snapshot.amountDueMinor');
  assert.equal(throwsNotFound(() => repos.invoices.applyStripeSnapshot('in_9Z', { status: 'open' })).id, 'in_9Z');
  assert.equal(repos.invoices.getById(ann.id, invoice.id).status, 'draft', 'none of the above wrote anything');
  assert.deepEqual(repos.invoices.getByStripeInvoiceId('in_1A'), repos.invoices.getById(ann.id, invoice.id));
  assert.equal(repos.invoices.getByStripeInvoiceId('in_9Z'), null);
});

// --- E: stripe events ---------------------------------------------------------------------

test('E1: recordOnce is true on first sight and false on every repeat', (t) => {
  const { db, repos } = harness(t);
  assert.equal(repos.stripeEvents.recordOnce('evt_1A', 'invoice.paid'), true);
  assert.equal(repos.stripeEvents.recordOnce('evt_1A', 'invoice.paid'), false);
  assert.equal(repos.stripeEvents.recordOnce('evt_1A', 'invoice.finalized'), false, 'the id decides, not the type');
  assert.equal(count(db, 'stripe_events'), 1);
  assert.deepEqual({ ...db.prepare('SELECT id, type, processed_at FROM stripe_events').get() }, { id: 'evt_1A', type: 'invoice.paid', processed_at: T0 });
});

test('E2: has reports exactly the recorded ids', (t) => {
  const { repos } = harness(t);
  assert.equal(repos.stripeEvents.has('evt_1A'), false);
  repos.stripeEvents.recordOnce('evt_1A', 'account.updated');
  assert.equal(repos.stripeEvents.has('evt_1A'), true);
  assert.equal(repos.stripeEvents.has('evt_2B'), false);
});

test('E3: a malformed event id or an empty type is ValidationError', (t) => {
  const { db, repos } = harness(t);
  assert.equal(throwsValidation(() => repos.stripeEvents.recordOnce('in_1A', 'invoice.paid')).field, 'eventId');
  assert.equal(throwsValidation(() => repos.stripeEvents.recordOnce('evt_1A', '')).field, 'type');
  assert.equal(throwsValidation(() => repos.stripeEvents.has('evt_')).field, 'eventId');
  assert.equal(count(db, 'stripe_events'), 0);
});

test('E4: recordOnce inside a rolled-back repos.transaction leaves no row — a failed apply lets the retry through', (t) => {
  const { db, repos } = harness(t);
  assert.throws(
    () =>
      repos.transaction(() => {
        assert.equal(repos.stripeEvents.recordOnce('evt_1A', 'invoice.paid'), true);
        assert.equal(repos.stripeEvents.has('evt_1A'), true);
        throw new Error('apply failed');
      }),
    /apply failed/,
  );
  assert.equal(db.isTransaction, false);
  assert.equal(repos.stripeEvents.has('evt_1A'), false);
  assert.equal(count(db, 'stripe_events'), 0);
  assert.equal(repos.stripeEvents.recordOnce('evt_1A', 'invoice.paid'), true, 'the retry is the first sight');
});

// --- X: the DDL backstops, bypassing the validators ----------------------------------------

/** Raw inserts with every NOT NULL satisfied, so exactly one constraint is under test. */
const rawInvoice = (db, overrides = {}) => {
  const row = {
    id: 'raw-inv',
    freelancer_id: 'id-001',
    client_id: 'id-003',
    status: 'draft',
    currency: 'usd',
    days_until_due: 30,
    stripe_invoice_id: null,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
  const columns = Object.keys(row);
  return db.prepare(`INSERT INTO invoices (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(row));
};

test('X1: an invoice status outside the five is CHECK (275)', (t) => {
  const { db, repos } = harness(t);
  seed(repos);
  throwsSqlite(() => rawInvoice(db, { status: 'bogus', stripe_invoice_id: 'in_1A' }), 275);
  assert.equal(count(db, 'invoices'), 0);
});

test('X2: an upper-case currency is CHECK (275) — the DDL fixes the shape even though money.js owns the set', (t) => {
  const { db, repos } = harness(t);
  seed(repos);
  throwsSqlite(() => rawInvoice(db, { currency: 'USD' }), 275);
  assert.equal(count(db, 'invoices'), 0);
});

test('X3: a non-draft status without a Stripe invoice id is CHECK (275)', (t) => {
  const { db, repos } = harness(t);
  seed(repos);
  throwsSqlite(() => rawInvoice(db, { status: 'open' }), 275);
  rawInvoice(db, { status: 'open', stripe_invoice_id: 'in_1A' });
  assert.equal(count(db, 'invoices'), 1);
});

test('X4: an invoice whose client belongs to another freelancer is the composite FOREIGN KEY (787)', (t) => {
  const { db, repos } = harness(t);
  const { ann, bobClient } = seed(repos);
  throwsSqlite(() => rawInvoice(db, { freelancer_id: ann.id, client_id: bobClient.id }), 787);
  assert.equal(count(db, 'invoices'), 0);
});

test('X5: a contract whose client belongs to another freelancer is the composite FOREIGN KEY (787)', (t) => {
  const { db, repos } = harness(t);
  const { ann, bobClient } = seed(repos);
  const insert = db.prepare(
    'INSERT INTO contracts (id, freelancer_id, client_id, template_id, variables, rendered_html, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  throwsSqlite(() => insert.run('raw-k', ann.id, bobClient.id, 't', '{}', '<p/>', T0), 787);
  assert.equal(count(db, 'contracts'), 0);
});

test('X6: a line item with quantity 0 is CHECK (275)', (t) => {
  const { db, repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  const insert = db.prepare(
    'INSERT INTO invoice_line_items (id, invoice_id, position, description, quantity, unit_amount_minor) VALUES (?, ?, ?, ?, ?, ?)',
  );
  throwsSqlite(() => insert.run('raw-li', invoice.id, 2, 'Nothing', 0, 100), 275);
  throwsSqlite(() => insert.run('raw-li', invoice.id, 2, 'Refund', 1, -100), 275);
  assert.equal(count(db, 'invoice_line_items'), 2);
});

test('X7: a stripe_events id without the evt_ prefix is CHECK (275)', (t) => {
  const { db } = harness(t);
  throwsSqlite(() => db.prepare('INSERT INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)').run('in_1A', 'invoice.paid', T0), 275);
  assert.equal(count(db, 'stripe_events'), 0);
});

test('X8: text in an INTEGER column is the STRICT datatype error (3091), not a silent coercion', (t) => {
  const { db, repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  const insert = db.prepare(
    'INSERT INTO invoice_line_items (id, invoice_id, position, description, quantity, unit_amount_minor) VALUES (?, ?, ?, ?, ?, ?)',
  );
  throwsSqlite(() => insert.run('raw-li', invoice.id, 2, 'Two', 'two', 100), 3091);
  throwsSqlite(() => rawInvoice(db, { freelancer_id: ann.id, client_id: annClient.id, days_until_due: 'thirty' }), 3091);
  assert.equal(count(db, 'invoice_line_items'), 2);
});

test('X9: a raw DELETE of an invoice cascades to its line items', (t) => {
  const { db, repos } = harness(t);
  const { ann, annClient } = seed(repos);
  const invoice = draft(repos, ann.id, annClient.id);
  const keep = draft(repos, ann.id, annClient.id);
  assert.equal(count(db, 'invoice_line_items'), 4);
  db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
  assert.equal(count(db, 'invoice_line_items', 'invoice_id = ?', invoice.id), 0);
  assert.equal(count(db, 'invoice_line_items', 'invoice_id = ?', keep.id), 2);
  assert.equal(count(db, 'invoice_line_items'), 2);
});

// --- Z: cross-cutting ---------------------------------------------------------------------

test('Z1: with the real clock every timestamp is ISO-8601 UTC with milliseconds', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  migrate(db);
  const repos = createRepositories(db);
  const freelancer = repos.freelancers.create({ email: 'ann@example.com', displayName: 'Ann' });
  const client = repos.clients.create(freelancer.id, { name: 'Zed', email: 'z@example.com' });
  const invoice = draft(repos, freelancer.id, client.id);
  const contract = repos.contracts.create(freelancer.id, { clientId: client.id, ...CONTRACT });
  repos.stripeEvents.recordOnce('evt_1A', 'x');
  const stamps = [
    freelancer.createdAt,
    freelancer.updatedAt,
    client.createdAt,
    invoice.createdAt,
    invoice.updatedAt,
    contract.createdAt,
    db.prepare('SELECT processed_at FROM stripe_events').get().processed_at,
  ];
  assert.equal(stamps.length, 7);
  for (const stamp of stamps) assert.match(stamp, ISO);
  assert.ok(Math.abs(Date.parse(freelancer.createdAt) - Date.now()) < 60_000, 'and it is now, not an epoch');
});

test('Z2: with no id generator injected, ids are v4 UUIDs and distinct', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  migrate(db);
  const repos = createRepositories(db);
  const freelancer = repos.freelancers.create({ email: 'ann@example.com', displayName: 'Ann' });
  const client = repos.clients.create(freelancer.id, { name: 'Zed', email: 'z@example.com' });
  const invoice = draft(repos, freelancer.id, client.id);
  const ids = [freelancer.id, client.id, invoice.id, ...invoice.lineItems.map((item) => item.id)];
  assert.equal(ids.length, 5);
  for (const id of ids) assert.match(id, UUID);
  assert.equal(new Set(ids).size, ids.length);
});

test('Z3: createRepositories returns a frozen object with exactly the nine keys', (t) => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  migrate(db);
  const repos = createRepositories(db);
  assert.deepEqual(Object.keys(repos), ['transaction', 'freelancers', 'connectedAccounts', 'clients', 'contracts', 'invoices', 'stripeEvents', 'credentials', 'sessions']);
  assert.ok(Object.isFrozen(repos));
  for (const key of Object.keys(repos)) {
    if (key !== 'transaction') assert.ok(Object.isFrozen(repos[key]), `${key} is frozen`);
  }
  assert.equal(repos.transaction(() => 42), 42);
});
