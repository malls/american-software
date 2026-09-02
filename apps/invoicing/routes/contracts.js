// routes/contracts.js — chain link 3, server side: generate a contract from a
// declared template and store it (AS-42, plan §3.4, §3.7).
//
// EXACTLY ONE ROUTE, and the absence of the others is the design. There is no
// POST /contracts/:id, no PATCH, no DELETE, and no handler whose job is to say
// "no": a contract is immutable, the schema enforces it (no updated_at, no
// update method, no draft state), and a route added to state a prohibition is
// still a route — it must be classified in the committed partition in
// test/auth.test.js, driven by that suite's cookieless probe, and maintained.
// Absence states it for free, and is pinned by test/auth.test.js's committed
// route list, by the repository exposing no update method, and by a case in
// test/contracts.test.js. A freelancer who made a mistake generates a new
// contract with the corrected values; v1 never delivers a contract, so the
// superseded row is one nobody outside their account has seen.
//
// NO GET ROUTES. The create and detail screens are AS-47's, per the screen
// budget. The redirect target 404s until they land, which is this codebase's
// established idiom rather than a gap — the Location header is the contract,
// asserted without dereferencing it.
//
// THE ERROR TAXONOMY IS SHORTER THAN routes/invoices.js's ON PURPOSE. That file
// maps seven more classes; every one of them is unreachable from a path that
// makes no external call and has no state machine to be in the wrong state of.
// They are NOT copied across for symmetry: an unreachable mapping is a dead
// branch that reads like a considered decision and is not one. If one of them
// ever surfaces here it will be a loud 500, which is the correct answer to
// something that cannot happen.
import express, { Router } from 'express';
import { NotFoundError, ValidationError } from '../lib/db/database.js';
import { createContractGeneration } from '../lib/contracts/generation.js';
import { actingFreelancerId } from '../lib/auth/guard.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Mapped by error class, never by message text — routes/invoices.js's rule. */
function statusFor(err) {
  // Unknown template; unknown client; or a client owned by someone else, which
  // answers IDENTICALLY to one that does not exist. "This id exists but isn't
  // yours" leaks more than confirming nothing.
  if (err instanceof NotFoundError) return 404;
  // A missing required value, an over-long one, a malformed date, an unknown
  // field, or a record-sourced name supplied as a form value.
  if (err instanceof ValidationError) return 400;
  // A body-parser refusal carries its own status. Checked LAST of the mapped
  // cases, per the routes/invoices.js comment.
  if (Number.isInteger(err?.status)) return err.status;
  return 500;
}

/** This router's own two fields; every other key is the template's business and
 *  is checked against the DECLARATION in lib/contracts/generation.js. There is
 *  deliberately no field allowlist here — a second one could drift from the
 *  declaration, and then a template change would need two edits. */
function contractInput(body) {
  if (!isObject(body)) throw new ValidationError('contract', 'must be a form-encoded body');
  const { clientId, templateId, ...formValues } = body;
  if (typeof clientId !== 'string') throw new ValidationError('clientId', 'must be a single text value');
  if (templateId !== undefined && typeof templateId !== 'string') {
    throw new ValidationError('templateId', 'must be a single text value');
  }
  return { clientId, templateId, formValues };
}

/** App-relative and carrying no identity: the screen that will own it reads the
 *  session, exactly as this handler does. */
const detailPath = (id) => `/contracts/${encodeURIComponent(id)}`;

/**
 * @param {object} config frozen settings from lib/config.js. Nothing here reads
 *   one today — the redirect target is app-relative — but the signature matches
 *   invoiceRoutes and connectRoutes so every mount line in app.js reads alike.
 * @param {{ repos: object }} deps repos alone. This router takes no second
 *   dependency, and that is asserted rather than left to the eye.
 */
export function contractRoutes(config, { repos }) {
  const generation = createContractGeneration({ repos });
  const router = Router();

  // MOUNTED PER ROUTE, NOT APP-WIDE — the webhook receiver must see the RAW
  // request body, and an app-wide parser is the classic way to break that,
  // discovered late. `extended: false` because this form has no nested
  // structure, which keeps the parsed surface as small as it can be.
  const form = express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 20 });

  const fail = (res, step, err) => {
    res.status(statusFor(err)).type('text/plain').send(`${err?.name ?? 'Error'}: ${err?.step ?? step}\n`);
  };

  // IDENTITY HAS EXACTLY ONE SOURCE. This handler reads no query string, no
  // body field and no header for it. actingFreelancerId throws rather than act
  // as nobody, so a router accidentally mounted above the auth boundary is a
  // loud 500 instead of a silent action. Every read and write below is scoped
  // by that id, passed as the first argument.
  const handle = (step, act) => (req, res) => {
    const freelancerId = actingFreelancerId(req);
    try {
      res.redirect(303, act(freelancerId, req));
    } catch (err) {
      fail(res, step, err);
    }
  };

  // The ownership check is the ENGINE'S, not this route's. The contracts table
  // carries a composite foreign key to (freelancer_id, id) on clients, so a row
  // whose client belongs to a different freelancer cannot be written at all;
  // the repository re-checks inside its transaction for the friendlier error,
  // and the generation service reaches the same answer earlier still. An
  // application-level fourth check here would be a second source of truth that
  // can drift from the constraint. This route's entire ownership
  // responsibility is passing the session's id as the first argument.
  router.post('/contracts', form, handle('create', (freelancerId, req) => {
    const contract = generation.generate(freelancerId, contractInput(req.body ?? {}));
    return detailPath(contract.id);
  }));

  // A parser refusal (too large, too many parameters) never reaches a handler,
  // so it needs its own landing: the same one-line text/plain shape as every
  // other failure here, carrying the parser's own status.
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    fail(res, 'parse-body', err);
  });

  return router;
}
