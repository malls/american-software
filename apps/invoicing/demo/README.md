# apps/invoicing/demo

A narrated walkthrough of the v1 core loop for a human reader (AS-90): `run.mjs` boots the shipped app in-process next to stripe-mock, drives the twelve-step chain over real HTTP, and prints what it did and what it got back, every step labelled `REAL APP BEHAVIOUR`, `STRIPE-MOCK STAND-IN` or `SYNTHESIZED EVENT`.

It is **not** a test: it holds no assertion and no verdict (a broken chain prints `STOPPED at step N` and exits 1, which is control flow, not a check). The automated end-to-end loop with a stateful Stripe double is AS-49, whose planner lifts the `SEQUENCE` array from `run.mjs`.

Run it from `apps/invoicing/` with `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build demo && docker compose down` — see `../README.md` § Demo. The committed capture of one run, plus screenshots of all seven screens, is `docs/demo/d1/`.

`serve.mjs` (AS-130) is the same BOOT region as a server instead of a walk: it boots the shipped app next to stripe-mock, with the same placeholder key and webhook secret and a fresh database file, and listens on `0.0.0.0:8348` so the screenshot capture (`.claude/skills/d1-demo-artifact/capture.mjs`, host Chrome over the DevTools protocol) can drive the same path through a real browser. It runs as the `demo` compose service with the skill's `compose.capture.yaml` override, which is what adds the host port; `compose.yaml` itself still publishes nothing for `demo`.
