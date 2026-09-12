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

export const VIEWS = Object.freeze([
  Object.freeze({
    name: 'signin',
    file: 'signin.ejs',
    sampleLocals: signinLocals(),
  }),
]);
