// one-shot: apps/invoicing/README.md edits per plan §9
import { readFileSync, writeFileSync } from 'node:fs';
const P = '/Users/forrest/Code/american-software-company/.worktrees/AS-46/apps/invoicing/README.md';
let s = readFileSync(P, 'utf8');
const rep = (a, b) => { if (!s.includes(a)) throw new Error(`anchor: ${a.slice(0, 60)}`); s = s.replace(a, b); };

// § Issuing an invoice — the screen paragraph
rep(`\`/invoices/{id}\` and \`/invoices/{id}/edit\` 404 until AS-48 (screens 3 and 5) and
AS-46 (screen 4) land — the same deliberate dangle as \`/connect-stripe\` above.
AS-46's single "Finalize & send" control posts to \`…/send\`; \`…/finalize\` exists
because finalize and send are two operations with two failure modes, and AS-49
can drive them separately to observe the intermediate state.`,
`\`/invoices/{id}\` 404s until AS-48 (screens 3 and 5) lands — the same deliberate
dangle as \`/connect-stripe\` above. **\`/invoices/new\` and \`/invoices/{id}/edit\`
are screen 4 (AS-46)**, served from the same router. The screen posts to **its
own routes** (\`POST /invoices/new\`, \`POST /invoices/{id}/edit\`), not to the four
API routes: a human form ("1200.00", blank rows, an \`intent\`) is not the API's
shape, and a validation failure re-renders the screen with every value
preserved, which a \`text/plain\` 400 cannot. The screen's \`send\` calls the same
\`lifecycle.send\` the API does; the API routes remain the programmatic path (the
demo, the acceptance driver). \`…/finalize\` exists because finalize and send are
two operations with two failure modes, and AS-49 can drive them separately to
observe the intermediate state.`);

// § The gate — the screen/API tension (plan §13 item 3)
rep(`\`lib/invoices/\` names its underlying fields. Drafting is deliberately ungated —
a freelancer may build drafts before connecting Stripe.`,
`\`lib/invoices/\` names its underlying fields. Drafting is deliberately ungated **at
the API** — a freelancer may build drafts before connecting Stripe. **Screen 4
gates drafting** (a 403 refusal, \`S4-GATED-STRIPENOTREADY\`, on its GETs and its
POSTs alike) because the design record says the *screen* refuses (00-flows.md
Flow 5, ledger §4); both remain true, and the tension is recorded in the AS-46
plan (§10 Q2) with a trigger to revisit.`);

// § The view layer — two additions beside the GET-route convention
rep(`second publicness mechanism. \`routes/pages.js\` stays the home for routes
belonging to no capability, which is now exactly one.
`,
`second publicness mechanism. \`routes/pages.js\` stays the home for routes
belonging to no capability, which is now exactly one.

**A screen that must re-render a submitted form owns its own POST routes**
beside the capability's API routes, registered before any \`:id\` route that
would otherwise capture a literal segment, and its form carries no \`action\`
attribute — the page's own URL is the target, which keeps an id out of a URL
attribute (property 2) and makes "re-render the same screen, same route"
literal. Everything the page can do is a submit button named \`intent\`,
dispatched server-side; there is no client-side JavaScript and every round trip
re-renders from the body, so nothing is ever carried in a URL. Landed by AS-46
with screen 4; the inline-client ruling in its plan §3.3 (the screen creates the
client through the same repository call \`POST /clients\` uses, from its own
handler, because a form posting straight to the endpoint can reach only two of
the four §0 states) applies to screen 6 unchanged.

**Money crosses the human boundary in exactly one file.** \`lib/db/money.js\`
owns the two conversions (\`formatMinorUnits\`, \`parseMajorUnits\`); the screen's
view model is the one place that calls them and is a member of the
\`'money representation'\` row for that reason. Templates and stylesheets stay
clear of the words — measured, and asserted by the same row.
`);

// § Obligations — what AS-46 hands forward
rep(`## Obligations this scaffold hands forward
`,
`## Obligations this scaffold hands forward

- **AS-46 (screen 4) hands forward.** **AS-48:** the \`send\` success terminus
  (\`/invoices/{id}\`) is asserted as a \`Location\` only in
  \`test/invoice-screen.test.js\` — add the followed-terminus assertion when the
  detail screen exists; the Dashboard nav entry (one anchor in
  \`views/invoice-form.ejs\`; \`01-screens.md\` names \`/dashboard\` while the app's
  landing constant is \`/\` — AS-48 owns that constant); and "finalized, not
  sent" after a failed send lives on the detail screen (the edit GET 303s there
  once a Stripe invoice is attached, dropping the \`?error\` flag). **AS-47:** the
  New contract nav entry (one anchor in the same template); the inline-client
  ruling in AS-46's plan §3.3 applies to screen 6 unchanged. **AS-70:** nothing
  — but screen 4's gated state links to \`/connect-stripe\` and the link check in
  \`test/invoice-screen.test.js\` is red without it (merge order AS-70 → AS-46).
`);
writeFileSync(P, s);
console.log('ok');
