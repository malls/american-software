// vendor.js — the registry of assets this app CONSUMES from outside
// apps/invoicing/ and does not own (AS-37, plan §3.3d).
//
// public/ is what this app owns and may edit. vendor/ is what it consumes.
// The boundary is worth a directory because it is the difference between "we
// may edit this" and "editing this here is a bug": tokens.css is the single
// source of visual truth for everything the company ships (AS-29), derived from
// BRANDING.md and kept in parity by docs/design/tokens/tokens.test.mjs. A second
// editable copy in this app would drift silently, which is exactly what the
// stack decision's "no copy" rule forbids.
//
// Vendored assets are served by NAMED EXPLICIT ROUTES registered before
// express.static (see routes/assets.js), never by directory serving — so a
// stray public/tokens.css can never shadow the real one.
//
// One entry at v1. The list is data so health.js can check it, assets.js can
// serve it, and assets.test.js can assert its exact cardinality before
// quantifying over it (plan §8.3 V2).
export const VENDOR_ASSETS = Object.freeze([
  Object.freeze({
    // The URL this is served at.
    route: '/tokens.css',
    // The filename under config.vendorDir. The Dockerfile COPYs
    // docs/design/tokens/tokens.css to this name — update both together.
    file: 'tokens.css',
    contentType: 'text/css; charset=utf-8',
  }),
]);
