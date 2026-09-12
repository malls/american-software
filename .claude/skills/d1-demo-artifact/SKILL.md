---
name: d1-demo-artifact
description: Capture, build and publish the viewable D1 demo artifact — one real run of the core-loop walkthrough (apps/invoicing/demo) plus screenshots of screen 1, as one hosted page. Use when the demo's transcript changes, a screen merges and needs re-capturing, or the board asks to see the app in action.
---

# d1-demo-artifact — the board's demo as something you can look at

`apps/invoicing/demo/run.mjs` prints a narrated walkthrough of the v1 core
loop; `docs/demo/d1/` holds the committed capture of one run (`transcript.txt`,
five PNGs of screen 1, `capture.json`). This skill turns that directory into
one hosted Artifact. The directory is the record; the artifact is a projection
of it. **Never hand-edit the generated HTML, the transcript, or a PNG** — a fix
belongs in `run.mjs` (then re-run) or in a re-capture.

## The derivation chain

```
apps/invoicing/demo/run.mjs            ← the walkthrough (AS-90); SEQUENCE is what AS-49 lifts
  └─ docs/demo/d1/transcript.txt       ← exactly the stdout of one `docker compose run --rm --build demo`
apps/invoicing/views/signin.ejs        ← screen 1 (AS-45, merged 95b5ee5)
  └─ docs/demo/d1/screen-1-*.png       ← capture.mjs, host Chrome over CDP against a running `web`
docs/demo/d1/capture.json              ← which commits, which Chrome, which states, when
docs/design/tokens/tokens.css          ← the look (AS-29); inlined by build.mjs
       └─ the Artifact                 ← what this skill publishes
```

## Steps

1. **Transcript.** From `apps/invoicing/` (a clean checkout of the branch or
   master you are capturing):
   ```
   DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build demo > /tmp/demo.out; docker compose down
   ```
   The container's stdout begins at the line `D1 core-loop walkthrough (AS-90)`;
   compose v5 prints its build progress on stdout *ahead* of it, so cut there:
   the transcript is everything from that line to the end. Confirm the run
   exited 0 and the output shows `Image … Built`. Save it as
   `docs/demo/d1/transcript.txt`. (Two runs differ only in ids, timestamps,
   signature digests and the loopback port — plan §1.4's normaliser, plus a
   UUID rule, makes them byte-identical.)

2. **Screenshots.** Start the app, then run the capture on the host:
   ```
   (cd apps/invoicing && DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose up --build -d web)
   node .claude/skills/d1-demo-artifact/capture.mjs            # --base, --out, --chrome, --commit to override
   (cd apps/invoicing && docker compose down)
   ```
   Zero dependencies: node's built-in `WebSocket` drives the host's Chrome
   (`/Applications/Google Chrome.app/…`) over the DevTools protocol. It writes
   the four GET states at 375 and 1280 px and the POST-only validation-error
   state at 375 px (reached by pressing the real form's submit button with the
   password blank), and **refuses to write a PNG** unless the page is on the
   base origin, at the path it asked for (a redirect is refused), and stamped
   with the expected `data-state`. Then it writes `capture.json`. If the main
   checkout's `web` already holds 8348, run a one-off on another host port
   instead and pass `--base`:
   `docker compose -p <scratch> run --rm -d --build -p 127.0.0.1:8349:8348 --name <scratch>-web web`.

3. **Build the single-file page:**
   ```
   node .claude/skills/d1-demo-artifact/build.mjs <repo-root> <scratch>/d1-demo.html
   ```
   It inlines `tokens.css` and a token-only page stylesheet, puts the
   CAN/CANNOT block verbatim first under the title, then "how this was made",
   the five screenshots (as `data:` images, with alt text naming state and
   width), a legend, and the transcript with each label rendered as a chip.
   It **throws** rather than publishing a half-page when the CAN/CANNOT block
   is absent or altered (a committed SHA-256 of the block — update
   `BLOCK_SHA256` only together with `run.mjs`), a step has no label, the
   transcript does not end with the epilogue sentence or records a `STOPPED`
   run, a PNG is missing or empty, or `capture.json` disagrees with a file.
   Each check prints its cardinality.

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

## Record

- Artifact URL: `.claude/skills/d1-demo-artifact/artifact-url.txt` (written at
  first publish).
- Built by AS-90 for the board's request "I'd like to see the app in action,
  can you make me a demo?" (DM msg 555, 2026-09-07). First capture taken
  2026-09-12 on `feat/AS-90-d1-demo` against screen 1 as merged in `95b5ee5`.
