Screen 6 (contract create) — split out of AS-47 at plan §6's pre-agreed line. AS-47 landed screen 7 (contract detail with print/download) as Unit A; at the split trigger the branch measured 1,455 changed lines against master (1,061 for Unit A alone, excluding the §3.9 route-surface extraction) against a stop line of 800, so screen 6 is this task. Filed by agent:developer-marcus 2026-09-12 (tick watcher:79108 loop tick 6).

Everything AS-47's plan (.lattice/plans/task_01M1D34P2B9MDD94H9HNYW4ZH5.md) rules for screen 6 binds here unchanged: §3.1 (the two /contracts/new routes join contractRoutes, registered BEFORE GET /contracts/:id, form without action, the router's existing body parser), §3.2 (below, verbatim), §3.6 (chrome, copy, template shape rules; textarea joins the .field rules), §3.7 (eleven-row partition 6+1+2+1+1), §3.8 (S6-ERROR-SYSTEM by dropping the contracts table), §8 recipes F1, F2, F4, F6, F9, F10, F11a, F12, and §7 cases 1–19 (below, verbatim) in test/contract-screens.test.js — the file AS-47 created, whose screen-7 cases 20–29 are already there. Decision 5: validateFormValue gains export in lib/contracts/generation.js (one validator, two callers). The README's § Contracts says /contracts/new is this task's until it merges. Depends on AS-47 (the file, the nav, the route-surface literals) and, through it, on AS-46 (the /invoices/new nav link and the client-picker precedent — plan §11 Q3: the picker logic is carried twice by lane discipline; a third consumer extracts lib/screens/client-picker.js).

Recount every cardinality literal at rebase (AS-47 §10): routes +2 (GET and POST /contracts/new), source +2, VIEWS +1 (contract-form.ejs, sampleLocals contractFormLocals() = S6-CLIENT-EMPTY), expectFiles +1, P4 +1, VIEW_START_TAGS + the new template's count, contracts.test.js P8 2 -> 4 and Y2's registration-order list, APP_CSS_* re-measured. Reviewer runs F6 and F9 at minimum plus the §8 M6 probes named for screen 6.

---

### §3.2 Screen 6 — the view model, the intents, the validator

`lib/screens/contract-form-view.js` mirrors `invoice-form-view.js` in shape: a frozen `CONTRACT_FORM_LEDGER` (eleven rows, id + disposition, transcribed by hand from `02-states-ledger.md` §6 with the R-4 docstring), a frozen `CONTRACT_FORM_STATES` (the six `rendered` rows), `parseContractForm(body)` (pure), and `contractFormLocals(input)` (pure). The template branches on precomputed booleans and reads properties.

**The fields come from the declaration, not from the template.** The view model reads `getTemplate(DEFAULT_TEMPLATE_ID).variables.filter(v => v.source === 'form')` and builds `fields: [{ name, label, type, required, value, error }]` in declaration order (two today: `projectDescription`, `startDate`); the template loops and branches on `field.type` (`multiline` → `<textarea>`, `date` → `<input type="date">`, `text` → `<input type="text">`). `name="<%= field.name %>"`, `id=`, `for=` and `value=` are interpolations inside double-quoted attribute values (P3 satisfied; none of P2a's five names) and every one of them is a renderer-authored constant from code, not from a request. `templateId` is passed to `generate` **explicitly** as `DEFAULT_TEMPLATE_ID`, so the fields rendered and the declaration generated are the same object by construction; no hidden `templateId` input exists — a request cannot pick a template the screen did not render. **A record-sourced name never reaches `generate` from this screen:** `parseContractForm` reads exactly the declared form names and nothing else from the body, so `freelancerName=Someone Else` in a hand-crafted POST is simply not read (case 19 asserts the document says the session's name).

