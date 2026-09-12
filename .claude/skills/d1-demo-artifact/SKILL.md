---
name: d1-demo-artifact
description: Capture, build and publish the viewable D1 demo artifact — one real run of the core-loop walkthrough (apps/invoicing/demo) plus screenshots of all seven screens (sign in / sign up 95b5ee5, Connect Stripe 46eea90, dashboard 4f4ef1b, invoice form 7e680f8, invoice detail 4f4ef1b, contract form 944c2ac, contract detail 45ab932) in the states the same walk reaches, as one hosted page. Use when the demo's transcript changes, a screen merges and needs re-capturing, or the board asks to see the app in action.
---

# d1-demo-artifact — the board's demo as something you can look at

`apps/invoicing/demo/run.mjs` prints a narrated walkthrough of the v1 core
loop; `docs/demo/d1/` holds the committed capture of one run (`transcript.txt`,
34 PNGs across the seven screens, `capture.json`). This skill turns that
directory into one hosted Artifact. The directory is the record; the artifact
is a projection of it. **Never hand-edit the generated HTML, the transcript, or
a PNG** — a fix belongs in `run.mjs` (then re-run) or in a re-capture.

## The derivation chain

```
apps/invoicing/demo/run.mjs            ← the walkthrough (AS-90); SEQUENCE is what AS-49 lifts
  └─ docs/demo/d1/transcript.txt       ← exactly the stdout of one `docker compose run --rm --build demo`
apps/invoicing/demo/serve.mjs          ← the same BOOT region, listening instead of walking (AS-130)
apps/invoicing/views/signin.ejs        ← screen 1 (AS-45, merged 95b5ee5)
apps/invoicing/views/connect-stripe.ejs← screen 2 (AS-70, merged 46eea90)
apps/invoicing/views/dashboard.ejs     ← screen 3 (AS-48, merged 4f4ef1b)
apps/invoicing/views/invoice-form.ejs  ← screen 4 (AS-46, merged 7e680f8)
apps/invoicing/views/invoice-detail.ejs← screen 5 (AS-48, merged 4f4ef1b)
apps/invoicing/views/contract-form.ejs ← screen 6 (AS-127, merged 944c2ac)
apps/invoicing/views/contract-detail.ejs ← screen 7 (AS-47, merged 45ab932)
  └─ docs/demo/d1/screen-N-*.png       ← capture.mjs, host Chrome over CDP, one walk against serve.mjs beside stripe-mock
docs/demo/d1/capture.json              ← which commits, which Chrome, which target, which states, when
docs/design/tokens/tokens.css          ← the look (AS-29); inlined by build.mjs
       └─ the Artifact                 ← what this skill publishes
```

## Steps

1. **Transcript.** From `apps/invoicing/` (a clean checkout of the branch or
   master you are capturing):
   ```
   DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build demo > /tmp/demo.out; docker compose --profile tools down
   ```
   `--profile tools` on the `down` is what stops stripe-mock: `demo` and
   `stripe-mock` sit under that profile, and a `down` that loads the compose
   file without it exits 0 while skipping them (measured 2026-09-12, Compose
   v5.3.0); check with `docker ps -a --filter name=asc-invoicing`.
   The container's stdout begins at the line `D1 core-loop walkthrough (AS-90)`;
   compose v5 prints its build progress on stdout *ahead* of it, so cut there:
   the transcript is everything from that line to the end. Confirm the run
   exited 0 and the output shows `Image … Built`. Save it as
   `docs/demo/d1/transcript.txt`. (Two runs differ only in ids, timestamps,
   signature digests and the loopback port — plan §1.4's normaliser, plus a
   UUID rule, makes them byte-identical.)

