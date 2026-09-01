// app.js — the composition root (AS-37, plan §3.3a, §3.3b).
//
// createApp(config) returns a configured Express app and NEVER listens; that is
// server.js's one job. Two consequences the plan asks for explicitly:
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
import { healthRoutes } from './routes/health.js';
import { pageRoutes } from './routes/pages.js';

/**
 * @param {object} config frozen settings from lib/config.js
 * @returns {import('express').Express}
 */
export function createApp(config) {
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
  // 4. App-owned static files last. express.static rather than chat's
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
