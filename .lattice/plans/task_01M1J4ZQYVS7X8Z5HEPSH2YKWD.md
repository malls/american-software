# AS-67 — apps/invoicing: client email format validation belongs in the clients repository

Planner + implementer: Marcus Webb (`agent:developer-marcus`), two-stage path, `complexity: low`
(confirmed after exploration — see §1). Running on Opus under the Fable fallback (Fable spawn refused, HTTP 429).
Reviewer next tick: `qa-ruben` or `qa-priya`, whichever is free.

## 1. Scope and the complexity call

Stays low. The change is one predicate in `lib/db/errors.js`, two call sites in
`lib/db/repositories/clients.js` (`create`, `update`), a one-line lift in
`lib/auth/accounts.js` so the freelancer sign-up rides the same predicate, one
re-export line in `lib/db/database.js`, and tests. No migration, no route change, no
screen change, no dependency.

## 2. Decisions

**D1 — One predicate, two error vocabularies (lift, don't copy).** `accounts.js`'s
private `assertEmailShape` is lifted into `lib/db/errors.js` as a boolean
`isEmailShape(value)` plus the house-shaped `assertEmail(value, field)` (throws
`ValidationError(field, …)`, returns the value). `accounts.js` keeps its
`assertEmailShape` name and keeps throwing `AuthError('invalid-email')` to its own
callers — its body becomes `if (!isEmailShape(email)) throw new AuthError('invalid-email')`.
`test/auth.test.js` moves nothing. Why not two copies: the task exists because a
second source of truth drifts; two email predicates is the same failure one layer down.

**D2 — The predicate, exactly** (lifted verbatim from `accounts.js`; deliberately weak,
for the reason its comment gives — no ESP, so this catches typing mistakes only):

```
isEmailShape(value) :=
  typeof value === 'string'
  && value.length <= 254                       // EMAIL_MAX, RFC 5321 path ceiling
  && at = value.indexOf('@'); at > 0            // not first
  && at === value.lastIndexOf('@')             // exactly one
  && at < value.length - 1                     // not last
  && !/\s/.test(value)                         // no whitespace anywhere
```

`'x@y'` passes (C1 already uses it); `'a@b c'`, `'@x'`, `'x@'`, `'a@@b'`, `'no-at'`
and a 255-character address fail. The repository does **not** trim or otherwise
transform the value: a repository that silently edits input is a second surprise;
callers that accept typed input trim before they call (accounts.js already does).

**D3 — Length ceiling: email yes (254, inherent in the predicate), name no.** AS-65
§9 Q5 parked both. The email ceiling arrives for free with the predicate and is the
same number the sign-up path already enforces. A name ceiling is declined: no
consumer (screen, DDL, Stripe field) has named a number, the screens that were Q5's
trigger shipped without asking for one, and an invented ceiling in the repository is
a hard refusal of a real customer name. The parser's 32 kb body limit bounds it
today. Box: re-opens when a screen or the Stripe customer call names a limit; it then
goes in `clients.js` beside this check, not at a route.

**D4 — No migration.** The DDL CHECK on `clients.email` stays `length(trim(email)) > 0`.
The shape is expressible in SQLite (`instr` arithmetic) but SQLite cannot alter a
CHECK in place — it would be a table rebuild of `clients`, which two tables
reference by composite FK, for a rule the repository already makes unbypassable
by the task's own argument. The DDL CHECKs in this codebase are shape backstops
(non-empty, id prefix), not the validator. All existing rows are test rows, so there
is no backfill question either way. `SCHEMA_VERSION` does not move.

**D5 — `findByEmail` keeps `assertText`.** A lookup by a malformed address legitimately
returns `[]`; a read refusing is the wrong shape, and the screens call it before
`create` with the typed value.

**D6 — The route adds nothing.** `routes/clients.js` is untouched. Its `L4` gains a row
(AS-65 Q4: "L4 gains a row and nothing else moves") proving the 400 is inherited.

## 3. Key files

- `apps/invoicing/lib/db/errors.js` — `EMAIL_MAX`, `isEmailShape`, `assertEmail`.
- `apps/invoicing/lib/db/database.js` — re-export `isEmailShape` (the module's public face).
- `apps/invoicing/lib/db/repositories/clients.js` — `create`/`update` use `assertEmail` for `email`.
- `apps/invoicing/lib/auth/accounts.js` — `assertEmailShape` delegates to `isEmailShape`.
- `apps/invoicing/test/repositories.test.js` — new C9 (create), C10 (update).
- `apps/invoicing/test/clients.test.js` — L4 gains malformed-email rows.

## 4. Acceptance criteria (numbered) and their falsifiers (M4)

Red sets are exact: a wider or narrower set is a finding.

- **AC1** `clients.create` with a malformed email throws `ValidationError`, `field === 'email'`,
  and no row is written (row count asserted). Cases: `'no-at'`, `'@x.test'`, `'x@'`,
  `'a@@b.test'`, `'a b@x.test'`, `'a@x.test\n'`, 255 chars; 254 chars accepted.
  **F1:** in `clients.js` `create`, replace `assertEmail(input.email, 'email')` with
  `assertText(input.email, 'email')`. Expected red: `{repositories C9, clients L4}`.
- **AC2** `clients.update` with a malformed email throws the same and leaves the row
  byte-identical (`getById` deepEquals the pre-update row).
  **F2:** in `clients.js` `update`, replace `assertEmail(patch.email, 'email')` with
  `assertText(patch.email, 'email')`. Expected red: `{repositories C10}`.
- **AC3** The check lives in exactly one place: `grep -n "indexOf('@')" apps/invoicing/lib`
  hits `lib/db/errors.js` once and nothing else; `accounts.js` has no private copy.
  **F3:** in `errors.js`, make `isEmailShape` return `typeof value === 'string'`.
  Expected red: `{repositories C9, C10, clients L4, auth H6}` — H6 going red is the
  proof that sign-up rides the lifted predicate, not a survivor copy.
- **AC4** Email ceiling 254. **F4:** `EMAIL_MAX` → `1000`. Expected red:
  `{repositories C9, auth H6}` (H6's 263-character case).
- **AC5** The route adds none: `git diff master...feat/AS-67-client-email-validation -- apps/invoicing/routes` is empty. (Structural; reviewer checks with git.)
- **AC6** Existing call sites in `test/repositories.test.js`, `test/contracts.test.js`,
  `test/invoices.test.js` pass unchanged — none is edited.
- **AC7** No new dependency: `package.json` / `package-lock.json` untouched. No
  migration: `lib/db/migrations/` untouched, `SCHEMA_VERSION` unchanged.
- **AC8** `accounts.js` still answers `AuthError('invalid-email')`: `test/auth.test.js` is unedited and green.

## 5. Predicted counts

Baseline (post-AS-48 master): invoicing `492 / 473 pass / 0 fail / 19 skipped`.
Predicted after: **494 / 475 / 0 / 19** (+C9, +C10; L4 and H6 gain cases, not tests).

## 6. What the reviewer runs

- `node apps/chat/bin/compose-run.mjs --project asc-review-as67-<qa> --cwd <worktree>/apps/invoicing` — void without the `Image … Built` line; compare to 494.
- The four mutants in §4, host-side is fine for the reds (`node --test test/repositories.test.js test/clients.test.js test/auth.test.js` from the worktree's `apps/invoicing`, Node 24 has `node:sqlite`); restore, `git diff --exit-code`.
- AC3's grep, AC5's diff, AC7's `git diff --stat` on `package*.json` and `migrations/`.
- Probe past the list (M6): unicode whitespace (` ` is matched by `\s` — say so),
  an `@` at index 0 vs 1, an email that is only `@`.

## 7. Known residual, in the open (not this task)

The invoice form's `intent=add-client` (`routes/invoices.js`) calls `repos.clients.create`
with the typed values, untrimmed. After AS-67 a malformed or trailing-space email
there is a `ValidationError` caught by the screen wrapper → **text/plain 400**, where
before it was stored and refused by Stripe at finalize as a 502. Strictly better, but
not the `S4-CLIENT-ERROR-VALIDATION` re-render the wireframes name; the screen's view
model (`lib/screens/invoice-form-view.js` `clientFieldErrors`) knows only "required".
Rendering that state — and trimming at the screen — is AS-46's surface, a behaviour
gap for the orchestrator to triage, not a route-level check (D6). The same argument
applies to `freelancers.create` (`assertText` on email; the service validates above
it) — noted, not filed: the service is the only caller and already checks.
