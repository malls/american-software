// routes/pages.js — server-rendered screens (AS-37, plan §7.5).
//
// At AS-37 there is exactly ONE page here, and it is NOT one of the seven
// budgeted screens: views/scaffold.ejs exists to prove the whole chain end to
// end in a browser rather than only in an assertion — EJS is wired, views/ was
// COPY'd, the stylesheet resolves, the cascade applies.
//
// AS-45 OBLIGATION: delete or replace this page (and its row in lib/views.js)
// when screen 1 lands. It is recorded here, in lib/views.js, and in README.md
// so it is not inherited by accident.
//
// One template file per screen is a standing constraint (stack decision §10.4
// item 2); screens are added as sibling `router.get` handlers with their own
// template, never as a second screen inside one template file.
import { Router } from 'express';

/** A few tokens from tokens.css, rendered as swatches. These are names only —
 *  the values come from the vendored stylesheet at request time via var(), so
 *  the page cannot drift from the source of visual truth. */
const SWATCHES = Object.freeze([
  'color-ink-900',
  'color-ink-500',
  'color-ink-200',
  'color-ink-50',
]);

/** @param {object} config frozen settings from lib/config.js */
export function pageRoutes(config) {
  const router = Router();

  router.get('/', (req, res) => {
    res.render('scaffold', {
      heading: 'apps/invoicing scaffold',
      swatches: SWATCHES,
    });
  });

  return router;
}
