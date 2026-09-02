// lib/webhooks/receiver.js — what a VERIFIED Stripe event does to our mirror
// (AS-44, plan §3.4–§3.8).
//
// ONE SENTENCE, taken literally: a verified event is applied to the mirror by
// writing a snapshot derived entirely from the event's own bytes, exactly once,
// through machinery that already exists. Everything here follows from it —
// nothing is mapped in this file (AS-41 and AS-43 wrote and proved both
// mappers), nothing is ranked in this file (AS-39 built the state machine and
// it is the only one), and nothing is stamped from a clock in this file.
//
// THIS FILE READS NO CLOCK. Every value any handler writes comes from the
// event: the snapshot from `data.object`, the two observation times from
// `created`. That is the mechanical statement of why a redelivery is a strict
// no-op rather than a nearly-one, and it is asserted by grep (the G1 case in
// test/webhooks.test.js) rather than trusted.
//
// THIS FILE IS SYNCHRONOUS THROUGHOUT, and that is a HARD RULE, not a style.
// repos.transaction runs its callback and then COMMITs; a callback returning a
// pending promise would commit before the work. There is no I/O here and no
// Stripe call anywhere in this feature, so the rule costs nothing — and G1
// greps for it, because a convention nobody can check is a convention that
// lasts until someone is in a hurry.
//
// THE LEDGER IS A BELT HERE, BY DESIGN. With every handler a pure function of
// its event, removing the ledger entirely would change only `updated_at` and
// the response body — which is exactly what the F4 recipe demonstrates. It
// earns its place for three other reasons: it is the audit record of which
// events we processed, it is a cheap early exit under a retry storm, and it is
// what keeps a future NON-idempotent handler honest. THE TRIGGER: the moment a
// handler does something outside the mirror — an email, a counter, a Stripe
// call — the ledger stops being a belt and becomes the mechanism, and that
// task must say so in its own plan.
import { readinessFromAccount } from '../connect/readiness.js';
import { invoiceSnapshotFromStripe, isoFromEpochSeconds } from '../invoices/mapping.js';

/** Epoch seconds off the event envelope, in the ONE timestamp shape the
 *  database stores. AS-43's converter, imported rather than copied: a second
 *  copy in this directory is the one thing every convention in this app
 *  forbids (plan §3.6, §11 item 6). */
const iso = (created) => isoFromEpochSeconds(created, 'event.created');

const objectOf = (event) => event.data.object;

/** Both Stripe-keyed lookups take no owner, deliberately: AS-39 designed them
 *  that way BECAUSE their caller is a webhook with no session. The join key is
 *  the Stripe object id and never the envelope — the envelope's `account`
 *  field is used for neither routing nor a cross-check, because a second key
 *  for the same join can only disagree, and a check that cannot fire is a check
 *  nobody will understand the day it does (plan §3.4.1). */
const locateInvoice = (repos, event) => repos.invoices.getByStripeInvoiceId(objectOf(event).id);
const locateAccount = (repos, event) => repos.connectedAccounts.getByStripeAccountId(objectOf(event).id);

/**
 * The one write path for every `invoice.*` row of the table: AS-43's mapper,
 * plus whatever this event alone knows, through AS-39's applyStripeSnapshot —
 * the sole writer of `status` and the only place ordering is decided.
 *
 * `extra` is spread LAST so an observation this task owns cannot be erased by
 * a mapper that should never have emitted the key in the first place (the
 * lib/invoices/lifecycle.js step-5 convention, deliberately identical).
 */
function applyInvoiceSnapshot(repos, event, extra = {}) {
  const object = objectOf(event);
  const result = repos.invoices.applyStripeSnapshot(object.id, { ...invoiceSnapshotFromStripe(object), ...extra });
  if (result.outcome === 'conflict') {
    // ERROR level, and it is the only outcome that earns it: our mirror and
    // Stripe disagree about a TERMINAL state, which no retry and no re-read can
    // resolve (plan §3.8 — the rank machine refuses to guess, and a resolution
    // that overrode it would be a bypass, not a resolution).
    console.error(
      `webhook ${event.id}: ${event.type} conflicts with the mirror (mirror ${result.from}, event ${result.to}) — nothing written`,
    );
  } else if (result.outcome === 'stale') {
    // INFO, because `stale` is the DESIGNED result of every out-of-order
    // sequence and would cry wolf at anything louder. lib/invoices/lifecycle.js
    // logs the same outcome at warn — different call site, different
    // expectation: there, a stale write means a webhook beat us, which is
    // genuinely surprising. Recorded so the difference is not read as an
    // inconsistency.
    console.info(
      `webhook ${event.id}: ${event.type} is older than the mirror (mirror ${result.from}, event ${result.to}) — nothing written`,
    );
  }
  return { outcome: result.outcome };
}

