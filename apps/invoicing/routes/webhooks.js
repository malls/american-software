// routes/webhooks.js — chain link 6, the state-sync half: one POST that takes a
// signed Stripe event and applies it to the mirror (AS-44, plan §3.3).
//
// THIN BY TEST, like routes/connect.js and routes/invoices.js: verification
// lives in lib/webhooks/signature.js, dispatch lives in lib/webhooks/receiver.js,
// and this file only reads the raw request, turns an envelope into an object,
// and maps an outcome or an error class to a status.
//
// IT TAKES NO `stripe` DEPENDENCY, and that absence is the structural proof of
// the zero-calls property: a Stripe call cannot be added here without changing
// this function's signature and the mount line in app.js. This is the first
// Stripe-touching feature in the app that makes NO Stripe calls at all, which
// is why it adds no allowlist row and does not touch lib/stripe/custody.js —
// and why a deployment with no API key configured can still receive and apply
// events.
//
// THE PATH IS CONFIGURED IN A THIRD PARTY'S SYSTEM — Stripe's endpoint
// configuration, and AS-50's `stripe listen --forward-to`. That is what makes
// it expensive to rename later in a way an internal route is not, and why it
// names its sender rather than being called /hook.
import express, { Router } from 'express';
import { SignatureError, verifyStripeSignature } from '../lib/webhooks/signature.js';
import { createWebhookReceiver } from '../lib/webhooks/receiver.js';

/** A body that VERIFIES but is not an event envelope. That combination means
 *  the signing secret is being used to sign something that is not a Stripe
 *  event, which is a bad request no retry can fix — 400, and no ledger row.
 *  Distinct from a well-formed envelope carrying an object shape we do not
 *  understand, which is a Stripe-side surprise and deliberately a 500. */