**Decision 5 — one validator.** `validateFormValue(variable, raw)` in `lib/contracts/generation.js` gains `export`. `parseContractForm` calls it per declared field, catches `ValidationError`, and records `errors[name] = true`; when the set is empty, `contractFormLocals`'s caller invokes `generation.generate`, which runs the identical function again and cannot reach a different answer. Two predicates that can disagree — the thing AS-46 §3.3 refused for client email — do not exist here. **Field copy is per field and constant**, never derived from `err.problem` (the house rule: map on class, never on message text): `projectDescription` → the wireframe's own "Describe the project in a sentence or two."; `startDate` → "Enter a date as YYYY-MM-DD." (no wireframe copy exists; recorded deviation). A field with any error shows its one sentence, over-long included — the sentence says what a valid value looks like, which is true in every failure. The banner counts what the page marks: "1 field needs attention" / "N fields need attention" (screen 1's `attentionTitle`, re-implemented locally — `signin-view.js` does not export it and this task does not edit that file).

**Intents** — the closed dispatch, AS-46 §3.2's table minus the draft-shaped ones:

| `intent` | Persists | Then |
|---|---|---|
| `generate` | **one contract row**, only when every field validates and `clientId` names an owned client | `303 /contracts/<id>` (the API's own `detailPath`) |
| `new-client` | nothing | re-render, picker in add-new mode, 200 |
| `existing-client` | nothing | re-render, picker in select mode, pre-selected on `duplicateId` if present else the submitted `clientId`, 200 |
| `add-client` | **one client row**, only when name and email are non-blank and (no case-insensitive match, or `clientConfirm=1`) | re-render, picker in select mode, the new client selected, every contract value preserved, 200 |
| anything else, absent, or an array | nothing | `400`, `S6-ERROR-VALIDATION`, banner "Choose an action." |

Inline client creation is AS-46 §3.3's ruling applied unchanged (its README obligation to this task): validate blankness only (matching `POST /clients` exactly — no email-shape rule; AS-46 Q3's default holds, and this is the planning it named as the deadline: **still one consumer of no shape rule, so nothing is exported**), `repos.clients.findByEmail` before `repos.clients.create`, first match named, both offers rendered. `add-client` creates a client and nothing else. `POST /clients` is not posted to and not changed.

**State selection, first match wins:**

| # | Condition | State | Status |
|---|---|---|---|
| 1 | `intent=add-client` with a blank name or email | `S6-CLIENT-ERROR-VALIDATION` | 400 |
| 2 | `intent=add-client`, a match exists, no `clientConfirm` | `S6-CLIENT-ERROR-DUPLICATE` | 200 |
| 3 | `intent=generate` with any field error, no/unowned `clientId`, or an unknown intent | `S6-ERROR-VALIDATION` | 400 |
| 4 | `intent=generate` validated, and `generate()` threw anything but a client-shaped refusal | `S6-ERROR-SYSTEM` | 500 |
| 5 | zero clients (picker forced to add-new; no `<select>` in the markup) | `S6-CLIENT-EMPTY` | 200 |
| 6 | otherwise | `S6-DEFAULT` | 200 |

There is **no Stripe gate** on this screen — `S6-GATED-STRIPENOTREADY` is the ledger's own n/a row ("contract generation has no Stripe dependency"), and the route reads no connected-account row at all (case 3 renders the form for a freelancer with **no** Connect row, which is the assertion). `contractRoutes` still takes `{ repos }` alone; contracts.test.js Y2 keeps binding that.

**The error-class → state map for `intent=generate`** (each row is a criterion):

| Thrown by | Class | Lands |
|---|---|---|
| `generate` step 4 | `NotFoundError` with `entity === 'client'` (missing or another freelancer's — the same error, by AS-42's design) | `S6-ERROR-VALIDATION`, the client field marked "Select a client." — indistinguishable from an unselected one |
| `generate` step 3 (cannot happen after the screen's own parse; kept for the class) | `ValidationError` naming a declared field | `S6-ERROR-VALIDATION`, that field marked |
| `generate` steps 1, 4, 5–6 | any other `NotFoundError` (template, freelancer, template variable), any other `RepositoryError`, anything else | `S6-ERROR-SYSTEM`, 500, **re-rendered in place with every value preserved** — nothing was created (generation refuses before it writes, and a failed `INSERT` is inside a transaction), so the resubmit is the retry. The banner is the wireframe's: "Something went wrong generating this contract. Nothing was created — try again." The submit button is the "Try again". |
| body-parser refusal | — | the router's `parse-body` landing, `text/plain`, unchanged (§13) |

Why not post-redirect-get here when AS-46 chose it for `S4-ERROR-SYSTEM`: AS-46's send failure leaves a persisted draft, so redirecting to it makes the retry an update rather than a duplicate. A failed generation leaves **no row**; a redirect would land on a blank form with the typed values gone. Rendering in place is the answer that preserves the values and cannot double-create. The one thing PRG buys — a browser "resubmit?" prompt on refresh — is a prompt to do exactly what "Try again" means.

**`S6-LOADING`** is `unrenderable — browser-supplied`, as S1/S2/S4. **`S6-ABANDON`** and **`S6-CLIENT-ABANDON`** are paths into renders — and on this screen they coincide in effect, as the wireframe's own S6-CLIENT-ABANDON copy says: no draft exists, so leaving loses everything typed and a return starts blank.

---

## §7 cases, verbatim from AS-47's plan

**Screen 6 — the ledger and the form**

1. *'screen 6 accounts for all eleven of its ledger rows: 6 + 1 + 2 + 1 + 1 = 11'* — two transcriptions compared by set equality and cardinality; `CONTRACT_FORM_STATES` has 6 members; each rendered state's marker (§3.6) occurs exactly once in the template source, over a committed six-row table; the n/a bucket has exactly one member and it is `S6-GATED-STRIPENOTREADY`. **Falsifier: F11a.**
2. *'the contract form view model reaches every rendered state with no HTTP, and its fields come from the declaration'* — six states from pure inputs; `fields` equals the declaration's form-sourced variables in declaration order, cardinality asserted (2 today) and read from `getTemplate(DEFAULT_TEMPLATE_ID)` in the test, not hard-coded; an unknown intent lands on `S6-ERROR-VALIDATION`; no local anywhere equals a record-sourced variable name's value.
3. *'S6-DEFAULT renders the picker, the declared fields, the placeholder warning and no Stripe gate'* — a signed-in freelancer with **no** connected-account row and one client: 200, sentinel, exactly one `<select name="clientId">`, one `<textarea` with `name="projectDescription"`, one `type="date"` with `name="startDate"`, `banner-warning` once, "Generate contract" once, exactly one `<form method="post">` with no `action` (and the sign-out form's `action="/signout"` once), the nav's three entries, form input count under the parser's 20.
4. *'S6-CLIENT-EMPTY: with zero clients the picker opens in add-new mode and no select renders'* — sentinel, `occurrences(html, '<select') === 0`, "No clients yet — add one below." once, no `new-client` toggle.
5. *'S6-ERROR-VALIDATION marks every failing field, counts them in the banner, and re-renders every submitted value as typed'* — `intent=generate`, blank description, `startDate=2026-02-31`, no client: three `field--invalid`, "3 fields need attention", the date re-rendered byte-for-byte in its `value=`, 400, nothing created; then one failing field alone → "1 field needs attention" (the wireframe's sentence). **Falsifier: F1.**
6. *'the screen and the API validate with the same function: what generate refuses, the screen marks, for every declared field'* — for each declared form field, one refused value per type (blank; a 5,001-character description; `2026-02-31`) driven through the screen marks exactly that field, and the same body posted to `POST /contracts` is 400 `text/plain` naming the same field. **Falsifier: F6.**
7. *'S6-CLIENT-ERROR-VALIDATION: blank client fields re-render with every value preserved and no client row created'* — 400, both fields marked when both blank, the description/date intact, `listByFreelancer` unchanged.
8. *'S6-CLIENT-ERROR-DUPLICATE: an email matching an existing client case-insensitively warns, names the match, creates nothing, and offers both ways forward'* — seed `ada@example.test`, submit `ADA@EXAMPLE.TEST`; 200; banner names name and email; `duplicateId` equals the seeded id; both intent buttons; count unchanged.
9. *'the two duplicate offers work: "create anyway" adds a second row, "use this client instead" selects the existing one and adds none'*.
10. *'add-client creates exactly one client and re-renders with it selected and every contract value preserved'*.
11. *'S6-ERROR-SYSTEM: a generation that fails after validation re-renders in place, names that nothing was created, and preserves every value'* — drop the `contracts` table through `openDatabase(config.dbPath)`; `intent=generate` with a valid body → 500, sentinel, the wireframe's banner sentence once, the form present with the typed values, `<form method="post">` once (the retry), zero rows (`countContracts` after restoring is not needed — assert `sqlite_master` has no `contracts` table and the response wrote nothing). **Falsifier: F4.**
12. *'generate creates one contract through the same path as the API, and lands on a detail page that exists'* — 303 `/contracts/<id>`; `followToTerminus` → `hops === 1`, `200`, sentinel `S7-DEFAULT`; the row's `renderedHtml` equals `renderContract(getTemplate(row.templateId), row.variables)`; the same inputs posted to `POST /contracts` produce a byte-identical `renderedHtml`. **Falsifier: F12.**
13. *'S6-DENIED-SIGNEDOUT: cookieless GET and POST /contracts/new are answered by the guard, and the GET lands on screen 1 carrying next'* — 303 `/signin?next=%2Fcontracts%2Fnew`, no `Set-Cookie`; following it renders screen 1 with the hidden `next`; the POST 303s with no `next`.
14. *'S6-ABANDON: two GETs are byte-identical, a non-persisting re-render is forgotten, and nothing was created'*.
15. *'S6-CLIENT-ABANDON: a new-client re-render creates no client, and the next GET starts the picker at its default variant'*.
16. *'the intent dispatch is closed: an unknown, absent or repeated intent is refused and persists nothing'* — `intent=drop`, none, `intent[]=generate&intent[]=add-client` → 400 each, sentinel, "Choose an action.", zero contracts, zero clients. **Falsifier: F10.**
17. *'a value containing markup in the description is rendered as text on the re-render, not as markup'* — escaped once, raw zero. **Falsifier: F2.**
18. *'GET and POST /contracts/new are served by the screen, never captured by /contracts/:id, and POST /contracts is unchanged'* — `GET /contracts/new` renders `S6-DEFAULT`, not NOTFOUND; a bad form post answers HTML 400 with a sentinel; `POST /contracts` with the same bad body answers `text/plain` 400 (the API's shape, cited from contracts.test.js P2). **Falsifier: F9.**
19. *'a record-sourced name posted to the screen is not read: the document says the session freelancer's name'* — `freelancerName=Someone Else` plus a valid body, `intent=generate` → 303; the row's `variables.freelancerName` is the session's `displayName`, and the served page contains "Someone Else" zero times.