/**
 * EIGHT HANDLED TYPES, as a frozen table. A type not in it is `ignored`, and
 * the lookup happens BEFORE the transaction opens, so an ignored event is never
 * recorded: AS-39's invariant for that table is "a row exists IFF the event was
 * processed, atomically with its effects", and a row for an event with no
 * effects would be a false statement about our own history. It would also be a
 * trap — the day a handler is added for that type, a redelivery of an
 * already-recorded event would be skipped.
 *
 * `voided` and `marked_uncollectible` are handled although the Lattice
 * description's prose list omits them (plan §3.4, §9 Q5): two merged artifacts
 * assign them here by name, their apply is byte-identical to `finalized`'s, and
 * without them the mirror would show "sent, awaiting payment" for an invoice
 * the freelancer voided in their own Stripe Dashboard — not a gap, a lie.
 *
 * Each row is { locate, apply }. `apply` receives the located row as its third
 * argument for the shape's sake; NO handler trusts it today — it decided
 * `unknown-target` and nothing else, and the one handler that needs the mirror's
 * current state re-reads it under the write lock instead (see below).
 */
const invoiceRow = { locate: locateInvoice, apply: (repos, event) => applyInvoiceSnapshot(repos, event) };

const HANDLERS = Object.freeze({
  'invoice.created': invoiceRow,
  'invoice.finalized': invoiceRow,
  'invoice.sent': {
    locate: locateInvoice,
    // THE SECOND WRITER OF `sentAt`, amending AS-43 plan §3.10's boundary table
    // (plan §3.6, §11 item 3). AS-43 closes the "Stripe sent the email but our
    // mirror write died" hole with a stable idempotency key, which holds only
    // inside Stripe's window; past it the client is emailed twice. This closes
    // it permanently, from the one source of truth about whether Stripe sent
    // the email — and ONLY when the mirror has no recorded time, because
    // overwriting a recorded fact is the thing the mapper omits the key to
    // prevent.
    //
    // RE-READ, NOT `target`: the condition is evaluated inside the transaction,
    // against a row read under the write lock, so it cannot race AS-43's
    // writer. `locate` ran before BEGIN IMMEDIATE and its row may already be
    // out of date. The row cannot be null here — nothing in this app deletes —
    // and if it somehow were, applyStripeSnapshot would refuse anyway.
    apply: (repos, event) => {
      const current = repos.invoices.getByStripeInvoiceId(objectOf(event).id);
      return applyInvoiceSnapshot(repos, event, current.sentAt === null ? { sentAt: iso(event.created) } : {});
    },
  },
  'invoice.paid': invoiceRow,
  'invoice.payment_failed': {
    locate: locateInvoice,
    // FROM THE EVENT, NOT OUR CLOCK: truer (it is when the payment failed, not
    // when we heard about it) and idempotent (a redelivery writes the same
    // bytes). The first place the read-no-clock rule buys something concrete.
    apply: (repos, event) => applyInvoiceSnapshot(repos, event, { lastPaymentFailedAt: iso(event.created) }),
  },
  'invoice.voided': invoiceRow,
  'invoice.marked_uncollectible': invoiceRow,
  'account.updated': {
    locate: locateAccount,
    // AS-41's mapper, imported unchanged and not re-derived: it was written
    // pure and proven against an event-shaped fixture before this task existed,
    // precisely so this line could be one line. The derived `ready` flag lives
    // in AS-39's row mapper and is named nowhere in this diff.
    //
    // The sync time is the EVENT'S `created`, not our receipt time — a
    // strengthening of AS-41 §3.5 rather than a violation of it. For a webhook,
    // the moment the snapshot was OBTAINED from Stripe is the moment Stripe
    // created the event; stamping our receipt time would claim a three-day-old
    // redelivery is fresh, in a column named for when it was synced.
    apply: (repos, event) => {
      const object = objectOf(event);
      repos.connectedAccounts.updateReadiness(object.id, readinessFromAccount(object, iso(event.created)));
      return { outcome: 'readiness' };
    },
  },
});

