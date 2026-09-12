# AS-130 planning notes (cto-owen, 2026-09-12, tick watcher:79108 loop 2 tick 2, on Opus)

Thinking that did not fit the 120-line plan. The plan is the contract; this is the why.

## 1. The description's capture target is wrong, and AS-90 already said so

The description says capture "against a running `web`". AS-90's planning comment (2026-09-12
03:40Z) established that `web` cannot reach stripe-mock: `lib/stripe/client.js` makes `baseUrl`
an option, never configuration; `server.js` builds the client against api.stripe.com; and
`test/deploy-shape.test.js` pins `web` off the mock network. A host-driven walk against `web`
503s at `POST /connect-stripe/start` (no key), so every state after screen 2's first render is
unreachable from `web`. That is why the demo runs as the `demo` compose service in the shipped
image on the internal mock network.

So the capture target has to be the same thing the transcript runs against: the shipped image,
in-process app, next to stripe-mock. New file `apps/invoicing/demo/serve.mjs` = run.mjs's BOOT
region that listens on 0.0.0.0:8348 instead of walking. It rides into the image on the existing
`COPY apps/invoicing/demo ./demo` line — no Dockerfile change, no compose.yaml change.

## 2. Spike: can a container on an internal-only network publish a port? No.

Measured on this host (Docker 29.6.1, 2026-09-12):

    docker network create --internal asc-spike-internal
    docker run --rm -d --network asc-spike-internal -p 127.0.0.1:8351:80 node:24.20.0-slim node -e '<http server on 0.0.0.0:80>'
    fetch http://127.0.0.1:8351/  -> "fetch failed" (twice, 5 s apart)
    docker port asc-spike         -> (empty)

Torn down (container, network). Conclusion: the serve container needs a second, non-internal
network for the host mapping. Done with a scratch compose override file committed under the
skill (`.claude/skills/d1-demo-artifact/compose.capture.yaml`) that adds `default` to the demo
service's networks. `apps/invoicing/compose.yaml` stays byte-identical, so deploy-shape's
"the demo publishes nothing to the host" pin still holds — and the plan makes the implementer
prove that pin is live (AC-9).

