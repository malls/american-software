# AS-71: Vendor the states ledger into the image so a design change can turn the suite red

**Planner + implementer:** Marcus Webb (`agent:developer-marcus`), two-stage path, `complexity: low` (confirmed after exploration — see §0). **Reviewer:** Priya (`agent:qa-priya`), next tick. Written 2026-09-12, tick watcher:79108 loop tick 15.

## §0 What changed since this was filed, and the complexity check

The description was written on 2026-09-02 when only screen 1 had a transcription and "two unrenderable rows" existed. Today all seven screens are in (AS-45/70/48/46/47a/47b/49-adjacent), each view module exports a frozen `*_LEDGER` (`lib/screens/{signin,connect,dashboard,invoice-form,invoice-detail,contract-form,contract-detail}-view.js`) and each test file carries a second hand transcription compared against it (`screens.test.js`, `read-screens.test.js`, `invoice-screen.test.js`, `contract-screens.test.js`). Seven `LOADING` rows are `unrenderable — browser-supplied`, eight rows are `n/a`. The shape the description asks for is unchanged; the cardinality is 7 screens / 65 rows instead of 1 / 8.

Complexity stays **low**: one Dockerfile `COPY`, three pinned literals moved plus one new pin in `deploy-shape.test.js`, one strict parser helper, one new test file with one case per screen, a two-line registry constant, and two prose-only row amendments in the ledger. No runtime code path changes; the server never reads the new file.

## §1 Decisions

1. **Vendor to `./vendor/states-ledger.md`, the tokens mechanism exactly.** `COPY docs/design/wireframes/02-states-ledger.md ./vendor/states-ledger.md` immediately after the tokens line. Resolved in tests through `configFor().vendorDir` (the real `/app/vendor` in the mountless `test` service), the same way `assets.test.js` reaches `tokens.css`. `vendor/` is the right namespace: it is the directory of things this app consumes and never owns.
2. **Not a `VENDOR_ASSETS` entry.** `VENDOR_ASSETS` is the registry of *served* assets: `routes/assets.js` registers a route per entry and `health.js` checks each one. The ledger is a design document; serving it from the product would make it public surface and health would take the app down over a doc. It is registered separately as `VENDOR_DOCUMENTS` in `lib/vendor.js` (`{ file, source }`, frozen, one entry), consumed only by tests: `deploy-shape.test.js` joins the Dockerfile COPY to it, `states-ledger.test.js` locates the file by it. `VENDOR_ASSETS.length === 1`, the health check, and `assets.test.js` are untouched.
3. **What is parsed.** A strict markdown-table parser in `test/helpers/states-ledger.js` (test-only, no runtime import — `dependency-policy` unaffected). It recognises exactly: `## <n>. Screen <n> — <title>` headings (the two numbers must agree), the header row `| Row ID | Category | Trigger | What renders |` followed by its `|---|` separator, and data rows of exactly four cells whose first cell is a backticked id `S<n>-…` with `<n>` equal to the enclosing section's screen number and whose category is one of the six shorthands (DEFAULT/LOADING/EMPTY/ERROR/GATED/ABANDON). §0's shared sub-pattern table (`| Row ID pattern | …`) is recognised and skipped by name — its rows are already expanded into §4 and §6. §8's `= **65 states across 7 screens.**` line is parsed as `declared`. Anything else throws (the `deploy-shape.test.js` doctrine: a parser that shrugs makes every assertion above it vacuous). A document that yields zero rows throws.
4. **An n/a row is one whose Trigger starts `n/a — `**, and the parser requires its "What renders" cell to carry `n/a row` too — the two markers must agree or the row is rejected. A row is `LOADING` by its Category cell.
5. **The joins asserted, per screen** (cardinality first, then membership, both directions):
   - the module ledger's id set equals the document's id set for that screen, and both counts equal the committed number (8, 9, 7, 12, 10, 11, 8);
   - the module's `n/a` rows equal the document's n/a rows exactly;
   - the module's `unrenderable — browser-supplied` rows equal the document's `LOADING` rows exactly — this is how "their absence stays an assertion rather than a silent gap" is kept: the absence is now asserted against the design document, not against a second transcription;
   - every rendered state is a document row that is not n/a.
   Dispositions other than those (rendered / redirect-answered / path-into-render / layered / rendered-as) are the product's answer to the document, not something the document states, so they stay pinned where they are: the existing hand transcriptions in the four test files are **kept**, and their header comments are corrected to say what is now mechanically joined.
