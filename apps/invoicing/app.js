// app.js — the composition root (AS-37, plan §3.3a, §3.3b; AS-41, plan §3.7).
//
// createApp(config, { repos, stripe }) returns a configured Express app and
// NEVER listens; that is server.js's one job. Both dependencies are REQUIRED:
// an app that cannot serve its routes must fail to construct — a TypeError
// here, in the spirit of config's fail-at-boot rule — never a hidden
// "routes mount but 503" switch. server.js and test/helpers/server.js are the
// two places that build the pair (AS-39 §2.8's recommended shape, delivered by
// its first consumer with `stripe` alongside `repos`).
//
// Two consequences the AS-37 plan asks for explicitly:
//
//  * This file never reads process.env. Settings arrive as an argument, so every
//    test constructs an app with injected paths and no test mutates the
//    environment — which is what makes the health check's failure paths
//    testable at all.
//  * Route handlers live in routes/<area>.js, not here. The stack decision's
//    most load-bearing finding is that hand-rolled rendering leaves module
//    boundaries to discipline, and this company has two measured observations of
//    that discipline not holding (apps/chat/public/app.js at 46,868 bytes; the
//    C1 spike's render.js). The boundary is free now and expensive at AS-45.
//
// NOTE ON THE NAME: this is a ~50-line composition root. It has nothing to do
// with apps/chat's public/app.js, which is a browser bundle.
//
// No module-level state lives here or anywhere in the app: AS-39 must be able
// to add a data-access module without unpicking the scaffold (plan §11 item 6).
import express from 'express';
import { createAccounts } from './lib/auth/accounts.js';
import { loadSession, requireSameOrigin, requireSession } from './lib/auth/guard.js';
import { assetRoutes } from './routes/assets.js';
import { publicAuthRoutes, sessionAuthRoutes } from './routes/auth.js';
import { connectRoutes } from './routes/connect.js';
import { healthRoutes } from './routes/health.js';
import { invoiceRoutes } from './routes/invoices.js';
import { pageRoutes } from './routes/pages.js';
import { webhookRoutes } from './routes/webhooks.js';

/**
 * @param {object} config frozen settings from lib/config.js
 * @param {{ repos: object, stripe: object }} deps repos from
 *   createRepositories(db); stripe from createStripeClient({ apiKey:
 *   config.stripeSecretKey }). Both required (AS-41, plan §3.7).
 * @returns {import('express').Express}
 */
