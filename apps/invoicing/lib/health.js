// health.js — the health checks, AS DATA (AS-37, plan §10).
//
// THE DESIGN RULE, and the only one that matters here:
//
//   A health check may only assert things that CAN BE FALSE while the process
//   is still able to answer.
//
// "The server is running" is tautological — you could not have received the
// response otherwise. What is worth asserting is every precondition supplied
// from OUTSIDE the process: the environment, the image's contents, mounted
// paths, and later the database. Those are exactly the things unit tests inject
// substitutes for, and exactly the things AS-17 (a public module missing from
// an allowlist, 404ing at runtime while every unit test passed) and AS-26 (a
// compose mount that made repo markdown unreachable in the only supported
// deployment) got wrong.
//
// Every check below is demonstrated able to fail in test/health.test.js. A
// check with no demonstrated failure path is a 200 with extra steps.
//
// The list is data so AS-39 appends a `database` row without touching the route.
// NOT checked, deliberately: Stripe (no account exists; asserting one would
// encode the assumption plan §7.3 forbids) and the database (AS-39's).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ejs from 'ejs';
import { validateResolved } from './config.js';
import { VENDOR_ASSETS } from './vendor.js';
import { VIEWS } from './views.js';

/** @type {ReadonlyArray<{name: string, run: (config: object) => true | {ok: boolean, detail: string}}>} */
export const HEALTH_CHECKS = Object.freeze([
  Object.freeze({
    name: 'config',
    // Can be false: app.js takes settings as an argument, so the running app
    // may hold an object that never passed through loadConfig — a partial or
    // hand-built one. Boot-time validation cannot see that; this can.
    run(config) {
      const problems = validateResolved(config);
      return problems.length === 0 ? true : { ok: false, detail: problems.join('; ') };
    },
  }),

  Object.freeze({
    name: 'vendor_assets',
    // Can be false: the tokens COPY was dropped from the Dockerfile, or
    // vendorDir points somewhere else. This is the AS-17/AS-26 class, checked
    // continuously at runtime rather than only in a test.
    run(config) {
      const problems = [];
      for (const asset of VENDOR_ASSETS) {
        const path = join(config.vendorDir, asset.file);
        try {
          const st = statSync(path);
          if (!st.isFile()) problems.push(`${path} is not a regular file`);
          else if (st.size === 0) problems.push(`${path} is empty`);
        } catch (err) {
          problems.push(`${path}: ${err.code || err.message}`);
        }
      }
      return problems.length === 0 ? true : { ok: false, detail: problems.join('; ') };
    },
  }),

  Object.freeze({
    name: 'views',
    // Can be false: views/ was not COPY'd into the image, or a template is
    // broken. A real deploy failure that unit tests structurally cannot see,
    // because they render from a fixture directory.
    run(config) {
      const problems = [];
      try {
        if (!statSync(config.viewsDir).isDirectory()) problems.push(`${config.viewsDir} is not a directory`);
      } catch (err) {
        return { ok: false, detail: `${config.viewsDir}: ${err.code || err.message}` };
      }
      for (const view of VIEWS) {
        const path = join(config.viewsDir, view.file);
        try {
          // A real render, not a stat: `filename` is passed so <%- include %>
          // resolves the same way Express resolves it. ejs.render is
          // synchronous for file-less templates, which keeps the check
          // signature synchronous.
          ejs.render(readFileSync(path, 'utf8'), { ...view.sampleLocals }, { filename: path });
        } catch (err) {
          problems.push(`${view.name} (${path}): ${err.code || err.message}`);
        }
      }
      return problems.length === 0 ? true : { ok: false, detail: problems.join('; ') };
    },
  }),
]);

/**
 * Run every check. 200 only if all pass; the caller returns 503 otherwise.
 * @returns {{ok: boolean, checks: Array<{name: string, ok: boolean, detail?: string}>}}
 */
export function runHealthChecks(config, checks = HEALTH_CHECKS) {
  const results = checks.map((check) => {
    let outcome;
    try {
      outcome = check.run(config);
    } catch (err) {
      // A check that throws is a failing check, never a 500. The endpoint must
      // stay able to answer — that is the whole point of it.
      outcome = { ok: false, detail: `check threw: ${err.message}` };
    }
    if (outcome === true) return { name: check.name, ok: true };
    return { name: check.name, ok: false, detail: String(outcome?.detail ?? 'failed') };
  });
  return { ok: results.every((r) => r.ok), checks: results };
}
