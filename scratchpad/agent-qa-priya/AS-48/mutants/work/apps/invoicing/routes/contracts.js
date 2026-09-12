// routes/contracts.js — chain link 3, server side: generate a contract from a
// declared template and store it (AS-42, plan §3.4, §3.7).
//
// THE ROUTE SET, and the absence of the others is the design. The API is ONE
// route, POST /contracts (AS-42). The screens (AS-47) add GET /contracts/:id —
// screen 7, the stored document rendered, printed or downloaded. There is
// still no POST /contracts/:id, no PATCH, no DELETE, and no handler whose job
// is to say "no": a contract is immutable, the schema enforces it (no
// updated_at, no update method, no draft state), and a route added to state a
// prohibition is still a route — it must be classified in the committed
// partition in test/route-surface.test.js, driven by that suite's cookieless
// probe, and maintained. Absence states it for free, and is pinned by that
// committed route list, by the repository exposing no update method, and by
// test/contracts.test.js P8's four-method probe against a real id, which keeps
// 404ing. A freelancer who made a mistake generates a new contract with the
// corrected values; v1 never delivers a contract, so the superseded row is one
// nobody outside their account has seen.
//
// THE SCREEN HANDLERS ARE NOT THROUGH handle(). That wrapper is for
// redirect-or-text/plain actions; a render has no error to map to a one-line
// body. They read the session through the same actingFreelancerId — the one
// identity source — and hand a pure view model (lib/screens/) the row and a
// boolean. A screen renders the STATE, never the request.
//
// ONE MORE GET ROUTE, AND IT IS NOT A SCREEN. `GET /contracts/view` (AS-48) is
// the Dashboard's redirector: a list row is a GET form with a hidden id and a
// CONSTANT action, because the view layer forbids an id in an href, and this
// route turns that into the detail URL. It reads no repository. The detail
// screen itself is `GET /contracts/:id`, registered AFTER it — the
// literal-before-parameter rule, or `view` is captured as an id.
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
import { contractDetailLocals } from '../lib/screens/contract-detail-view.js';
// The ONE id shape the Dashboard emits and the redirector accepts (AS-48):
// imported from the module that emits it, never re-spelled here.
import { UUID_SHAPE } from '../lib/screens/dashboard-view.js';

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

  // THE DASHBOARD'S REDIRECTOR (AS-48, plan §3.3) — REGISTERED BEFORE
  // `GET /contracts/:id`, which would otherwise capture the literal `view`.
  // A UUID-shaped id answers 303 to the detail path (bounded Location); an
  // absent, repeated, malformed or over-long id gets the router's one-line
  // 404 with no Location. No repository read: ownership is the detail
  // route's, and this must not become a second place that knows it.
  router.get('/contracts/view', (req, res) => {
    const id = req.query.id;
    if (typeof id !== 'string' || !UUID_SHAPE.test(id)) return fail(res, 'screen-view', new NotFoundError('contract'));
    res.redirect(303, detailPath(id));
  });

  // SCREEN 7 (AS-47, plan §3.3, §3.4). The read is owner-scoped by the
  // repository, which throws the SAME NotFoundError for a missing id and for
  // another freelancer's — so S7-DENIED-NOTOWNER and S7-ERROR-NOTFOUND are one
  // render by construction, and a guessed id confirms nothing. Anything else
  // the read throws (a row whose stored JSON will not parse, a database
  // failure) is 'system': fetch failed for a reason other than nonexistence.
  //
  // THE DOWNLOAD FLAG IS A PRESENCE FLAG READ AS A BOOLEAN. Exactly `?download=1`
  // is true; absent, 'true', a marker, an array — all false. The VALUE never
  // enters the view model (AS-70 decision 1's shape). On true and S7-DEFAULT
  // the same render is answered as an attachment named for THE ROW'S id — a
  // UUID this app minted, never req.params.id — with the type set explicitly
  // rather than through res.attachment(), which would derive one from the
  // extension. The header is set AFTER the lookup succeeded, so a download of
  // a missing id is the inline not-found page with no Content-Disposition.
  router.get('/contracts/:id', (req, res) => {
    const freelancerId = actingFreelancerId(req);
    let contract = null;
    let failure = null;
    try {
      contract = repos.contracts.getById(freelancerId, req.params.id);
    } catch (err) {
      failure = err instanceof NotFoundError ? 'not-found' : 'system';
    }
    const locals = contractDetailLocals({ contract, failure, isDownload: req.query.download === '1' });
    if (locals.isDownload) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="contract-${contract.id}.html"`);
    }
    res.status(failure === 'not-found' ? 404 : failure === 'system' ? 500 : 200).render('contract-detail', locals);
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