export function createApp(config, deps) {
  const { repos, stripe } = deps ?? {};
  if (repos === undefined || repos === null) {
    throw new TypeError('createApp: deps.repos is required — build it with createRepositories(db)');
  }
  if (stripe === undefined || stripe === null) {
    throw new TypeError('createApp: deps.stripe is required — build it with createStripeClient({ apiKey: config.stripeSecretKey })');
  }
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', config.viewsDir);
  // No x-powered-by. Nothing depends on it and it is free to drop.
  app.disable('x-powered-by');

  // The accounts service is built HERE, from repos, exactly as connectRoutes
  // builds createOnboarding inside itself — so server.js keeps both its
  // arguments and its arity and no new dependency reaches the entrypoint.
  const accounts = createAccounts({ repos });

  // ORDER IS LOAD-BEARING, AND SINCE AS-40 IT IS A SECURITY BOUNDARY.
  // Everything above the banner below is PUBLIC, and each member is public for
  // a stated reason. Everything below it requires a session.
  //
  // Placement alone would be a promise, so the property is asserted three
  // independent ways (plan §3.5): this order, the router-tree enumeration in
  // test/auth.test.js — which drives a real cookieless request at EVERY route
  // in the protected partition — and actingFreelancerId, which throws rather
  // than let a guarded handler act as nobody.
  //
  // 1. /healthz first: it must answer even when a later precondition is broken,
  //    and compose's healthcheck sends no cookie.
  app.use(healthRoutes(config));
  // 2. The Stripe webhook receiver (AS-44), before every other router: nothing
  //    ahead of it may parse a body, and putting it here makes that property
  //    visible in eight lines instead of eighty. Exact path, shadows nothing;
  //    absent entirely when no signing secret is configured.
  //    IT MUST STAY ABOVE THE TWO MIDDLEWARES BELOW. It is authenticated BY ITS
  //    HMAC SIGNATURE over the raw body, by Stripe's server — which sends no
  //    cookie and no Origin, and must not have to. Below loadSession it would
  //    redirect to sign-in; below requireSameOrigin every delivery would 403.
  app.use(webhookRoutes(config, { repos }));
  // 3. Who is asking, if anyone. NEVER rejects, and reads only the cookie
  //    header — never a body.
  app.use(loadSession(accounts));
  // 4. The CSRF defence on unsafe methods (plan §3.6). Mounted above the public
  //    POSTs too, which is what closes login CSRF.
  app.use(requireSameOrigin(config));
  // 5. Vendored assets by explicit named route, BEFORE any directory serving,
  //    so a stray file in public/ can never shadow one (plan §3.3d).
  app.use(assetRoutes(config));
  // 6. App-owned static files. MOVED ABOVE THE BOUNDARY BY AS-40: below it,
  //    every stylesheet request from a signed-out browser would redirect to
  //    sign-in — and the sign-in page is served to signed-out browsers by
  //    definition. The anti-shadowing property is preserved (assetRoutes still
  //    precedes it), and the new risk the move introduces — a file in public/
  //    shadowing a registered route path — is closed by an assertion in
  //    test/auth.test.js.
  //    A CONSEQUENCE TO STATE RATHER THAN LEAVE IMPLICIT: public/ is
  //    world-readable without a session. Nothing per-user may ever be written
  //    there.
  //    express.static rather than chat's STATIC_FILES allowlist: the
  //    allowlist's failure mode is a two-edit change where the second edit is
  //    forgotten, which is exactly AS-17. This has no second edit, and its own
  //    failure mode (a file lands here and is served, or public/ is not COPY'd
  //    and everything 404s) is closed by test/assets.test.js (plan §3.3c).
  app.use(
    express.static(config.publicDir, {
      index: false,
      redirect: false,
      dotfiles: 'ignore',
    }),
  );
  // 7. Sign-up and sign-in, AND NOTHING ELSE: they are public by definition,
  //    being how a caller with no session gets one. POST /signout is NOT in
  //    this router — routes/auth.js exports a second one for it, mounted below
  //    the boundary, because one Express router cannot sit on both sides of a
  //    middleware.
  app.use(publicAuthRoutes(config, { repos, accounts }));

  // ─── THE AUTH BOUNDARY ──────────────────────────────────────────────────────
  // Everything below requires a session. A router added below this line is
  // protected without its author doing anything; a router added ABOVE it
  // changes the committed route partition in test/auth.test.js and turns that
  // suite red until its author classifies it in writing.
  app.use(requireSession(config));

  // 8. Sign-out, the guarded half of routes/auth.js. Mounted HERE rather than
  //    with its siblings so that its protection is the same mechanism as every
  //    other protected route's — position, not per-route middleware — which is
  //    what keeps the sentence above a complete description of what is guarded.
  //    An anonymous POST /signout is answered by requireSession (303 to
  //    /signin, NO Set-Cookie); the handler never runs.
  app.use(sessionAuthRoutes(config, { repos, accounts }));
  // 9. Pages.
  app.use(pageRoutes(config));
  // 10. Stripe Connect onboarding (AS-41): the three routes are exact paths
  //    under /connect-stripe/ and shadow nothing. Stripe's return is a
  //    top-level GET navigation and carries the session cookie under
  //    SameSite=Lax — which is why the cookie is Lax and not Strict.
  app.use(connectRoutes(config, { repos, stripe }));
  // 11. Invoice lifecycle (AS-43): draft, edit, finalize, send. Exact paths
  //     under /invoices/ that shadow nothing; its body parser is mounted per
  //     route inside that router, never here, so AS-44's webhook keeps its raw
  //     request body by construction.
  app.use(invoiceRoutes(config, { repos, stripe }));

  return app;
}