6. **Whole-document cardinality** is asserted once: 7 screens, 65 rows, `declared === 65`, 8 n/a rows by exact id list, 7 LOADING rows, ids unique.
7. **The folded-in S2-REFRESH question — amend the ledger, do not change behaviour.** Priya's AS-69 F1: the row says "`S2-ERROR-SYSTEM` if minting fails", but a failed refresh mint answers text/plain (`routes/connect.js` `handle()`, `statusFor`), `connect.test.js` R9/R9b pin it, and `screens.test.js` pins the negative ("S2-REFRESH and S2-LOADING never render this screen"). Changing behaviour means a new render path in `routes/connect.js` plus rewriting AS-69/AS-70 pins — a behaviour task, not this one, and AS-69 chose the start path deliberately. The boring choice is to make the document say what the product does. The "What renders" cell becomes: *"Transient — mints a fresh account link, immediately redirects back into Stripe's flow. If minting fails the refresh handler answers a plain-text error status and never renders this screen (`S2-ERROR-SYSTEM` is reached from the start path only; routing a refresh failure into the screen is a later product decision)."* Row id and category are unchanged, so the join is unaffected. If the CTO wants the behaviour instead, that is a filed task and the sentence reverts with it.
8. **The folded-in S2-ABANDON wording** (AS-45 plan §9 Q3, carried through AS-70 §0.4): applied verbatim from that record to the "What renders" cell. Row id and category unchanged.
9. Both amendments edit `docs/design/wireframes/02-states-ledger.md` only. The wireframe HTML's section prose for those two rows is not touched (a rendering of the ledger, owned by AS-30's method; noted for Jonah in the stage comment — the CTO routes it).
10. **`README.md` (the app's, not the top-level one):** the "What the state guarantee claims" paragraph is rewritten to describe the mechanical join; the `tokens.css` section gains one sentence naming the second vendored file. No protected top-level file is touched.

## §2 Files

| Path | Change |
|---|---|
| `apps/invoicing/Dockerfile` | one `COPY` line + comment, after the tokens COPY |
| `apps/invoicing/lib/vendor.js` | `VENDOR_DOCUMENTS` export + comment |
| `apps/invoicing/test/helpers/states-ledger.js` | new: `parseStatesLedger(text)` |
| `apps/invoicing/test/states-ledger.test.js` | new: 9 cases (§3) |
| `apps/invoicing/test/deploy-shape.test.js` | `COPIES.length` 10→11; "no second copy" test asserts the exact two vendor dests; new test pinning the ledger COPY source/dest and its join to `VENDOR_DOCUMENTS` |
| `apps/invoicing/test/screens.test.js` | header comment (lines 9–25) and SCREEN_1/SCREEN_2 doc comments corrected; no assertion changes |
| `apps/invoicing/lib/screens/signin-view.js`, `connect-view.js` | the "nothing reads the design document" comment corrected (the other five modules point at these two) |
| `apps/invoicing/README.md` | two paragraphs |
| `docs/design/wireframes/02-states-ledger.md` | S2-REFRESH and S2-ABANDON "What renders" cells only |

Not touched: any route, template, `VENDOR_ASSETS`, `health.js`, `compose.yaml`, `.dockerignore`, `assets.test.js`, `config.js`, the wireframe HTML, `.worktrees/AS-67`, `.worktrees/AS-113`, any top-level protected file.

## §3 Cases (executable names, `test/states-ledger.test.js`)

1. `states-ledger: the vendored document is in the image and parses to exactly 65 rows across 7 screens`
2. `states-ledger: the parser rejects shapes it does not understand`
3. `states-ledger: screen 1 — the view module's rows are the document's rows, n/a and LOADING included`
4. `… screen 2 …` 5. `… screen 3 …` 6. `… screen 4 …` 7. `… screen 5 …` 8. `… screen 6 …` 9. `… screen 7 …` (same sentence, screen number varies)

And in `deploy-shape.test.js`: `deploy-shape: the states-ledger COPY is present with the exact source path, and matches the registry` (new); `deploy-shape: the image carries no second copy of the tokens file` becomes `deploy-shape: vendor/ is populated by exactly the two registered COPYs`.

**Count:** baseline (merged master, tick 14 receipt) 511 tests / 492 pass / 0 fail / 19 skipped. Predicted **521 / 502 / 0 / 19** (+9 states-ledger, +1 deploy-shape). Re-measured on the branch before changes.

## §4 Acceptance criteria, each with its falsifier (M4)

- **AC-1 A changed row id in the vendored ledger turns exactly the predicted case red.** Falsifier F1: in the worktree, `S2-ABANDON` → `S2-ABANDONED` in `docs/design/wireframes/02-states-ledger.md` (one occurrence at the row; assert applied on disk by occurrence count and in the built image by `docker compose run --rm --build test grep -c S2-ABANDONED /app/vendor/states-ledger.md` = 1). Predicted red set: exactly **{case 4 (screen 2)}**. Case 1 stays green (count and categories unchanged). Restore, hash-prove, rebuild, green.
- **AC-2 A category change on a LOADING row turns the document-side absence assertion red.** Falsifier F2: `S3-LOADING`'s Category cell `LOADING` → `DEFAULT`. Predicted red set: exactly **{case 1 (7 LOADING rows expected), case 5 (screen 3: module unrenderable `['S3-LOADING']` vs document `[]`)}**.
- **AC-3 Dropping the Dockerfile COPY turns the build-contract pins and the reader red.** Falsifier F3: delete the ledger `COPY` line. Predicted red set: `deploy-shape` **{parsers-read-the-manifests (11), states-ledger COPY present, vendor/ exactly two}** + `states-ledger.test.js` **all 9** (the file is absent from the image; every case reads it — case 2 too, because its positive half parses the real text).
- **AC-4 A parse that yields zero rows fails rather than passes.** Falsifier F4: in `test/helpers/states-ledger.js`, remove the `rows.push(row)` in the data-row branch *and* the zero-rows throw (anchored on the function body so the mutation cannot land elsewhere). Predicted red set: **{case 1, cases 3–9}** = 8 of 9; case 2 stays green (its rejections fire before the push).
- **AC-5 The offline suite is green with `network_mode: none`**, counted from a run showing `Image … Built`, at the predicted 521/502/0/19.
- **AC-6 No new dependency** (`package.json`/lockfile untouched — `git diff --stat` shows neither); **no protected top-level file** in the diff; **no running container touched** (only project `asc-impl-as71`, torn down with `down -v --rmi local`).
- **AC-7 The S2-REFRESH and S2-ABANDON amendments change prose only:** the parsed id/category set before and after the docs edit is identical (case 1 and case 4 green on both sides; the diff of the ledger touches exactly two lines).

## §5 Proof procedure

Baseline run on the branch before any change (`-p asc-impl-as71`, `--build`), then implement, then green run, then F1–F4 each: mutate → assert applied at the site (disk count; image count for F1) → predict → run → record the exact red set → restore → `git -C .worktrees/AS-71 diff --exit-code` on the mutated path + `shasum` before/after → rebuild → green. Every quoted number from a run with the Built line. Cardinality (total cases) before quantification (pass/fail). Progress note kept at `scratchpad/developer-marcus/AS-71/progress.md`.
