// views.js — the registry of EJS templates this app ships (AS-37).
//
// One template file per screen is a standing constraint (stack decision §10.4
// item 2). This list is what the `views` health check renders to prove views/
// actually reached the image, and what views.test-style assertions count before
// quantifying over (plan §8.3 V2).
//
// `sampleLocals` is the render probe: the smallest locals object that makes the
// template render. The health check renders each template with it at request
// time, so "views/ was not COPY'd" and "the template is broken" are both
// observable from /healthz rather than only from a user hitting the page.
//
// SINCE AS-45 THE PROBE LOCALS ARE THE SCREEN'S OWN VIEW MODEL, called with its
// default input, rather than a hand-written object. A template that grows a
// required local therefore cannot drift from its probe: the two are the same
// function. That is the failure mode the old "add it here in the same commit"
// instruction was asking a human to remember.
//
// The scaffold obligation AS-37 left here is DISCHARGED: scaffold.ejs and its
// row are gone (AS-45).
import { signinLocals } from './screens/signin-view.js';
import { connectLocals } from './screens/connect-view.js';
import { invoiceFormLocals } from './screens/invoice-form-view.js';
import { contractDetailLocals } from './screens/contract-detail-view.js';
import { dashboardLocals } from './screens/dashboard-view.js';
import { invoiceDetailLocals } from './screens/invoice-detail-view.js';

export const VIEWS = Object.freeze([
  Object.freeze({
    name: 'signin',
    file: 'signin.ejs',
    sampleLocals: signinLocals(),
  }),
  // Screen 2 (AS-70). The default input renders S2-DEFAULT-NOTSTARTED.
  Object.freeze({
    name: 'connect-stripe',
    file: 'connect-stripe.ejs',
    sampleLocals: connectLocals(),
  }),
  // Screen 4 (AS-46). The default input has no account row, so the probe
  // renders the gated state — a real render of the template's chrome, banner
  // and refusal branch, decided by the same function the route calls.
  Object.freeze({
    name: 'invoice-form',
    file: 'invoice-form.ejs',
    sampleLocals: invoiceFormLocals(),
  }),
  // Screen 7 (AS-47). The default input (no row, no failure) renders
  // S7-ERROR-NOTFOUND — nothing to show — which exercises the template without
  // a stored document; the raw-output line is probed by its own cases.
  Object.freeze({
    name: 'contract-detail',
    file: 'contract-detail.ejs',
    sampleLocals: contractDetailLocals(),
  }),
  // Screen 3 (AS-48). The default input has no rows and no account row, so
  // the probe renders S3-EMPTY-FIRSTRUN with the gated nav — chrome, lede and
  // the disabled entry, decided by the same function the route calls.
  Object.freeze({
    name: 'dashboard',
    file: 'dashboard.ejs',
    sampleLocals: dashboardLocals(),
  }),
  // Screen 5 (AS-48). The default input has no row, so the probe renders
  // S5-ERROR-NOTFOUND (the AS-47 precedent for a detail screen's probe).
  Object.freeze({
    name: 'invoice-detail',
    file: 'invoice-detail.ejs',
    sampleLocals: invoiceDetailLocals(),
  }),
]);
