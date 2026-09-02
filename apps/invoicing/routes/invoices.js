// routes/invoices.js — chain link 4, server side: create a local draft, edit a
// local draft, finalize, send (AS-43, plan §3.1–§3.3). Paths align with the
// wireframes' route table so AS-46 (screen 4) and AS-48 (screens 3 and 5)
// converge on these names without a rename.
//
// THIN BY TEST, not just by intent: every Stripe call lives in
// lib/invoices/lifecycle.js, so these handlers only translate HTTP to service
// calls and error classes to statuses. Draft create and update never touch
// Stripe at all — a freelancer may build drafts before connecting an account.
//
// All redirects are 303 See Other — semantically required for a POST, and one
// literal for all four routes (the routes/connect.js precedent). Error bodies
// are one-line text/plain carrying the error class and the step that failed,
// never the key and never request material; screens render states from the DB
// row, not from these bodies. `/invoices/{id}` and `/invoices/{id}/edit` are
// AS-48's and AS-46's screens and 404 until they land: the Location header is
// the contract, asserted without dereferencing it, and the gap closes in
// dependency order.
import express, { Router } from 'express';
import { ConfigError } from '../lib/config.js';
import { InvalidStateError, NotFoundError, ValidationError } from '../lib/db/database.js';
import { StripeApiError, StripeCustodyError, StripeTransportError } from '../lib/stripe/client.js';
import { AccountNotReadyError, AmountMismatchError, createInvoiceLifecycle } from '../lib/invoices/lifecycle.js';
// THE SHARED AS-40 SEAM: identity resolution for these routes is the SAME
// exported function routes/connect.js uses, not a second copy — one function,
// one AS-40 OBLIGATION marker, one replacement point when sessions land. A
// route module importing another route module is unusual and deliberate: the
// alternative (extracting to lib/http/identity.js) edits a proven surface for
// no behaviour change. The trigger to extract is a THIRD consumer — AS-42's
// contract routes (plan §9 Q1).
import { resolveFreelancerId } from './connect.js';

/** Above this a request is a mistake or an attack, not an invoice. Exceeded is
 *  a 400; the body-parser's own limits (below) answer for size and parameter
 *  count before we ever count items. */
const MAX_LINE_ITEMS = 50;

/** A strict integer parse: digits only, then Number. `Number('')`, `Number(' ')`
 *  and `Number('1e3')` all coerce to something plausible and all three are
 *  wrong here — a silent coercion in this file is a wrong invoice total. */
const DIGITS = /^\d+$/;

