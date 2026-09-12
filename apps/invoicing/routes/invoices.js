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
// row, not from these bodies. `/invoices/{id}/edit` is screen 4 (AS-46, in
// this file, below the API's dependencies); `/invoices/{id}` is AS-48's screen
// and 404s until it lands: the Location header is the contract, asserted
// without dereferencing it, and the gap closes in dependency order.
import express, { Router } from 'express';
import { ConfigError } from '../lib/config.js';
import { InvalidStateError, NotFoundError, ValidationError } from '../lib/db/database.js';
import { StripeApiError, StripeCustodyError, StripeTransportError } from '../lib/stripe/client.js';
import { AccountNotReadyError, AmountMismatchError, createInvoiceLifecycle } from '../lib/invoices/lifecycle.js';
// AS-40 retired the interim seam: identity is the session's, read through the
// one sanctioned accessor. This router no longer imports routes/connect.js —
// the shared identity function both of them used is gone, and with it the
// route-module-importing-a-route-module shape it required.
import { actingFreelancerId } from '../lib/auth/guard.js';
// Screen 4 (AS-46): the pure view model. The screen routes below own their own
// POSTs beside the four API routes and call the same repository and lifecycle
// functions those call; the API handlers themselves are unchanged.
import { invoiceFormLocals, parseInvoiceForm } from '../lib/screens/invoice-form-view.js';

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

/** Redirect targets are app-relative and carry no identity: the screens that
 *  will own them read the session, exactly as these handlers do. */
