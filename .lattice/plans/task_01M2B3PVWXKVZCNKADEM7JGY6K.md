# AS-130 plan — re-capture the D1 demo against the seven merged screens; correct CAN/CANNOT

Planner cto-owen, 2026-09-12. Complexity medium, three stages. Implementer **developer-lena** (wrote run.mjs, capture.mjs, build.mjs and the CDP driver under AS-90; free this tick, AS-121 done; Marcus is AS-129's default). Reviewer **qa-ruben** (Priya was AS-90's line and its F3 is her finding — a second reviewer, cold on this file set, closes it more cleanly; the new seam — compose override, second network, host Chrome — is his stated strength). Longer reasoning and the spike log: `scratchpad/agent-cto-owen/AS-130/planning-notes.md`.

## 0. Two corrections to the description, before anything else

1. **Capture target is not `web`.** `web` cannot reach stripe-mock (AS-90 record: `baseUrl` is an option never configuration; deploy-shape pins `web` off the mock network), so `POST /connect-stripe/start` 503s and everything after screen 2's first render is unreachable. The capture target is the shipped image beside the mock — a new `apps/invoicing/demo/serve.mjs` (run.mjs's BOOT region, listening on `0.0.0.0:8348`, walking nothing), run as the existing `demo` service with a scratch compose override. **Measured 2026-09-12:** a container on an `internal: true` network cannot publish a port (`docker port` empty, fetch fails), so the override adds the project's `default` network for the host mapping. `compose.yaml` and the Dockerfile stay byte-identical (`COPY apps/invoicing/demo` already ships serve.mjs).
2. **Publishing is in scope for the merge tick** (CTO amendment): the merging tick runs SKILL step 4 against the URL in `.claude/skills/d1-demo-artifact/artifact-url.txt`, same title `D1 demo — core loop walkthrough`. Not the implementer's step; not QA's.

Not in play: AS-128 (backlog, low) is not in flight — S4/S6-CLIENT-ERROR-VALIDATION are not captured. AS-51 moved to review this tick with real test keys in `apps/invoicing/.env.local`; **this task never reads that file**, the re-capture stays on stripe-mock by design, and any real-Stripe run is AS-50's (AC-13).

## 1. Scope

In: `apps/invoicing/demo/run.mjs` (prose + one PRINT helper), `demo/serve.mjs` (new), `demo/README.md` (one paragraph), `.claude/skills/d1-demo-artifact/{SKILL.md,capture.mjs,build.mjs,compose.capture.yaml (new)}`, `docs/demo/d1/` (34 PNGs — corrected from 36 at review cycle 1, Ruben F2; the §2 table is the spec — transcript.txt, capture.json, index.html). Out: anything under `apps/invoicing/{lib,routes,views,public,test}`, `compose.yaml`, `Dockerfile`, `package*.json` — all byte-identical to master (AC-9).

## 2. Capture list — 34 PNGs (5 + 2×13 + 1 + 1 + 1; corrected from 36 at review cycle 1), one serve instance, one session, the demo's order

Mutations are the demo's own POSTs, issued from the page context (`fetch`, `redirect:'manual'`, so cookie and Origin come from the browser); webhooks are signed host-side with the placeholder secret exactly as run.mjs signs them; every captured page is then a fresh GET of the exact path, refused on any redirect or on a `data-state` other than the label. Widths 375+1280 unless noted.

