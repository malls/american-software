// routes/clients.js — the one way a client comes into existence (AS-65, plan
// §3.1, §3.7).
//
// EXACTLY ONE ROUTE, AND IT IS SHARED. Two screens create clients inline — the
// invoice draft (AS-46) and the contract form (AS-47) — and both post HERE.
// There is no POST /invoices/:id/clients and no nested create inside either of
// those handlers: a nested create makes a client a side effect of a different
// resource, so a parent that fails validation after its client was written
// leaves a row the freelancer never asked for and cannot see (the screen budget
// cut the Clients screen, so there is nowhere to see it).
//
// A REPEAT SUBMISSION CREATES A SECOND ROW. This endpoint never converges on an
// existing client and has no upsert mode. The schema declined to make email
// unique on purpose — a duplicate is a NON-BLOCKING warning on the screens,
// which offer both "use that one instead" and "create a new one anyway",
// because two contacts legitimately share an inbox. Converging here would
// enforce a uniqueness rule in application code over a column the schema left
// non-unique, and it would make "create a new one anyway" unreachable. The
// screens read the duplicate warning themselves and decide; this endpoint's
// contract to them is that posting creates the row.
//
// THE ERROR TAXONOMY IS SHORTER THAN routes/contracts.js's, WHICH IS ITSELF
// SHORTER THAN routes/invoices.js's. NotFoundError, InvalidStateError,
// UniqueViolationError, ForeignKeyViolationError and every payment-processor
// class are deliberately NOT mapped: none is reachable from a path that makes
// no external call, has no state machine, and inserts into a table whose only
// foreign key target is guaranteed by the session itself. They are not copied
// across for symmetry — an unreachable mapping is a dead branch that reads like
// a considered decision and is not one. If one ever fires it is a loud 500,
// which is the correct answer to something that cannot happen.
//
// NO GET ROUTES, NO VIEW, NO TEMPLATE. The screens are AS-46's and AS-47's. The
// Location header is the contract, asserted without dereferencing it.
import express, { Router } from 'express';
import { ValidationError } from '../lib/db/database.js';
import { actingFreelancerId, safeNext } from '../lib/auth/guard.js';

/** The query parameter the redirect carries the new id back in. It is spelled
 *  exactly as the form field both consumers already accept (routes/contracts.js
 *  contractInput, routes/invoices.js CREATE_FIELDS), so the screen re-renders
 *  its picker pre-selected on a value it already knows how to spell. */
const CREATED_PARAM = 'clientId';

/** Mapped by error class, never by message text — routes/invoices.js's rule.
 *  Three cases, and the omissions above are the decision. */
function statusFor(err) {
  // A missing or blank name or email, an unknown body field, or a return path
  // this app refuses to redirect to.
  if (err instanceof ValidationError) return 400;
  // A body-parser refusal carries its own status. Checked LAST of the mapped
  // cases, per the routes/invoices.js comment.
  if (Number.isInteger(err?.status)) return err.status;
  return 500;
}

/**
 * Compose the redirect target from the caller's validated return path.
 *
 * THIS FUNCTION IS NOT A SAFETY LAYER. It is the step the output check below
 * exists for, and the note that stood here — "taking pathname + search + hash
 * back off means this cannot emit an absolute URL" — was true of the word
 * ABSOLUTE and false of the property this route actually promises, which is
 * APP-RELATIVE.
 *
 * `new URL(...)` performs RFC 3986 §5.2.4 dot-segment removal. That decision is
 * made on the RAW reference, so `/.//evil.test` is path-absolute and stays on
 * this app's origin when it is emitted as it arrived — and safeNext therefore
 * accepts it, correctly. Parsing it and reading `.pathname` back off yields
 * `//evil.test`, which re-emitted standalone IS a network-path reference and
 * sends the freelancer, and the id just minted for them, to somebody else's
 * host. The escape was not in the input; composition manufactured it.
 *
 * So nothing this returns is trusted. The caller re-validates the exact string
 * it is about to write to the header, with the same predicate that accepted the
 * input. What is preserved deliberately: the caller's own query, which is how
 * the screens carry a half-filled form across the round trip.
 */