const CREATE_FIELDS = ['clientId', 'daysUntilDue', 'currency', 'lineItems'];
const UPDATE_FIELDS = ['clientId', 'daysUntilDue', 'lineItems'];
const LINE_ITEM_FIELDS = ['description', 'quantity', 'unitAmountMinor'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Plan §3.2's error taxonomy, mapped by error class — never by message text.
 *
 * THIS DELIBERATELY DIFFERS FROM routes/connect.js IN ONE PLACE, and the
 * difference is load-bearing: ValidationError is 400 here and 502 there. On the
 * connect routes a repository refusal means STRIPE sent us something malformed;
 * on these routes it means the FREELANCER'S FORM did. A shared statusFor would
 * have to pick one and be wrong on the other half of the app, so the two stay
 * separate — read them together when either changes.
 *
 * 403 vs 409 is deliberate too: the readiness gate is a permission the
 * freelancer does not yet have, while InvalidStateError and AmountMismatchError
 * are the resource's own state. Distinct status, distinct class, distinct step.
 */
function statusFor(err) {
  // Not connected, or connected but not ready to issue (lifecycle's gate).
  if (err instanceof AccountNotReadyError) return 403;
  // Unknown freelancer, invoice or client — or one owned by someone else, which
  // AS-39 answers as not-found on purpose.
  if (err instanceof NotFoundError) return 404;
  // Stripe finalized something that disagrees with our line items (plan §3.7).
  if (err instanceof AmountMismatchError) return 409;
  // The resource is in the wrong state for this operation — editing a draft
  // that is already attached to Stripe, most of all.
  if (err instanceof InvalidStateError) return 409;
  // A malformed form: a bad line item, a non-positive count, an unknown field.
  if (err instanceof ValidationError) return 400;
  // Stripe key unconfigured (the client's requireKey step): a deploy problem.
  if (err instanceof ConfigError) return 503;
  // Unreachable in normal operation — these routes compose only allowlisted,
  // connected-scope calls. If it fires, something is genuinely wrong: be loud.
  if (err instanceof StripeCustodyError) return 500;
  // Stripe answered with an error, or did not answer usably.
  if (err instanceof StripeApiError || err instanceof StripeTransportError) return 502;
  // The mapper met an invoice shape it does not understand (plan §3.6).
  if (err instanceof TypeError) return 502;
  // A body-parser refusal (too large, too many parameters) carries its own
  // status. Checked LAST of the mapped cases: the Stripe error classes above
  // also carry a `status`, and theirs is Stripe's, not ours.
  if (Number.isInteger(err?.status)) return err.status;
  return 500;
}

/** Digits only, then Number — see DIGITS. */
function integerField(raw, field) {
  if (typeof raw !== 'string' || !DIGITS.test(raw)) throw new ValidationError(field, 'must be a whole number');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new ValidationError(field, 'is too large');
  return value;
}

/** A form field arrives as a string; anything else means a repeated or nested
 *  parameter, which is nobody's valid input. Blankness is AS-39's assertText. */
function textField(raw, field) {
  if (typeof raw !== 'string') throw new ValidationError(field, 'must be a single text value');
  return raw;
}

function assertKnownFields(body, allowed, field) {
  if (!isObject(body)) throw new ValidationError(field, 'must be a form-encoded body');
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) throw new ValidationError(`${field}.${key}`, `unknown field; known: ${allowed.join(', ')}`);
  }
}

/**
 * `lineItems` MUST BE NORMALISED, not trusted to arrive as an array. qs turns a
 * bracket set into a real array only below its array limit; past it — and for
 * any sparse or high index — it yields a plain object keyed by numeric strings.
 * The exact index where that happens is a library default this app refuses to
 * depend on, so both shapes are accepted, sorted by numeric key, and a
 * non-contiguous set is refused. A 25-item request is a test case for exactly
 * this reason (plan §3.3, R5).
 */
function normaliseLineItems(raw) {
  let entries;
  if (Array.isArray(raw)) {
    entries = raw.map((item, index) => [index, item]);
  } else if (isObject(raw)) {
    entries = Object.entries(raw).map(([key, item]) => {
      if (!DIGITS.test(key)) throw new ValidationError(`lineItems[${key}]`, 'must be indexed by whole numbers');
      return [Number(key), item];
    });
    entries.sort((a, b) => a[0] - b[0]);
  } else {
    throw new ValidationError('lineItems', 'must be a list of line items');
  }
  if (entries.length === 0) throw new ValidationError('lineItems', 'must be a non-empty list');
  if (entries.length > MAX_LINE_ITEMS) {
    throw new ValidationError('lineItems', `must be at most ${MAX_LINE_ITEMS} items, got ${entries.length}`);
  }
  return entries.map(([index, item], position) => {
    if (index !== position) throw new ValidationError('lineItems', 'must be indexed contiguously from 0');
    const field = `lineItems[${position}]`;
    assertKnownFields(item, LINE_ITEM_FIELDS, field);
    return {
      description: textField(item.description, `${field}.description`),
      quantity: integerField(item.quantity, `${field}.quantity`),
      unitAmountMinor: integerField(item.unitAmountMinor, `${field}.unitAmountMinor`),
    };
  });
}

function draftInput(body) {
  assertKnownFields(body, CREATE_FIELDS, 'invoice');
  const input = {
    clientId: textField(body.clientId, 'clientId'),
    daysUntilDue: integerField(body.daysUntilDue, 'daysUntilDue'),
    lineItems: normaliseLineItems(body.lineItems),
  };
  // Absent means AS-39's default; present is validated against its one
  // supported set, in lib/db/money.js and nowhere else.
  if (body.currency !== undefined) input.currency = textField(body.currency, 'currency');
  return input;
}