Honesty cost: the capture container has a default gateway, unlike the demo container. It has
no Stripe key and its client is built with `baseUrl: ASC_STRIPE_MOCK_URL` (serve.mjs carries
run.mjs's stripe.com refusal), so nothing can reach api.stripe.com, but "no route to the
internet" is a property of the transcript run only. capture.json and the page's "how this was
made" line say so. Parked tangent (Q2 in the plan): a dedicated bridge network with
`com.docker.network.bridge.enable_ip_masquerade: "false"` might allow DNAT-in without SNAT-out.
One attempt, 15 minutes, default is the `default` network.

## 3. The trim

Asked for in the description, kept, and how reached (all through the demo's own POSTs, on one
serve instance, one session, in the demo's order):

- S1 x5: unchanged, signed out, first.
- S3-EMPTY-FIRSTRUN: `GET /` right after sign-up. Stamped. The S3-GATED-STRIPENOTREADY layer is
  visible here (no connected account yet). Asserted by DOM (`.site-nav__item--disabled`
  present, `a[href="/invoices/new"]` absent), recorded as `layer` in capture.json.
- S2-DEFAULT-NOTSTARTED: `GET /connect-stripe` before start.
- S2-RETURN-NOTREADY: after `POST /connect-stripe/start` (redirect NOT followed — the Location
  is a fixture URL) and `GET /connect-stripe/return` (303 back), `GET /connect-stripe`. The
  mock's account fixture is not ready; that is the honest post-return render.
- S2-RETURN-READY: after the self-signed `account.updated` (the demo's step 5, same envelope,
  same placeholder secret). `connect-view.js selectState` renders READY from `account.ready`,
  so it IS reachable. Caption must say "ready as recorded from an event we signed".
- S6-DEFAULT: needs a client (zero clients -> S6-CLIENT-EMPTY, `contract-form-view.js`), so
  after the demo's `POST /clients`.
- S6-ERROR-VALIDATION: press the real "Generate contract" with the project description blank
  (`POST /contracts/new`, same path; 375 only, like S1's).
- S7-DEFAULT: after generating the contract with the demo's values. Print variant: same page,
  `Emulation.setEmulatedMedia({media:'print'})`, 1280 only, recorded `media: 'print'`.
- S4-DEFAULT-CREATE: `GET /invoices/new` with account ready AND a client (else CLIENT-EMPTY /
  GATED). S4-ERROR-VALIDATION: press "Save draft" with the line-item description blank
  (`POST /invoices/new`, same path; 375 only).
- S4-DEFAULT-EDIT: `GET /invoices/:id/edit` after the demo's `POST /invoices`, before finalize.
- S5-DEFAULT-DRAFT: `GET /invoices/:id` at the same point.
- S5-DEFAULT-OPEN: after finalize + send. `invoice-detail-view.js selectState` is
  `stripeInvoiceId !== null -> OPEN`, so the mock's stuck-at-draft mirror status does not block
  it. Caption says the fixture answered.
- S5-DEFAULT-PAID: after the self-signed `invoice.paid`. Caption says "paid by an event we signed".
- S3-DEFAULT-POPULATED: `GET /` LAST, so the tables show the contract and the paid invoice, and
  the gate layer is off (asserted absent).

Changed from the description:
- S3-GATED-STRIPENOTREADY dropped as a capture label: it is layered, never stamped
  (`dashboard-view.js`: "data-state stays the list state"). A PNG labelled with a state the
  root does not carry would fail capture.mjs's own guard — correctly. It appears as the `layer`
  on the first-run capture instead.
- S4-GATED-STRIPENOTREADY added (375 + 1280): the stamped, server-side refusal that the S3
  layer points at; reached honestly at `GET /invoices/new` before readiness. This is the gate
  the ledger calls "a true server-side refusal, not a disabled button dressed as one".

Not taken, reachable, deliberately (no CANNOT line needed — they are not unreachable):
- S4-CLIENT-EMPTY / S6-CLIENT-EMPTY (between readiness and the client POST): 4 more PNGs for
  a picker variant; next re-capture can add them.
- S2-ERROR-SYSTEM via its documented direct URL `?error=start`: a presence flag selecting a
  state, not something the walk produced. Leaving it out rather than captioning around it.
- S1-ERROR-SYSTEM, S5/S7-ERROR-NOTFOUND: reachable but off the loop.
- S4/S6-CLIENT-ERROR-VALIDATION: AS-128 (backlog, low) is not in flight; planned without them.

Genuinely unreachable here (named in the CANNOT block by category, as before): a real Stripe
onboarding round trip, a real hosted invoice page, a real payment, a real webhook delivery,
email. S2-RETURN-READY and S5-DEFAULT-PAID are reached, but by events we signed — the block's
last bullet now names both.

## 4. Step 2's body line would explode

`response(res, { body: true })` prints the raw body. At AS-90 time `GET /` with a cookie
answered a one-line text placeholder; since AS-48 it answers the dashboard HTML, so a re-run
would put a whole HTML document into the transcript. Fix in PRINT, not SEQUENCE: when the
content-type is text/html, print `body: text/html, <n> bytes, page state <data-state>` (regex
the root's `data-state` attribute). The label, the request and the fixed values are untouched;
e2e-loop.test.js copies only the fixed values.

## 5. build.mjs F3 (Priya, AS-90 review) folds in

The block was sliced to a fixed end string, so an appended bullet passed the digest and was
absent from the page. This task touches build.mjs, so per the triage gate it closes here: the
block is everything from `WHAT THIS DEMO CAN SHOW` to the first empty line. BLOCK_END goes away.

## 6. Page weight

Five S1 PNGs = 99 kB. 36 PNGs, signed-in pages heavier at 1280, estimate 1.2–1.8 MB raw,
~2.4 MB as data: URIs. If the Artifact publish refuses at that size the SKILL's stated fallback
(GitHub raw URLs; the repo is public) applies at the merge tick; the committed page stays the
record either way. Default: ship data: URIs.

## 7. Staffing

Lena: wrote run.mjs, capture.mjs, build.mjs and the CDP driver under AS-90; free this tick
(AS-121 done); Marcus is the AS-129 default. Ruben: Priya was AS-90's reviewer and F3 is her
finding — a second reviewer verifying that fix, cold on this file set, is the cleaner check;
Ruben's stated strength is seams, and the new seam (compose override + second network + host
Chrome) is exactly that.

## 8. AS-51 / real keys

AS-51 moved to review this tick after the board added the Stripe test keys to
apps/invoicing/.env.local. This task never reads that file and the serve container's
environment is exactly the demo service's (ASC_STRIPE_MOCK_URL only) — AC-13 makes the
implementer show that with `docker inspect`. A run against real Stripe is AS-50's, not this.