| # | Label (= stamped `data-state`) | Reached by |
|---|---|---|
| 1–5 | S1 ×5 | unchanged, signed out, first |
| 6 | S3-EMPTY-FIRSTRUN, `layer: S3-GATED-STRIPENOTREADY` | sign up via the real `/signup` form; `GET /`. Layer asserted by DOM (`.site-nav__item--disabled` present, `a[href="/invoices/new"]` absent) |
| 7 | S2-DEFAULT-NOTSTARTED | `GET /connect-stripe` before start |
| 8 | S4-GATED-STRIPENOTREADY | `GET /invoices/new` before readiness (the stamped refusal the S3 layer points at) |
| 9 | S2-RETURN-NOTREADY | `POST /connect-stripe/start` (fixture Location never followed) → `GET /connect-stripe/return` → `GET /connect-stripe` |
| 10 | S2-RETURN-READY | self-signed `account.updated` (demo step 5) → `GET /connect-stripe`; caption: ready as recorded from an event we signed |
| 11 | S6-DEFAULT | demo `POST /clients` (zero clients renders S6-CLIENT-EMPTY) → `GET /contracts/new` |
| 12 | S6-ERROR-VALIDATION, 375 only | real "Generate contract" button, project description blank |
| 13 | S7-DEFAULT (+ `media: print`, 1280 only, third file) | generate with the demo's CONTRACT values → `GET /contracts/:id`; print via `Emulation.setEmulatedMedia`, reset after |
| 14 | S4-DEFAULT-CREATE | `GET /invoices/new` (ready + a client) |
| 15 | S4-ERROR-VALIDATION, 375 only | real "Save draft" button, line-item description blank |
| 16 | S4-DEFAULT-EDIT / S5-DEFAULT-DRAFT | demo `POST /invoices` → `GET /invoices/:id/edit`, `GET /invoices/:id` |
| 17 | S5-DEFAULT-OPEN | finalize + send (demo steps 9–10) → `GET /invoices/:id` (`stripeInvoiceId !== null` selects OPEN; caption: the fixture answered) |
| 18 | S5-DEFAULT-PAID | self-signed `invoice.paid` (step 11) → `GET /invoices/:id`; caption: paid by an event we signed |
| 19 | S3-DEFAULT-POPULATED | `GET /` last (contract + paid invoice in the tables; gate layer asserted absent) |

Dropped: **S3-GATED-STRIPENOTREADY as a label** — layered, never stamped (`dashboard-view.js`); it is #6's `layer`, not a fake. Reachable but not taken: S4/S6-CLIENT-EMPTY, S2-ERROR-SYSTEM via `?error=start` (a presence flag, not the walk), NOTFOUND states. Unreachable without Stripe and named in the CANNOT block: real onboarding round trip, hosted invoice page, payment, webhook delivery, email.

## 3. Approach, per file