function draftPatch(body) {
  assertKnownFields(body, UPDATE_FIELDS, 'invoice');
  const patch = {};
  if (body.clientId !== undefined) patch.clientId = textField(body.clientId, 'clientId');
  if (body.daysUntilDue !== undefined) patch.daysUntilDue = integerField(body.daysUntilDue, 'daysUntilDue');
  // Replaced as a SET, never merged: AS-39 renumbers positions from 0.
  if (body.lineItems !== undefined) patch.lineItems = normaliseLineItems(body.lineItems);
  return patch;
}

/** Redirect targets carry ?freelancer= so the screens that will own them
 *  inherit the same interim seam. Constructed, never concatenated raw. */
const query = (freelancerId) => `?freelancer=${encodeURIComponent(freelancerId)}`;
const editPath = (id, freelancerId) => `/invoices/${encodeURIComponent(id)}/edit${query(freelancerId)}`;
const detailPath = (id, freelancerId) => `/invoices/${encodeURIComponent(id)}${query(freelancerId)}`;

/**
 * @param {object} config frozen settings from lib/config.js. Nothing here reads
 *   one today — the redirect targets are app-relative — but the signature
 *   matches connectRoutes so both mount lines in app.js read alike.
 * @param {{ repos: object, stripe: object }} deps built in server.js / withServer
 */
export function invoiceRoutes(config, { repos, stripe }) {
  const lifecycle = createInvoiceLifecycle({ repos, stripe });
  const router = Router();

  // MOUNTED PER ROUTE, NOT APP-WIDE, and the first reason is the important one:
  // AS-44 must see the RAW request body to verify Stripe's webhook signature,
  // and an app-wide body parser is the classic way to break that, discovered
  // late. Per-route leaves /webhook untouched by construction, and keeps the
  // parsed surface to exactly these four handlers. It adds no package: express
  // 5 bundles body-parser, and qs is already in the tree.
  const form = express.urlencoded({ extended: true, limit: '64kb', parameterLimit: 500 });

  const fail = (res, step, err) => {
    res.status(statusFor(err)).type('text/plain').send(`${err?.name ?? 'Error'}: ${err?.step ?? step}\n`);
  };

  const handle = (step, act) => async (req, res) => {
    const freelancerId = resolveFreelancerId(req);
    if (freelancerId === null) {
      return res.status(400).type('text/plain').send('missing freelancer parameter\n');
    }
    try {
      res.redirect(303, await act(freelancerId, req));
    } catch (err) {
      fail(res, step, err);
    }
  };

  // Zero Stripe calls: a draft is local until the freelancer issues it.
  router.post('/invoices', form, handle('create-draft', (freelancerId, req) => {
    const invoice = repos.invoices.createDraft(freelancerId, draftInput(req.body ?? {}));
    return editPath(invoice.id, freelancerId);
  }));

  // Zero Stripe calls, and 409 once the draft is attached: AS-39 freezes the
  // local copy the moment finalization starts, and this surfaces that freeze.
  router.post('/invoices/:id', form, handle('update-draft', (freelancerId, req) => {
    const invoice = repos.invoices.updateDraft(freelancerId, req.params.id, draftPatch(req.body ?? {}));
    return editPath(invoice.id, freelancerId);
  }));

  // The readiness gate, then the pipeline through step 4.
  router.post('/invoices/:id/finalize', form, handle('finalize', async (freelancerId, req) => {
    const invoice = await lifecycle.finalize(freelancerId, req.params.id);
    return detailPath(invoice.id, freelancerId);
  }));

  // The same pipeline, not stopping early: AS-46's one "Finalize & send" button
  // posts here, and every step already done is skipped.
  router.post('/invoices/:id/send', form, handle('send', async (freelancerId, req) => {
    const invoice = await lifecycle.send(freelancerId, req.params.id);
    return detailPath(invoice.id, freelancerId);
  }));

  // A body-parser refusal (too large, too many parameters) never reaches a
  // handler, so it needs its own landing: same one-line text/plain shape as
  // every other failure on these routes, carrying the parser's own status.
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    fail(res, 'parse-body', err);
  });

  return router;
}