2. **Screenshots.** The capture target is the **demo service**, not `web`:
   `web` is deliberately off the stripe-mock network and its client is built
   against api.stripe.com, so a walk against it 503s at Connect start. Start
   `demo/serve.mjs` (run.mjs's BOOT region as a server) with the capture
   override, which adds the project's `default` network so the host ports can
   be published (a container on an `internal: true` network alone cannot
   publish — measured 2026-09-12), then run the capture on the host:
   ```
   docker compose -p asc-capture-<n> -f apps/invoicing/compose.yaml -f .claude/skills/d1-demo-artifact/compose.capture.yaml \
     run --rm -d --build -p 127.0.0.1:8349:8348 -p 127.0.0.1:8350:8350 --name asc-capture-<n>-web demo node demo/serve.mjs
   node .claude/skills/d1-demo-artifact/capture.mjs --base http://127.0.0.1:8349 --ledger http://127.0.0.1:8350 --commit <sha>
   docker compose --profile tools -p asc-capture-<n> -f apps/invoicing/compose.yaml -f .claude/skills/d1-demo-artifact/compose.capture.yaml down -v --remove-orphans
   ```
   Both teardown flags are needed: `--profile tools` because `demo` and
   `stripe-mock` sit under that profile and a `down` without it skips them
   (the mock stays up and both networks report "still in use"), and
   `--remove-orphans` because the `--name`d `run --rm -d` one-off is not a
   service container `down` would otherwise remove (it stays up holding 8349
   and 8350). Measured 2026-09-12, Compose v5.3.0: the bare `down -v` exits 0
   leaving 2 containers, 2 networks and both ports held; the line above leaves
   nothing. Check: `docker ps -a --filter name=asc-capture-<n>` prints nothing.
   Zero dependencies: node's built-in `WebSocket` drives the host's Chrome
   (`/Applications/Google Chrome.app/…`) over the DevTools protocol. It walks
   the demo's own path in the demo's order — signs up through the real form,
   issues the demo's POSTs from the page (redirect never followed; the Connect
   start Location is a fixture URL), signs the demo's two events host-side with
   the placeholder secret — and screenshots a **fresh GET** of every page at
   375 and 1280 px (POST-only validation states at 375 px, pressed through the
   real button; screen 7's print view under emulated print media). It
   **refuses to write a PNG** unless the page is on the base origin, at the
   path it asked for (a redirect is refused), stamped with the expected
   `data-state`, and — for screen 3's gate layer — showing the DOM the label
   implies. The two mock-minted ids the events name come from serve.mjs's
   ledger on 8350 (`GET /stripe-requests`: the Stripe paths the app made, the
   list run.mjs prints as "Stripe requests the app made"). Then it writes
   `capture.json`. The serve container has a default gateway the transcript's
   container does not; it still has no Stripe key, and `capture.json`'s
   `target` says so.

3. **Build the single-file page:**
   ```
   node .claude/skills/d1-demo-artifact/build.mjs <repo-root> <scratch>/d1-demo.html
   ```
   It inlines `tokens.css` and a token-only page stylesheet, puts the
   CAN/CANNOT block verbatim first under the title, then "how this was made",
   the screenshots grouped by screen under seven headings (as `data:` images,
   with alt text naming screen, state, width and media), a legend, and the
   transcript with each label rendered as a chip. It **throws** rather than
   publishing a half-page when the CAN/CANNOT block is absent or altered (a
   committed SHA-256 of the block, which runs from `WHAT THIS DEMO CAN SHOW` to
   the first empty line — update `BLOCK_SHA256` only together with `run.mjs`),
   a step has no label, the transcript does not end with the epilogue sentence
   or records a `STOPPED` run, a PNG is missing or empty, `capture.json`
   disagrees with a file (state, width, layer, media, or count), or it names no
   merge commit for a screen. Each check prints its cardinality.

4. **Publish to the SAME artifact**, using the URL in `artifact-url.txt`:
   ```
   Artifact(file_path: "<scratch>/d1-demo.html", url: "<contents of artifact-url.txt>")
   ```
   Read it first (`action: "read"` with that url) if this conversation has not
   already published it. On the first publish, create it with the title
   `D1 demo — core loop walkthrough` and write the URL to `artifact-url.txt`
   in the same commit.

5. **Commit** `docs/demo/d1/` (and `artifact-url.txt` if it changed) under the
   task that re-captured.

## Rules that keep the artifact stable

- **Same URL, always.** Passing `url` updates in place; omitting it creates a
  second artifact.
- **Same title.** It lives in `build.mjs`.
- **`data:` images.** If the Artifact CSP ever blocks them (plan Q1), the PNGs
  are still the committed record; switch `<img src>` to their GitHub raw URLs
  in `build.mjs` and say so on the page.
- **The transcript is exactly one run's stdout.** Never splice two runs, never
  edit a line. If the demo's wording changes, re-run it.
- **Re-capture cadence:** each screen task re-runs steps 1–5 at its merge and
  appends its screenshots (plan Q5); the SEQUENCE does not change until AS-49.
  AS-130 caught the six screens that merged without doing so.

## Record

- Artifact URL: `.claude/skills/d1-demo-artifact/artifact-url.txt` (written at
  first publish).
- Built by AS-90 for the board's request "I'd like to see the app in action,
  can you make me a demo?" (DM msg 555, 2026-09-07). First capture taken
  2026-09-12 on `feat/AS-90-d1-demo` against screen 1 as merged in `95b5ee5`.
- Re-captured under AS-130 (2026-09-12) against all seven screens, with the
  CAN/CANNOT block corrected to say so.
