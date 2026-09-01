// test/helpers/server.js — the one place that knows how to start and stop an
// app under test (AS-37, plan §8.4).
//
// THE RULE THIS FILE EXISTS TO ENFORCE: teardown is registered BEFORE the
// assertions run. Measured on the spike — a probe that called srv.close() on
// the line AFTER its assertions hung forever when an assertion failed: the
// close never ran, the listener held the event loop open, and the suite
// produced no output at all until it was killed. A hung suite is worse than a
// red one; it has no exit code to report and nothing to read.
//
// try/finally satisfies that rule by construction — `fn` cannot throw past the
// close — so no test file has to remember t.after(). Callers get a base URL and
// nothing else to clean up.
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../app.js';
import { loadConfig } from '../../lib/config.js';

/**
 * Start an app on an OS-assigned port, run `fn(baseUrl, app)`, always stop it.
 *
 * Port 0, never 8348: a test run alongside `docker compose up` would otherwise
 * collide with the running web service.
 *
 * @param {object} config frozen settings (see configFor)
 * @param {(baseUrl: string, app: import('express').Express) => Promise<any>} fn
 */
export async function withServer(config, fn) {
  const app = createApp(config);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`, app);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * Build settings the way the app really builds them — through loadConfig, from
 * an env object — rather than hand-assembling an object. Tests that inject a
 * substitute path still exercise the real resolution and validation path.
 *
 * With no overrides this returns the REAL container configuration
 * (/app/vendor, /app/views, /app/public), which is what the V3 tests use to
 * assert against the real image (plan §8.3).
 *
 * @param {{vendorDir?: string, viewsDir?: string, publicDir?: string, port?: number|string, bind?: string, logLevel?: string, env?: string}} overrides
 */
export function configFor(overrides = {}) {
  const env = {};
  if (overrides.vendorDir !== undefined) env.INVOICING_VENDOR_DIR = overrides.vendorDir;
  if (overrides.viewsDir !== undefined) env.INVOICING_VIEWS_DIR = overrides.viewsDir;
  if (overrides.publicDir !== undefined) env.INVOICING_PUBLIC_DIR = overrides.publicDir;
  if (overrides.port !== undefined) env.INVOICING_PORT = String(overrides.port);
  if (overrides.bind !== undefined) env.INVOICING_BIND = overrides.bind;
  if (overrides.logLevel !== undefined) env.INVOICING_LOG_LEVEL = overrides.logLevel;
  if (overrides.env !== undefined) env.NODE_ENV = overrides.env;
  return loadConfig(env);
}

/** The app's root directory inside the image (and in a checkout): /app. */
export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The test directory itself: /app/test. */
export const TEST_DIR = resolve(APP_DIR, 'test');
