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
import { assetRoutes } from './routes/assets.js';
import { connectRoutes } from './routes/connect.js';
import { healthRoutes } from './routes/health.js';
import { pageRoutes } from './routes/pages.js';

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

  // ORDER IS LOAD-BEARING.
  // 1. /healthz first: it must answer even when a later precondition is broken.
  app.use(healthRoutes(config));
  // 2. Vendored assets by explicit named route, BEFORE any directory serving,
  //    so a stray file in public/ can never shadow one (plan §3.3d).
  app.use(assetRoutes(config));
  // 3. Pages.
  app.use(pageRoutes(config));
  // 4. Stripe Connect onboarding (AS-41): after pages, before static — the
  //    three routes are exact paths under /connect-stripe/ and shadow nothing.
  app.use(connectRoutes(config, { repos, stripe }));
  // 5. App-owned static files last. express.static rather than chat's
  //    STATIC_FILES allowlist: the allowlist's failure mode is a two-edit change
  //    where the second edit is forgotten, which is exactly AS-17. This has no
  //    second edit, and its own failure mode (a file lands here and is served,
  //    or public/ is not COPY'd and everything 404s) is closed by the
  //    enumeration test in test/assets.test.js (plan §3.3c).
  app.use(
    express.static(config.publicDir, {
      index: false,
      redirect: false,
      dotfiles: 'ignore',
    }),
  );

  return app;
}
