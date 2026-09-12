# AS-58 review battery — agent:qa-ruben, 2026-09-12

Branch `feat/AS-58-as38-review-followups` @ 344ddf2, worktree `.worktrees/AS-58`.
Merge-base with master: f566f8e. Master at review time: 8f40cd4 (AS-130 merged
after this branch was cut).

Order of reading: plan → diff → code → probes/mutants → **implementer's comment
LAST**. Independent agreement on all four red sets.

Compose: isolated projects `asc-ruben-as58`, `asc-ruben-as58-master`,
`asc-ruben-as58-seam`; dockerBin `/usr/local/bin/docker` from
`apps/chat/data/deploy-state.json`. Every counted run carries `--build`.
All three projects torn down (`--profile tools down --remove-orphans -v`);
0 `*ruben*` containers and 0 `*ruben*` networks remain; 19 containers belonging
to others were listed and untouched. Probe worktree removed.

## Counted runs (receipt = `Image <name> Built`)

| run | tree | tests/pass/fail/skip | receipt |
|---|---|---|---|
| baseline `test` | branch 344ddf2 | 534/515/0/19 | yes (`asc-ruben-as58-test`) |
| `contract` (stripe-mock) | branch 344ddf2 | 534/534/0/0 | yes (`asc-ruben-as58-contract`) |
| merged-tree seam `test` | master 8f40cd4 + branch, no conflicts, 8 files staged | 534/515/0/19 | yes (`asc-ruben-as58-seam-test`) |
| final `test` after all mutants restored | branch 344ddf2 | 534/515/0/19 | yes |

Logs: `baseline-test.log`, `contract.log`, `seam.log`, `final-test.log`.
Branch worktree after the battery: `git status --porcelain` empty,
`git diff` empty, HEAD 344ddf2.

## Mutants — each one indivisible step

Harness `mutate.mjs`: back up outside the scanned tree (`backup/`), apply,
re-read from disk AND print `git diff` of the mutated site (refuses to proceed
if git sees no change or the anchor is not unique), run with `--build`, record
the red set, restore on `process.on('exit')`, prove `git diff --exit-code` and
`git status --porcelain` clean. Anchor uniqueness asserted = 1 for all four.

| mutant | site | counts | red set (exact) | predicted |
|---|---|---|---|---|
| F1 `'user-agent': 'asc'` in `buildUnsigned` | lib/stripe/client.js:173 | 534/514/1/19 | **1**: `client: the transport receives exactly the guarded request plus authorization` | plan named this test, with `client: GET params go in the query…` as a possible second — observed set is the narrower of the two the plan allowed, recorded here as the exact set. T1 stayed GREEN, which is the point. |
| F2 `redacted()` emits `[redacted]` for an unset secret | lib/config.js:155 | 534/512/3/19 | **3**: `an unconfigured Stripe key is null in the config AND in redacted()…`; `the webhook signing secret is [redacted] when set and null when not…`; `an unconfigured secret redacts to null and the rest of the config is unchanged` | exact match (new test + the two config.test.js null rows) |
| F3 separator set reverted to `&` only | lib/stripe/custody.js:181 | 534/514/1/19 | **1**: `custody: a raw ";" separates pairs the same as "&", in the body and in the query` | exact match ("nothing else") |
| F4 `config: config.redacted?.() ?? null` restored | routes/health.js:23 | 534/514/1/19 | **1**: `GET /healthz carries ok and checks and nothing else — no config, redacted or otherwise (AS-58)` | exact match |

Reports: `F1-report.log` … `F4-report.log`; suite logs `F1-suite.log` …
`F4-suite.log`.

## P1 — custody separator probes (24 driven, in the image's node)

`p1-custody.log`. 10 banned names in the table.

- Refused `banned_parameter` (8/8): body raw `;`; query raw `;`; query leading
  `;`; body leading `;`; body `;;`; `;` + percent-encoded key
  (`subscription_data%5Btransfer_data%5D`); `;` + `TRANSFER_DATA`; `;` + dotted
  `payment_intent_data.transfer_data`. Key and segment correct in every case.
- Passed through, correctly (3/3): percent-encoded `;` in a body value;
  percent-encoded `;` in a query value; an ALLOWED name after a raw `;`.
