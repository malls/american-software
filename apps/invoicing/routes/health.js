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
    res.status(result.ok ? 200 : 503).json({
      ok: result.ok,
      checks: result.checks,
      // redacted() and nothing else — a secret added by AS-38/AS-44 must not
      // reach this body by default (plan §7.3 item 4). AS-40 added none: its
      // session tokens are random rather than signed, so there is nothing to
      // configure and nothing to leak here.
      config: config.redacted?.() ?? null,
    });
  });

  return router;
}
