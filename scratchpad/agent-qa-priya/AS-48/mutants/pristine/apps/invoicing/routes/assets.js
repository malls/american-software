// routes/assets.js — the VENDORED asset routes (AS-37, plan §5.3, §3.3d).
//
// These serve files this app consumes from outside apps/invoicing/ and does not
// own. Two properties are load-bearing and both are asserted in
// test/assets.test.js:
//
//  1. BYTE-IDENTICAL. The stack decision requires tokens.css be served with no
//     copy, no transform, no hash — Content-Length: 12199. So the bytes are
//     read and written verbatim, with the length set explicitly. Nothing here
//     may minify, re-encode, or fingerprint.
//  2. REGISTERED BEFORE express.static. These are named explicit routes, never
//     directory serving, so a stray public/tokens.css can never shadow the real
//     one. app.js registers this router first; do not reorder.
import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VENDOR_ASSETS } from '../lib/vendor.js';

/** @param {object} config frozen settings from lib/config.js */
export function assetRoutes(config) {
  const router = Router();

  for (const asset of VENDOR_ASSETS) {
    const path = join(config.vendorDir, asset.file);
    router.get(asset.route, async (req, res, next) => {
      let body;
      try {
        body = await readFile(path);
      } catch (err) {
        if (err.code !== 'ENOENT') return next(err);
        // A vendored asset that is not in the image is a DEPLOY failure, not a
        // missing page: the Dockerfile COPY was dropped or vendorDir is wrong.
        // 503 says so, and /healthz's vendor_assets check reports the same
        // condition continuously.
        return res.status(503).type('text/plain').send(`vendored asset unavailable: ${asset.file}\n`);
      }
      // Set both headers explicitly and end with the raw buffer: no res.send,
      // which would negotiate a type and could attach an ETag. HEAD requests
      // route to this handler too (Express dispatches HEAD to GET), and Node
      // keeps an explicitly-set Content-Length while dropping the body — which
      // is what makes `curl -sI /tokens.css` show 12199.
      res.setHeader('Content-Type', asset.contentType);
      res.setHeader('Content-Length', body.length);
      res.end(body);
    });
  }

  return router;
}