function landing(returnPath, id) {
  const url = new URL(returnPath, 'http://placeholder.invalid');
  url.searchParams.set(CREATED_PARAM, id);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * @param {object} config frozen settings from lib/config.js. Nothing here reads
 *   one — the redirect target is app-relative — but the signature matches
 *   contractRoutes and invoiceRoutes so every mount line in app.js reads alike.
 * @param {{ repos: object }} deps repos alone, like contractRoutes and for the
 *   same reason: creating a client makes no external call at all.
 */
export function clientRoutes(config, { repos }) {
  const router = Router();

  // MOUNTED PER ROUTE, NOT APP-WIDE — the webhook receiver must see the RAW
  // request body, and an app-wide parser is the classic way to break that.
  // `extended: false` because this form is three flat fields with no nested
  // structure. The limits are byte-identical to routes/contracts.js's rather
  // than a third set of magic numbers.
  const form = express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 20 });

  const fail = (res, step, err) => {
    res.status(statusFor(err)).type('text/plain').send(`${err?.name ?? 'Error'}: ${err?.step ?? step}\n`);
  };

  // IDENTITY HAS EXACTLY ONE SOURCE. This handler reads no query string, no
  // body field and no header for it. actingFreelancerId throws rather than act
  // as nobody, so a router accidentally mounted above the auth boundary is a
  // loud 500 instead of a silent action. That single argument is this route's
  // ENTIRE ownership responsibility: the row's only foreign key points at the
  // session's own freelancer, and the composite UNIQUE (freelancer_id, id) the
  // contracts and invoices tables reference is what makes the id minted here
  // inert for everybody else.
  router.post('/clients', form, (req, res) => {
    const freelancerId = actingFreelancerId(req);
    try {
      // `next` is the ROUTER'S field, not the client's, so it is split out
      // before the repository sees the body — otherwise its allowlist would
      // reject it. There is deliberately no second field allowlist here: the
      // repository's is the allowlist, and a route-level copy could drift from
      // it. A body carrying `phone` reaches the repository and comes back a 400.
      const { next, ...fields } = req.body ?? {};
      // VALIDATED BEFORE THE INSERT, so a malformed request leaves no row.
      // Required rather than defaulted — this is the one place this route
      // diverges from the routes/auth.js precedent, and the reason is that
      // sign-in has a meaningful default landing while client creation has
      // none: falling back to `/` would silently discard the invoice or
      // contract the freelancer was in the middle of. An absent or refused
      // value is a CALLER bug, never a freelancer-reachable state.
      const returnPath = safeNext(next);
      if (returnPath === null) {
        throw new ValidationError('next', 'must be a single app-relative path this app will redirect to');
      }
      const client = repos.clients.create(freelancerId, fields);
      // CHECK 2 — VALIDATION IS THE LAST STEP BEFORE EMISSION, NOT THE FIRST
      // STEP AFTER PARSING. The bytes written to Location must be the exact
      // bytes a validator last accepted, so the composed string is re-checked
      // by the SAME predicate, on the exact value that reaches the header.
      //
      // The two calls are two different jobs, and neither substitutes for the
      // other. Check 1 is the INPUT contract: an absent or refused `next` is a
      // caller bug and leaves no row. Check 2 is the SECURITY guarantee:
      // safeNext-clean means one leading slash, no `://` and no control
      // character, hence path-absolute per RFC 3986 §4.2, hence resolved
      // against this app's own origin — always, whatever composition did.
      //
      // This is a CHECK and not a proof, deliberately. Reasoning that a
      // composition step "cannot weaken" an already-validated path is exactly
      // what shipped an open redirect from this file in review cycle 1; there
      // is now no inference standing between the predicate and the header.
      //
      // A REFUSAL HERE LEAVES THE ROW, and that is the accepted cost. The row
      // is exactly what was submitted, owned by the session's freelancer, and
      // no external call was made; only the return trip failed. Moving this
      // check earlier to avoid the row would move it somewhere it can no longer
      // see what is emitted, which is how the defect happened the first time.
      // Both refusals answer the same body — the taxonomy maps by class, never
      // by text — and which one fired is told apart by the row count.
      //
      // Nothing may transform this value afterwards. res.redirect delegates to
      // res.location, which runs encodeurl: it only percent-encodes, and never
      // inserts `/`, `:` or a control character, so it cannot turn a
      // path-absolute reference into a network-path one.
      const composed = landing(returnPath, client.id);
      if (safeNext(composed) === null) {
        throw new ValidationError('next', 'normalizes to a path this app will not redirect to');
      }
      res.redirect(303, composed);
    } catch (err) {
      fail(res, 'create', err);
    }
  });

  // A parser refusal (too large, too many parameters) never reaches a handler,
  // so it needs its own landing: the same one-line text/plain shape as every
  // other failure here, carrying the parser's own status.
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    fail(res, 'parse-body', err);
  });

  return router;
}
