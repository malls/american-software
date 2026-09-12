# AS-58 mutant table (developer-marcus, low-path proof burden)

Branch tip under test: `feat/AS-58-as38-review-followups` @ 344ddf2, worktree `.worktrees/AS-58`.
Every run: `node apps/chat/bin/compose-run.mjs --project asc-impl-as58-<id> --cwd .worktrees/AS-58/apps/invoicing` (= `compose run --rm --build test`, then `down -v --rmi local --remove-orphans`, leak check). Mutations applied in place by `mutate.mjs` (asserts the pattern occurs once and lands at the intended site), restored with `git checkout -- apps/invoicing` + `git diff --exit-code` (restored=true on all four). Tools: `mutate.mjs`, `run-mutants.mjs`; logs `green.log`, `f1.log` … `f4.log`; raw summary `mutants-summary.txt`.

## Green (baseline, clean tree)

| run | receipt | tests | pass | fail | skipped |
|---|---|---|---|---|---|
| green.log | `Image asc-impl-as58-green-test Built` | 534 | 515 | 0 | 19 |

(AS-57's final was 532/513/0/19; +2 = the new custody test and the new /healthz-shape test; the renamed health test replaced one.)

## Falsifiers — one observed red each

| id | AC | mutation (file, site) | receipt | tests/pass/fail/skip | predicted red set | observed red set |
|---|---|---|---|---|---|---|
| F1 | 1 | `lib/stripe/client.js` `buildUnsigned`: headers gain `'user-agent': 'asc'` | `Image asc-impl-as58-f1-test Built` | 534/514/1/19 | client-level header pin; T1 stays green | 1: `client: the transport receives exactly the guarded request plus authorization` |
| F2 | 2 | `lib/config.js` `redacted()`: `row.secret ? '[redacted]' : …` (unset secret masked instead of null) | `Image asc-impl-as58-f2-test Built` | 534/512/3/19 | the renamed health test + config.test.js null-case rows | 3: `an unconfigured secret redacts to null and the rest of the config is unchanged`; `an unconfigured Stripe key is null in the config AND in redacted(), so the startup line says which it is`; `the webhook signing secret is [redacted] when set and null when not — the operator's only signal (AS-44)` |
| F3 | 3 | `lib/stripe/custody.js`: `PAIR_SEPARATOR = /[&]/g` (`;` no longer a separator) | `Image asc-impl-as58-f3-test Built` | 534/514/1/19 | the new custody test only | 1: `custody: a raw ";" separates pairs the same as "&", in the body and in the query` |
| F4 | 4 | `routes/health.js`: `config: config.redacted?.() ?? null` restored on the body | `Image asc-impl-as58-f4-test Built` | 534/514/1/19 | the new /healthz-shape test only | 1: `GET /healthz carries ok and checks and nothing else — no config, redacted or otherwise (AS-58)` |

All four observed sets equal the predicted sets (cardinality and names). F1's T1 ('transport: sends method, headers and body byte-for-byte…') stayed green under the mutant, which is the point of item 1: the property is not observable there.

## Guards (AC 5)

Green run: dependency-policy, deploy-shape, harness, route-surface, assets all green (0 fail). `package.json` / `package-lock.json` unchanged vs master. Test file count 23 (unchanged; the task description's "8 files" is as of 2026-09-02). No protected top-level files touched. `compose-run --check` after the battery: no `asc-impl-as58-*` project survives.