/** The vocabulary the route turns into a status line. Frozen and exported so a
 *  new outcome is a deliberate two-place change (here, and the test that pins
 *  this list) rather than a string that appears once in a response body. */
export const OUTCOMES = Object.freeze([
  'ignored',
  'unknown-target',
  'duplicate',
  'applied',
  'fields',
  'stale',
  'conflict',
  'readiness',
]);

/** The event types this receiver handles, for the README, the tests and anyone
 *  wiring an endpoint at Stripe. Derived from the table, never a second list. */
export const HANDLED_TYPES = Object.freeze(Object.keys(HANDLERS));

/**
 * @param {{ repos: object }} deps repos from createRepositories(db). There is
 *   deliberately NO `stripe` here: this is the first Stripe-touching module in
 *   this app that makes zero Stripe calls, and the absent dependency is the
 *   structural proof of it — an unused dependency is an unused exemption.
 * @returns {{ receive: (event: object) => { outcome: string } }}
 */
export function createWebhookReceiver({ repos } = {}) {
  if (repos === null || typeof repos !== 'object') throw new TypeError('webhooks: repos is required');

  /**
   * Dispatch, locate, then apply exactly once.
   *
   * `recordOnce` is called FIRST INSIDE the transaction and the work is
   * SECOND, both inside ONE repos.transaction — AS-39's BEGIN IMMEDIATE /
   * COMMIT / ROLLBACK helper, which the repositories' own transactions JOIN
   * rather than nest, so there is exactly one commit.
   *
   * "What if the process dies between the marker and the work?" — there is no
   * between. Die before the commit: nothing is written, no marker, and Stripe's
   * retry is processed normally. Die after it: both are durable, and the retry
   * finds `recordOnce` false and answers `duplicate` having written nothing.
   * Ordering the marker first also serialises two concurrent deliveries of the
   * same event: the second transaction waits on the write lock, then sees the
   * row. Exactly-once, out of a primary key.
   *
   * A missing local row is `unknown-target` and NOT an exception, which is the
   * single highest-cost decision in this file: an `in_` or `acct_` we do not
   * know about is NORMAL (the freelancer has their own full Stripe Dashboard
   * and can invoice from it), and answering non-2xx to a normal condition means
   * their own dashboard activity eventually makes Stripe disable our endpoint.
   */
  function receive(event) {
    // Object.hasOwn, not a bare lookup. HANDLERS is an object literal, so a
    // `type` of `constructor`, `toString` or `__proto__` resolves to an
    // INHERITED member — truthy, without a `locate` — and dispatch would throw
    // a TypeError, which the route answers with 500 where §3.4.2 requires a
    // 200 `ignored`. Not a live hole: every Stripe event type contains a dot,
    // so none can collide, and reaching this line at all takes a valid
    // signature. It is fixed anyway because 500 is the one answer this receiver
    // must never give to a type it simply does not handle — Stripe retries a
    // 5xx for three days and can disable the endpoint over it (§3.4.1 reason
    // 3). Proven by breaking it: W7 carries the six prototype keys and goes red
    // against a bare lookup. (qa-ruben, AS-44 review.)
    const handler = Object.hasOwn(HANDLERS, event.type) ? HANDLERS[event.type] : undefined;
    if (handler === undefined) return { outcome: 'ignored' };
    const target = handler.locate(repos, event);
    if (target === null) return { outcome: 'unknown-target' };
    return repos.transaction(() => {
      if (!repos.stripeEvents.recordOnce(event.id, event.type)) return { outcome: 'duplicate' };
      return handler.apply(repos, event, target);
    });
  }

  return Object.freeze({ receive });
}