- Passed through, by design and out of scope (3): raw `,`, raw newline, raw
  space as separators. No standard form parser splits on these; `;` is the one
  extra separator with a real parser family behind it. Not a finding.
- Regex `/[&;]/g` is module-level with the `g` flag: 6 alternating repeat probes
  (A,B × 3) all refused identically — `String.replace` resets `lastIndex`, so no
  cross-call state. Not a finding.
- **Body shapes outside the documented contract (4): all threw
  `TypeError: text.replace is not a function`.** See P3.

## P2 — what `/healthz` actually puts on the wire (`p2-healthz.log`)

5 reachable states examined, 5 pass criterion 4: keys exactly `["ok","checks"]`,
no setting name and no env-var name present in any body.

| state | status | body |
|---|---|---|
| green, real container paths | 200 | `{"ok":true,"checks":[{"name":"config","ok":true},{"name":"vendor_assets","ok":true},{"name":"views","ok":true},{"name":"database","ok":true}]}` |
| vendor_assets (the AS-17 failure) | 503 | detail `"/nonexistent/vendor/tokens.css: ENOENT"` |
| views missing | 503 | detail `"/nonexistent/views: ENOENT"` |
| template cannot render | 503 | detail names all 7 view paths |
| database file deleted under the server | 503 | detail `"<dbPath>: ENOENT"` |

Setting **values** present in the 503 bodies: `vendorDir`, `viewsDir`, `dbPath`
(absolute paths). Setting **names**: none. Env-var names: none.

Method surface, no cookie: `GET` 200, `HEAD` 200, `OPTIONS` 200 `GET, HEAD`,
`POST`/`PUT`/`DELETE` 403 `forbidden-origin`. `?config=1&verbose=1` changes
nothing. No way found to talk the config object back into the body.

## P3 — the body-shape regression, measured on BOTH trees (`p3-master.log`)

| body | master (pre-change) | branch 344ddf2 |
|---|---|---|
| record object `{transfer_data:'x'}` | REFUSED `banned_parameter` | **TypeError** |
| array of pairs | REFUSED `banned_parameter` | **TypeError** |
| `URLSearchParams` instance | REFUSED `banned_parameter` | **TypeError** |
| `Buffer` | TypeError (different message) | TypeError |
| string (the contract) | REFUSED | REFUSED |

Reachability: `lib/stripe/client.js#buildUnsigned` always sets `body` from
`encodeForm(...)`, a string, and the dependency policy lets only `client.js`
import `transport.js` — so no product path reaches this. It fails closed (the
request stops), but with an untyped error instead of a custody code.

**The wrong fix:** `String(text ?? '')`. `String({transfer_data:'x'})` is
`"[object Object]"` — one key, no banned segment — so the record-object case
would fail OPEN. The right fix is an explicit refusal for a non-string body.

## Seam (master 8f40cd4 + branch)

`git merge --no-ff --no-commit`: automatic, 0 conflicts, the same 8 files.
Suite 534/515/0/19 with receipt — identical to the branch, so AS-130's merge
adds no interacting test. Demo run on master and on the merged tree: both
exit 0, 172 lines each, identical after normalising the ephemeral port, the
HMAC timestamp/signature and the UUIDs (14 differing lines, all of that class).
`demo-master.log`, `demo-seam.log`.

## Other checks

- Test file count 23, unchanged; `package.json`/`package-lock.json` not in the
  diff; no new files; 8 files touched, all under `apps/invoicing`; no protected
  top-level file touched.
- dependency-policy, deploy-shape, harness (`V1: the runner can fail`) and
  route-surface guards all green in every counted run.
- `routes/health.js` still uses its `config` argument (`runHealthChecks(config)`),
  so the drop leaves no dead parameter.
- Stale-wording sweep across `README.md`, `lib/`, `routes/`, `test/` for claims
  that `/healthz` prints the config: one survivor, `lib/config.js:14` (Finding 1).
  `routes/assets.js:34` mentions the `vendor_assets` CHECK and is still true.
- No consumer of the dropped field anywhere: `.claude/skills/d1-demo-artifact/capture.mjs`
  reads only `health.status`; the compose healthcheck reads only `r.ok`;
  `demo/` never touches `/healthz` or `redacted()`.
