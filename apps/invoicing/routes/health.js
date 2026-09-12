// routes/health.js — GET /healthz (AS-37, plan §10.2).
import { Router } from 'express';
import { runHealthChecks } from '../lib/health.js';

/** @param {object} config frozen settings from lib/config.js */
export function healthRoutes(config) {
  const router = Router();

  router.get('/healthz', (req, res) => {
    const result = runHealthChecks(config);
    // 200 only if every check passes. 503 names the failing check by name, so
    // an operator reading the body knows WHICH precondition is missing.
    //
    // The body is `{ ok, checks }` and nothing else. Until AS-58 it also
    // carried `config.redacted()`; redaction held (AS-38 AC 4), but an
    // unauthenticated endpoint that enumerates setting names and non-secret
    // values (bind, port, env, which secrets are configured) tells a stranger
    // more than a health check needs to. Dropped outright rather than gated on
    // `env`: a gate is only as good as NODE_ENV being right on the public box,
    // which is the class of deploy mistake this endpoint exists to catch. The
    // operator's signal (`stripeSecretKey`/`webhookSecret` null vs
    // "[redacted]") is on the startup log line, the authenticated side.
    res.status(result.ok ? 200 : 503).json({ ok: result.ok, checks: result.checks });
  });

  return router;
}
