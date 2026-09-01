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
// If a template grows a required local, add it here in the same commit — a
// deploy that cannot render the page SHOULD go unhealthy.
//
// AS-45 obligation: scaffold.ejs is NOT one of the seven budgeted screens. It
// is the one non-budgeted page this scaffold creates, and AS-45 deletes or
// replaces it when screen 1 lands (plan §7.5). Remove its row here too.
export const VIEWS = Object.freeze([
  Object.freeze({
    name: 'scaffold',
    file: 'scaffold.ejs',
    sampleLocals: Object.freeze({
      heading: 'health probe',
      swatches: Object.freeze([]),
    }),
  }),
]);
