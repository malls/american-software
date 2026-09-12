# AS-128: apps/invoicing: add-client on the invoice and contract screens answers a malformed email with a bare text/plain 400 instead of the specified validation state (S4/S6-CLIENT-ERROR-VALIDATION)

Complexity low, two-stage path: Marcus plans and implements; Priya reviews.

## Scope

The screen half of AS-67. On screens 4 and 6, `intent=add-client` calls
`repos.clients.create` outside a try; the repository's `ValidationError`
(`field: 'email'`, AS-67 `assertEmail`) falls through to `fail()` as a text/plain
400 and the form is lost. Spec: `docs/design/wireframes/00-flows.md` Flow 3 step
3a and the states ledger §0 — `S{4,6}-CLIENT-ERROR-VALIDATION`, values preserved.

Out of scope: any email check at a route (AS-67 D6 — the repository is the one
copy), `lib/db/`, `test/clients.test.js` L4, dependencies, templates (both
already render `clientEmailError` into `id="clientEmail-error"`).

## Approach

Both add-client branches, identical in shape:
1. `const email = clientEmail.trim()` after the blankness check; `email` is what
   `findByEmail` and `create` receive. The typed value stays in `submission.values`,
   so the re-render is still as typed. Name is not trimmed (not in scope; the
   repository accepts it as it always has).
2. Wrap `create` in a try; `err instanceof ValidationError && err.field === 'email'`
   → `render(…Locals({ ...base, clientEmailRefused: true }))`; anything else rethrows
   (the existing `fail` path — nothing else is reachable after the blankness check).
3. View models (`invoice-form-view.js`, `contract-form-view.js`): a new input
   `clientEmailRefused?: boolean`, honoured only when `intent === 'add-client'`
   (the same gate as `duplicate`/`createdClientId`). `clientFieldErrors` marks
   `clientEmail` with a new renderer sentence `FIELD_MESSAGE.email =
   'Enter a complete email address.'` (the sign-up screen's sentence, so the two
   screens that take a typed email agree). Precedence: blank wins (`required`),
   then refused. State selection, status (400), banner count and title suffix
   follow unchanged — the state already exists; this only adds a way into it.
4. README: one `**AS-128:**` sentence next to the AS-127 passage (~line 1145)
   saying the blankness-only rule is now blankness at the screen + shape from
   the repository, rendered.

Key files: `routes/invoices.js`, `routes/contracts.js`,
`lib/screens/invoice-form-view.js`, `lib/screens/contract-form-view.js`,
`test/invoice-screen.test.js`, `test/contract-screens.test.js`, `README.md`.

## Acceptance criteria

1. Screen 4 malformed: `POST /invoices/new` `intent=add-client`,
   `clientEmail='not-an-email'`, a line item and `daysUntilDue` typed → 400,
   `text/html`, state `S4-CLIENT-ERROR-VALIDATION`, exactly one
   `id="clientEmail-error"`, `1 field needs attention`, the name/email/line
   item/days preserved as typed, 0 client rows, 0 invoice rows. A second body
   `' not an email '` (inner whitespace, so trimming does not rescue it) gets
   the same state with `value=" not an email "` echoed as typed.
2. Screen 4 trim: `clientEmail=' dee@example.test '` → 200, exactly one client
   row with email `dee@example.test`, selected; then `' DEE@EXAMPLE.TEST '` →
   `S4-CLIENT-ERROR-DUPLICATE` naming it, still one row (the trim reaches
   `findByEmail` too).
3. Screen 6 malformed: same as 1 against `POST /contracts/new` with
   `projectDescription`/`startDate` preserved, state `S6-CLIENT-ERROR-VALIDATION`,
   0 client rows, 0 contract rows.
4. Screen 6 trim: same as 2 against `/contracts/new`, `S6-CLIENT-ERROR-DUPLICATE`.
5. View models, no HTTP: `invoiceFormLocals` / `contractFormLocals` with an
   add-client submission carrying a well-formed email and
   `clientEmailRefused: true` → the `*-CLIENT-ERROR-VALIDATION` state, status
   400, `clientEmailError === 'Enter a complete email address.'`,
   `clientNameError === null`, banner title `1 field needs attention`; with a
   blank email and the flag → `clientEmailError === 'This field is required.'`
   (blank wins); the flag on a `save`/`generate` submission changes nothing.
6. Unchanged by construction: `git diff master...feat/AS-128-add-client-validation-state
   -- apps/invoicing/lib/db apps/invoicing/test/clients.test.js
   apps/invoicing/package.json apps/invoicing/package-lock.json` is empty.
7. The suite is green under a counted compose run with the `Image … Built`
   receipt; the count rises by exactly the new tests (2 + 2 screen cases, 1–2
   view-model cases).

### Falsifiers (M4) — one observed red each, mutate in place with backup + restore

- **M1** `routes/invoices.js`: replace the try/catch with the bare
  `repos.clients.create` call (today's code). Red set exactly {criterion 1's test}.
- **M2** `routes/invoices.js`: `clientEmail.trim()` → `clientEmail` at the
  `email` binding. Red set exactly {criterion 2's test}.
- **M3** `routes/contracts.js`: as M1. Red set exactly {criterion 3's test}.
- **M4** `routes/contracts.js`: as M2. Red set exactly {criterion 4's test}.
- **M5** `lib/screens/invoice-form-view.js`: read `clientEmailRefused` as
  always false. Red set exactly {criterion 1's test, criterion 5's invoice case}.
- **M6** `lib/screens/contract-form-view.js`: as M5. Red set exactly
  {criterion 3's test, criterion 5's contract case}.

Each mutant: the helper asserts the pattern occurs once and lands at the
intended site; after the run `git -C .worktrees/AS-128 diff --exit-code`
proves the restore. Logs: `scratchpad/agent-developer-marcus/AS-128/`.