const editPath = (id) => `/invoices/${encodeURIComponent(id)}/edit`;
const detailPath = (id) => `/invoices/${encodeURIComponent(id)}`;

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

  // Identity comes from the session and from nothing else (AS-40): a request
  // that names another freelancer in its query string still acts as the
  // SESSION's freelancer, because nothing here reads the query string for
  // identity any more. That is asserted, not asserted-by-comment — see the
  // impersonation case in test/auth.test.js.
  const handle = (step, act) => async (req, res) => {
    const freelancerId = actingFreelancerId(req);
    try {
      res.redirect(303, await act(freelancerId, req));
    } catch (err) {
      fail(res, step, err);
    }
  };

  // ─── SCREEN 4 (AS-46, plan §3.1–§3.4) ──────────────────────────────────────
  // REGISTERED BEFORE THE API'S :id ROUTES, and the order is load-bearing:
  // express matches in registration order and `:id` matches the literal `new`,
  // so a screen route registered below `POST /invoices/:id` would never be
  // reached. Ids are randomUUID(), so no real invoice can be named `new`.
  //
  // The screen re-renders a submitted form with every value preserved (Flow 6;
  // stack decision §10.4 item 3), which the API's one-line text/plain 400
  // cannot, so it owns its own POSTs. The form has no `action`: the page's own
  // URL is the target. Every control is a submit button named `intent`,
  // dispatched here; only save, send and add-client persist anything. No
  // Stripe call on any GET, and none on any POST except intent=send.
  const VIEW = 'invoice-form';
  const render = (res, locals) => res.status(locals.status).render(VIEW, locals);
  const screen = (step, act) => async (req, res) => {
    const freelancerId = actingFreelancerId(req);
    try {
      await act(freelancerId, req, res);
    } catch (err) {
      fail(res, step, err);
    }
  };
  // `ready` is READ from the row, never re-derived here (the lifecycle's rule).
  const screenInputs = (freelancerId) => ({
    account: repos.connectedAccounts.getByFreelancer(freelancerId),
    clients: repos.clients.listByFreelancer(freelancerId),
  });
  const gatedOff = (inputs) => inputs.account === null || inputs.account.ready === false;
  // The repository's own editability rule (assertEditableDraft, unexported),
  // spelled once more here for the GET that has nothing to update: a draft is
  // editable while it is local — status draft AND no Stripe invoice attached.
  const isEditable = (invoice) => invoice.status === 'draft' && invoice.stripeInvoiceId === null;
  // A presence flag: the value is never read and never echoed (plan §3.4).
  // Express 5's default ("simple") query parser keys `?error[]=x` as
  // `error[]`, so presence is "a parameter named error in any bracket
  // spelling" — the key is tested, the value is never touched.
  const sendFailed = (req) => Object.keys(req.query ?? {}).some((key) => /^error(\[|$)/.test(key));

  router.get('/invoices/new', screen('screen-create', (freelancerId, req, res) => {
    render(res, invoiceFormLocals({ mode: 'create', ...screenInputs(freelancerId) }));
  }));

  router.get('/invoices/:id/edit', screen('screen-edit', (freelancerId, req, res) => {
    // Unknown or foreign -> NotFoundError -> the API's one-line 404 (§13 item 6).
    const draft = repos.invoices.getById(freelancerId, req.params.id);
    // Attached or finalized: the detail screen (AS-48) is where that lives, and
    // the ?error flag is dropped with the redirect.
    if (!isEditable(draft)) return res.redirect(303, detailPath(draft.id));
    render(res, invoiceFormLocals({ mode: 'edit', ...screenInputs(freelancerId), draft, sendFailed: sendFailed(req) }));
  }));

  /** One dispatch for both POSTs (plan §3.2's table). `invoiceId` is null in
   *  create mode. Every branch either renders from the body or redirects; the
   *  only writes are createDraft/updateDraft (save, send), lifecycle.send
   *  (send) and clients.create (add-client), each in exactly one place. */
  async function dispatch(freelancerId, req, res, { mode, invoiceId }) {
    if (mode === 'edit') {
      const draft = repos.invoices.getById(freelancerId, invoiceId);
      if (!isEditable(draft)) return res.redirect(303, detailPath(draft.id));
    }
    const inputs = screenInputs(freelancerId);
    const submission = parseInvoiceForm(req.body ?? {});
    const base = { mode, ...inputs, submission };
    // THE GATE BINDS POST TOO: a save from a stale tab after the account
    // stopped being ready renders the refusal and writes nothing (plan §3.4).
    if (gatedOff(inputs)) return render(res, invoiceFormLocals(base));

    switch (submission.intent) {
      case 'save':
      case 'send': {
        if (submission.draft === null) return render(res, invoiceFormLocals(base));
        let invoice;
        try {
          invoice = mode === 'edit'
            ? repos.invoices.updateDraft(freelancerId, invoiceId, submission.draft)
            : repos.invoices.createDraft(freelancerId, submission.draft);
        } catch (err) {
          // A clientId the parser accepted but the repository refused — unknown,
          // or owned by someone else — is marked exactly like an unselected one.
          if (err instanceof ValidationError || (err instanceof NotFoundError && err.entity === 'client')) {
            return render(res, invoiceFormLocals({ ...base, clientRefused: true }));
          }
          // The draft got attached between the GET and this POST.
          if (err instanceof InvalidStateError) return res.redirect(303, detailPath(invoiceId));
          throw err;
        }
        if (submission.intent === 'save') return res.redirect(303, editPath(invoice.id));
        try {
          await lifecycle.send(freelancerId, invoice.id);
        } catch (err) {
          // Not ready any more: the edit GET renders the gate from the row
          // itself, no flag needed. Anything else Stripe-shaped: the draft is
          // persisted and the DB row is the truth, so post-redirect-get with a
          // presence flag (S4-ERROR-SYSTEM) — never a re-render at
          // /invoices/new, whose retry would create a second draft.
          if (err instanceof AccountNotReadyError) return res.redirect(303, editPath(invoice.id));
          return res.redirect(303, `${editPath(invoice.id)}?error=send`);
        }
        return res.redirect(303, detailPath(invoice.id));
      }
      case 'add-client': {
        // Validates (name and email non-blank — POST /clients's exact rule),
        // warns on a case-insensitive email match unless confirmed, then
        // creates through the SAME repository call the endpoint uses. One
        // client row and nothing else is written in this request (plan §3.3).
        const { clientName, clientEmail, clientConfirm } = submission.values;
        if (clientName.trim() === '' || clientEmail.trim() === '') return render(res, invoiceFormLocals(base));
        if (!clientConfirm) {
          const matches = repos.clients.findByEmail(freelancerId, clientEmail);
          // Several matches: the first by created_at is named (plan §10 Q4).
          if (matches.length > 0) return render(res, invoiceFormLocals({ ...base, duplicate: matches[0] }));
        }
        const created = repos.clients.create(freelancerId, { name: clientName, email: clientEmail });
        return render(res, invoiceFormLocals({
          ...base,
          clients: repos.clients.listByFreelancer(freelancerId),
          createdClientId: created.id,
        }));
      }
      default:
        // add-row, new-client, existing-client: re-render from the body,
        // persisting nothing. null (absent, unknown, repeated): the closed
        // dispatch refuses, and the view model renders the refusal.
        return render(res, invoiceFormLocals(base));
    }
  }

  router.post('/invoices/new', form, screen('screen-create', (freelancerId, req, res) =>
    dispatch(freelancerId, req, res, { mode: 'create', invoiceId: null })));

  router.post('/invoices/:id/edit', form, screen('screen-edit', (freelancerId, req, res) =>
    dispatch(freelancerId, req, res, { mode: 'edit', invoiceId: req.params.id })));

  // ─── THE API (AS-43) — unchanged ────────────────────────────────────────────

  // Zero Stripe calls: a draft is local until the freelancer issues it.
  router.post('/invoices', form, handle('create-draft', (freelancerId, req) => {
    const invoice = repos.invoices.createDraft(freelancerId, draftInput(req.body ?? {}));
    return editPath(invoice.id);
  }));

  // Zero Stripe calls, and 409 once the draft is attached: AS-39 freezes the
  // local copy the moment finalization starts, and this surfaces that freeze.
  router.post('/invoices/:id', form, handle('update-draft', (freelancerId, req) => {
    const invoice = repos.invoices.updateDraft(freelancerId, req.params.id, draftPatch(req.body ?? {}));
    return editPath(invoice.id);
  }));

  // The readiness gate, then the pipeline through step 4.
  router.post('/invoices/:id/finalize', form, handle('finalize', async (freelancerId, req) => {
    const invoice = await lifecycle.finalize(freelancerId, req.params.id);
    return detailPath(invoice.id);
  }));

  // The same pipeline, not stopping early, and every step already done is
  // skipped. Screen 4's "Finalize & send" does NOT post here (AS-46 plan §3.1):
  // its intent=send calls the same lifecycle.send from the screen's own POST,
  // so a failure can land on the screen instead of on a text/plain line. This
  // route stays the programmatic path — the demo and the acceptance driver.
  router.post('/invoices/:id/send', form, handle('send', async (freelancerId, req) => {
    const invoice = await lifecycle.send(freelancerId, req.params.id);
    return detailPath(invoice.id);
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