export class WebhookEventError extends Error {
  constructor(reason) {
    super(`webhook envelope rejected: ${reason}`);
    this.name = 'WebhookEventError';
    this.reason = reason;
    this.step = 'parse-event';
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Bytes -> a Stripe event envelope, AFTER the signature has been verified.
 *
 * Only the four fields the receiver reads are checked, and each is checked for
 * the shape it is used as: `id` keys the ledger (and AS-39's DDL and its
 * assertStripeId both require the prefix, so refusing it here makes the failure
 * a 400 instead of a 500), `type` selects the handler, `created` is the ONE
 * clock reading this feature trusts, and `data.object` is what the mappers map.
 * Nothing about `data.object` itself is validated here — that is the mappers'
 * job, and their refusal is a different status on purpose.
 */
function parseEvent(raw) {
  let event;
  try {
    // The bytes were hashed before this line, never after: stringifying here
    // cannot affect what was verified.
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new WebhookEventError('not_json');
  }
  if (!isObject(event)) throw new WebhookEventError('not_an_object');
  if (typeof event.id !== 'string' || !event.id.startsWith('evt_')) throw new WebhookEventError('no_event_id');
  if (typeof event.type !== 'string' || event.type === '') throw new WebhookEventError('no_type');
  if (!Number.isSafeInteger(event.created)) throw new WebhookEventError('no_created');
  if (!isObject(event.data) || !isObject(event.data.object)) throw new WebhookEventError('no_object');
  return event;
}

/**
 * THE THIRD `statusFor` IN THIS APP, and the difference is load-bearing again.
 * A repository or mapper refusal is 400 in routes/invoices.js (a freelancer's
 * form sent it), 502 in routes/connect.js (Stripe answered a call of OURS with
 * it), and 500 here — Stripe PUSHED us a shape we do not understand, on a
 * request that was already authenticated by its signature. Read the three
 * together when any one changes; do not merge them.
 *
 * The 500 is deliberate and its cost is accepted rather than discovered later:
 * Stripe retries a 5xx for up to three days and can disable the endpoint, so an
 * event we can never process becomes a poison pill. In a v1 with one operator
 * watching, noisy beats silent — and because a failed apply never commits its
 * ledger row, a deploy that fixes the mapper gets the event redelivered and
 * applied. That recovery property is what the noise buys.
 */
function statusFor(err) {
  // Every refusal from the verifier, including a body that never reached it as
  // raw bytes. Retrying cannot fix any of them.
  if (err instanceof SignatureError) return 400;
  // Verified, but not an event.
  if (err instanceof WebhookEventError) return 400;
  // A body-parser refusal (over the size limit) carries its own status.
  if (Number.isInteger(err?.status)) return err.status;
  // A mapper or repository refusing Stripe's own object shape, and anything
  // else: loud, and redeliverable.
  return 500;
}

/**
 * @param {object} config frozen settings from lib/config.js — `webhookSecret`
 *   is the only row read, and reading it is what decides whether a route exists
 * @param {{ repos: object }} deps repos from createRepositories(db)
 */
export function webhookRoutes(config, { repos }) {
  const router = Router();

  // AN UNSET SIGNING SECRET MEANS THE ENDPOINT DOES NOT EXIST — 404 from
  // express, not "reject everything" (plan §3.3.1). The secret is minted
  // locally by `stripe listen --print-secret` at run time and is not part of
  // the board's handover, so unconfigured is the NORMAL state of this
  // repository, of every test run and of every developer's stack — not an
  // error. Four reasons, in order of weight:
  //
  //  1. It REMOVES the surface instead of defending it. "Reject everything"
  //     leaves a live unauthenticated POST that still buffers up to a megabyte
  //     and hashes attacker-controlled bytes for anyone who asks. Absent means
  //     no handler closure is ever created: there is no work to provoke.
  //  2. It makes the property STRUCTURAL rather than procedural. There is no
  //     code path from an unconfigured deployment to the database — not one
  //     that returns early, one that does not exist. A reviewer checks it by
  //     reading these four lines.
  //  3. It leaks nothing: a prober gets what any unknown path gives, which is
  //     what a machine not running this app gives.
  //  4. The operator still gets an unambiguous signal, on the AUTHENTICATED
  //     side: the startup line and /healthz both already print the setting as
  //     null through config.redacted(), with no code change here.
  //
  // WHAT THIS DOES NOT MEAN, flagged for AS-50: it does not make webhooks
  // optional. A deployment with no secret silently receives nothing, so the run
  // record must show the signing secret in place BEFORE the run, and the first
  // thing to check when no event lands is that boot line.
  if (config.webhookSecret === null) return router;

  const receiver = createWebhookReceiver({ repos });

  // type '*/*' ON PURPOSE. Stripe sends application/json, which a narrower
  // matcher would also catch — but then a request with a different or absent
  // content-type would leave the body unparsed and the failure would present as
  // "empty payload" rather than as what it is. Matching everything means the
  // bytes are always captured and the only failure left is a signature failure.
  // The 1 MB limit is the bounded-work half of the DoS answer: no database work
  // happens before verification, so a forged request costs one bounded hash.
  const rawBody = express.raw({ type: '*/*', limit: '1mb' });

  router.post('/webhooks/stripe', rawBody, (req, res) => {
    try {
      // THE BUFFER GUARD. Its purpose is to catch an upstream parser — which
      // can only be introduced in app.js or in this file, both of which the
      // `body parser` row in test/dependency-policy.test.js pins — so the
      // property has a runtime witness (this 400) and a static witness (a red
      // test). It also answers the no-content-type case, where nothing matched
      // and the body was never read.
      if (!Buffer.isBuffer(req.body)) throw new SignatureError('not_raw');
      // ORDER: verify, THEN parse, THEN dispatch. Nothing about the event —
      // not its type, not its id — is read before the signature is checked.
      verifyStripeSignature({
        payload: req.body,
        header: req.get('stripe-signature'),
        secret: config.webhookSecret,
        nowMs: Date.now(),
      });
      const { outcome } = receiver.receive(parseEvent(req.body));
      // WE ANSWER AFTER THE WORK IS DURABLE. Stripe's advice to acknowledge
      // first and process later exists for handlers that do slow I/O; this one
      // does a few synchronous writes and no network call. Answering after buys
      // the property that matters: a 2xx from this endpoint means the event is
      // durably resolved, so Stripe's retry IS our recovery mechanism and we
      // owe it no queue. The trigger to revisit is the first handler that does
      // I/O. One line, and genuinely useful in `stripe listen`'s console during
      // AS-50 — visible only to someone holding the signing secret.
      res.status(200).type('text/plain').send(`ok: ${outcome}\n`);
    } catch (err) {
      fail(res, 'receive', err);
    }
  });

  // A body-parser refusal never reaches the handler, so it needs its own
  // landing — the routes/invoices.js precedent, same one-line shape.
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    fail(res, 'parse-body', err);
  });

  return router;
}

/** The house one-liner: the error class and the step that failed, never the
 *  signing secret, never a digest, never request material. */
function fail(res, step, err) {
  res.status(statusFor(err)).type('text/plain').send(`${err?.name ?? 'Error'}: ${err?.step ?? step}\n`);
}
