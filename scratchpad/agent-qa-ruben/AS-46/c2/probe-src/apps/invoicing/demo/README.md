# apps/invoicing/demo

A narrated walkthrough of the v1 core loop for a human reader (AS-90): `run.mjs` boots the shipped app in-process next to stripe-mock, drives the twelve-step chain over real HTTP, and prints what it did and what it got back, every step labelled `REAL APP BEHAVIOUR`, `STRIPE-MOCK STAND-IN` or `SYNTHESIZED EVENT`.

It is **not** a test: it holds no assertion and no verdict (a broken chain prints `STOPPED at step N` and exits 1, which is control flow, not a check). The automated end-to-end loop with a stateful Stripe double is AS-49, whose planner lifts the `SEQUENCE` array from `run.mjs`.

Run it from `apps/invoicing/` with `DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build demo && docker compose down` — see `../README.md` § Demo. The committed capture of one run, plus screenshots of screen 1, is `docs/demo/d1/`.