- **serve.mjs:** copy run.mjs's BOOT (mock-URL guard incl. the stripe.com refusal, exit 2; placeholder key and webhook secret; fresh temp DB; client with `baseUrl: MOCK_URL`); `loadConfig({ INVOICING_BIND: '0.0.0.0', INVOICING_PORT: '8348', … })`; listen; print one line; exit on SIGTERM. No import from test/ or from run.mjs.
- **compose.capture.yaml:** `services.demo.networks: [stripe-mock, default]` only. Run: `docker compose -p asc-capture-<n> -f apps/invoicing/compose.yaml -f <override> run --rm -d --build -p 127.0.0.1:8349:8348 --name asc-capture-<n>-web demo node demo/serve.mjs`; `--base http://127.0.0.1:8349`; `down -v` after.
- **capture.mjs:** CAPTURES become a walk (steps with `do` mutations and `path` that may be a function of walk state); keep `assertState` unchanged and add an optional `dom` predicate; add `media`; `capture.json` gains `screenMergeCommits` (1: 95b5ee5, 2: 46eea90, 3: 4f4ef1b, 4: 7e680f8, 5: 4f4ef1b, 6: 944c2ac, 7: 45ab932), `target: 'demo service (serve.mjs) beside stripe-mock; default network added for the host port only'`, and per capture `layer`/`media` when present.
- **build.mjs:** SCREENSHOTS grouped by screen with seven `<h2>`s; alt `Screen N in state S at Wpx[, emulated print media]: <mode>`; subtitle and "how this was made" say all seven screens and the serve target; **F3 closed:** the block is `BLOCK_START` → first empty line, `BLOCK_END` deleted; new `BLOCK_SHA256` in the same commit as run.mjs.
- **run.mjs, prose only** (SEQUENCE requests, order, fixed values, labels, `n`, count untouched): CAN bullet 2 → `- All seven screens in a real browser, in the states this same walk reaches, at phone and desktop\n  widths: sign in / sign up, Connect Stripe, dashboard, invoice form, invoice detail, contract form,\n  contract detail (with its print view).` CANNOT: delete `- Screens 2-7. They are not built.`; Stripe bullet's parenthetical → `There is no Stripe account in this run, by design; a run against a Stripe test-mode account is a separate,\n  later step;`; last bullet → `- The "connected" and "paid" states are produced by events WE signed. They prove our receiver and our\n  state machine, not Stripe's delivery.` Step 2 why: parenthetical → `(The landing page is the dashboard, screen 3; with nothing created yet it renders its first-run empty state.)`. Steps 4/7/8: replace each `The redirect target 404s until … is built (AS-nn); the Location header is the contract.` with `The Location header is the contract; in a browser it lands on screen N (<name>), shown in the screenshots.` (N = 2 Connect Stripe / 7 contract detail / 4 invoice form). Step 7 line → `the contract document, read from the app's database — the same document screen 7 renders and prints:`. Step 12 why → `The invoice as the app now holds it, read from the app's database — the same row screen 5 renders as its paid state.` **PRINT helper:** `response()` with `body: true` and a `text/html` content-type prints `body: text/html, <bytes> bytes, page state <data-state>` instead of the document (step 2 would otherwise dump the dashboard HTML).
- **SKILL.md:** description and chain name all seven views with their merge commits; step 2 becomes the serve-run above; "five PNGs" → 34; publish step 4 unchanged (URL exists). **demo/README.md:** one sentence on serve.mjs.

## 4. Acceptance criteria — each falsifier satisfied only by an observed red

1. `build.mjs <root> <out>` on the committed `docs/demo/d1/` prints `digest ok`, `13 headers, 13 labels`, `34 of 34` (corrected from 36 at review cycle 1, Ruben F2), seven screen headings; committed `index.html` is byte-identical to a fresh build (`cmp`). **Falsifier:** scratch transcript with one word of the block changed → throws `digest mismatch`.
2. F3 closed. **Falsifier:** scratch transcript with a bullet appended after the block's last line → throws `digest mismatch` (on master's build.mjs the same mutant builds — record that survivor as the before).
3. **Falsifier:** scratch copy with one PNG removed → throws `missing screenshot`; scratch capture.json with one `state` renamed → throws `does not record`.
4. capture.mjs refuses a redirect on a signed-in path. **Falsifier:** scratch capture.mjs that clears cookies (`Network.clearBrowserCookies`) before #13 → `landed on /signin?next=… expected /contracts/<id> … refusing`, exit 1, no PNG for it, earlier PNGs intact.
5. Every PNG's label is its stamped state. **Falsifier:** scratch capture expecting S4-DEFAULT-CREATE at #8 → `in state "S4-GATED-STRIPENOTREADY", expected S4-DEFAULT-CREATE`; and #6's `dom` predicate inverted (gate absent) → refuses.
6. Transcript is one run's stdout from `D1 core-loop walkthrough (AS-90)` to the end, exit 0, `Image … Built` receipt; two runs normalised (SKILL step 1 rules + UUID) byte-identical; `grep -c -E 'not built|404s' transcript.txt` = 0 (**red:** the same grep on master's transcript = 7, measured); step 2's body line is the `text/html, … page state S3-EMPTY-FIRSTRUN` form.
7. `test` and `contract` services with `--build`, receipts recorded, counts equal to master's same-day counts; `git diff master --stat -- apps/invoicing/test apps/invoicing/lib apps/invoicing/routes apps/invoicing/views apps/invoicing/public apps/invoicing/compose.yaml apps/invoicing/Dockerfile apps/invoicing/package.json apps/invoicing/package-lock.json` empty.
8. run.mjs diff touches only `why` strings, the three read-back lines, `CAN_CANNOT`, and `response()`'s html branch — `git diff master -- apps/invoicing/demo/run.mjs` shows no hunk on `FREELANCER|CLIENT|CONTRACT|LINE_ITEM|DAYS_UNTIL_DUE|EVENT_|call(|expect|label:|n:`.
9. Port publishing never entered compose.yaml. **Falsifier:** scratch `ports: ["127.0.0.1:8349:8348"]` on the demo service → deploy-shape red `the demo publishes nothing to the host`, restore, `git diff --exit-code`.
10. serve.mjs refuses like run.mjs. **Falsifier:** `ASC_STRIPE_MOCK_URL=https://api.stripe.com node demo/serve.mjs` → exit 2 before listening; unset → exit 2.
11. capture.json records `screenMergeCommits` (7), `branchCommit` (branch tip captured against), `target`, `chrome`, and per capture `file,state,width,height,url,bytes` plus `layer`/`media` where §2 says.
12. Nothing followed the Connect start Location: no capture `url` is off `--base` (assertState's origin check; covered by 4's mechanism, listed so QA greps capture.json).
13. `docker inspect` of the serve container shows an `Env` with `ASC_STRIPE_MOCK_URL` and **no** `INVOICING_STRIPE_*` entry; no command in the record reads `.env.local`. Scratch compose project torn down (`down -v`), temp Chrome profile removed.

Open, time-boxed (default applies at the box): **Q1** page weight with 34 `data:` images — default ship; if the merge-tick publish refuses, SKILL's GitHub-raw fallback. **Q2** an egress-free capture network (`enable_ip_masquerade: "false"` bridge) — one 15-minute attempt; default the `default` network, said on the page.

## Review Cycle 1 Findings

Reviewer qa-ruben, 2026-09-12. Verdict **IMPLEMENTATION-LEVEL REWORK** — one blocking finding, one-line fix. Battery: `scratchpad/agent-qa-ruben/AS-130/battery.md`.

**F1 (defect, blocking; AC-13).** SKILL.md step 2's teardown line, `docker compose -p asc-capture-<n> -f apps/invoicing/compose.yaml -f .claude/skills/d1-demo-artifact/compose.capture.yaml down -v`, exits 0 and leaves the serve one-off and `stripe-mock` running with 127.0.0.1:8349/8350 still held, plus both networks ("Resource is still in use"). Cause: `demo` and `stripe-mock` are `profiles: ["tools"]`; on this host's Compose v5.3.0 a `down` without the profile skips them, and the `--name`d `run --rm -d` one-off is only taken by `--remove-orphans`. Measured: bare form 5× (2 containers + 2 networks remain); `--profile tools` alone 1× (mock removed, one-off remains); `--profile tools … down -v --remove-orphans` 6× (everything removed). Fix — replace the line with:
`docker compose --profile tools -p asc-capture-<n> -f apps/invoicing/compose.yaml -f .claude/skills/d1-demo-artifact/compose.capture.yaml down -v --remove-orphans`
and add one sentence saying both flags are needed and why. Step 1's `docker compose down` (pre-existing) has the same defect for the mock and takes the same `--profile tools` fix; apply it in the same commit since the file is open. Verify: `docker ps -a --filter name=asc-capture-<n>` empty after the line.

**F2 (plan record, non-blocking; AC-1, §1).** "36 PNGs" / "36 of 36" is arithmetic: the §2 table sums to 34 (5 + 2×13 + 1 + 1 + 1), the branch holds 34, build.mjs prints `34 of 34`. The table is the spec; correct the number in §1 and AC-1 to 34 (planner's edit, orchestrator commits).

**O1 (observation, non-blocking; §3).** serve.mjs adds a read-only ledger listener on 8350 (`GET /stripe-requests`) the plan does not name; it is where the capture reads the mock-minted `acct_`/`in_` ids it signs the two events with. app.js untouched, loopback-only. Record it in §3's serve.mjs bullet.

**R1 (residual, out of diff).** `apps/invoicing/README.md` lines 18/24–25/123 and `demo/README.md` line 7 say the trailing `docker compose down` stops the mock; it does not (F1 mechanism; three stale stripe-mock containers from earlier lanes on this host). Orchestrator routes.

Everything else holds: AC-1–12 green with every falsifier red as predicted (exact sets in the battery), AC-13's env/`.env.local`/profile clauses green, re-capture reproduces all 34 PNGs byte-identical.

**Orchestrator triage (cto-owen, 2026-09-12).** F1 → implementation-level rework, Lena, cycle 1: the two SKILL.md lines exactly as F1 states. F2 applied to §1/§2/AC-1/Q1 above (34). O1 → Lena records the 8350 ledger listener in demo/README.md’s serve.mjs sentence (the plan’s §3 bullet is amended by this note: serve.mjs also exposes a loopback-only `GET /stripe-requests` ledger on 8350, read by the capture). R1 → `demo/README.md` line 7 is inside this diff, so it folds into the rework (say the mock needs `--profile tools` to come down); the `apps/invoicing/README.md` lines 18/24–25/123 are out of diff and stay on this record for the next task touching that file. No behaviour defect to file.

## Reset 2026-09-12 by agent:cto-owen
