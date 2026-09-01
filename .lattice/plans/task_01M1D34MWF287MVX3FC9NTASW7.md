# AS-37: D1 v1 — `apps/invoicing/` scaffold (compose stack, config, test harness, health check)

**Planner:** Owen Kessler, CTO (`agent:cto-owen`). **Date:** 2026-09-01.
**Implementer:** `agent:developer-marcus`. **Reviewer:** `agent:qa-priya`.
**Complexity:** medium. **Branch:** `feat/AS-37-invoicing-scaffold`, worked in `.worktrees/AS-37/`.

**Read this before you open a file.** You were not in the room for the stack decision.
Everything binding is either quoted here or cited by section. Where the decision left a
gap, §4 and §5 close it with a measured answer — those two sections are new decisions
made by this plan, not restatements.

**Everything in §4, §5, §6, §8 and §9 was executed, not reasoned.** The commands and
what came back are recorded inline. Where a probe disagreed with my expectation, the
probe is what appears here (§4.2, §6.3, §8.4).

---

## 1. What this task builds, in one sentence

> The smallest `apps/invoicing/` that boots under `docker compose`, serves a health
> endpoint that can actually fail, serves `docs/design/tokens/tokens.css` byte-identical
> out of the container, and whose full test suite passes with **no accounts, no
> secrets, and no network**.

**The acceptance property that outlives this task**, from AS-37's own description:
`docker compose up` starts the app, and the full suite passes with no external
services, no accounts, and no network egress. Fifteen tasks are built on top of that
property continuing to hold. It is reversal trigger **T3** in the stack decision §9.1:
if this suite ever needs egress or an account, gate (c) was mis-adjudicated and the
stack decision reopens.

### 1.1 What this task must NOT do

Carried verbatim from the task description, plus the stack decision §12:

- **No data model, no table, no SQL.** That is AS-39. `node:sqlite` is decided
  (§8.2 of the decision) but this task does not open a database.
- **No Stripe code whatsoever.** Not a client, not a config key, not a `/webhook`
  route, not a "temporary" stub. AS-38 is the custody guard and it lands *before* any
  Stripe caller. §10 states what this task must not foreclose.
- **No authentication, no session, no cookie.** That is AS-40.
- **No budgeted UI screen.** The seven screens are wireframe-gated on AS-30.
  §7.5 defines the one non-budgeted scaffold page and requires AS-45 to delete it.
- **No build step, no client framework, no bundler, no caret version range, no second
  screen in one template file** (decision §12, "What AS-37 must not do").

### 1.2 Size, against the right-sizing rule

Milestone plan §8.2 sets tripwires at **>~10 files** and **>~600 lines**, either of
which requires a split or a written justification. This lands at **~21 files / ~600
lines including tests** and is **kept whole, with the justification recorded here as
that rule requires**: a scaffold is one reviewable claim — *the app boots under compose
and its suite passes offline* — expressed as many deliberately small files. Splitting it
yields a half-scaffold that cannot be verified against its own acceptance property,
which is the one thing this task exists to establish. The file count is high because the
module boundaries are the deliverable (§3.3), not because two subsystems were joined.

---

## 2. The inputs that bind you

| Source | What it fixes |
|---|---|
| `docs/engineering/01-stack-decision.md` **§12** | The slot-by-slot decision table. Read it first; it is one page. |
| `docs/engineering/01-stack-decision.md` **§10.4** | Six constraints that bind regardless of candidate. All six are live here. |
| `docs/engineering/01-stack-decision.md` **§11** | The six-rule dependency policy. §9.6 turns it into a test. |
| `docs/engineering/00-d1-v1-milestone-plan.md` **§3 row C-02** | This task's capability row. |
| `CLAUDE.md ## Infra` | Digital Ocean; compose for all local apps. |
| `CLAUDE.md ## Git Methodology` | Board state on master; code on the task branch in a worktree. |

### 2.1 The decision, condensed (stack decision §12)

Runtime **Node 24**, exact-pinned in the image. HTTP **Express 5**. Rendering
**server-rendered EJS**, one template file per screen. Validation **hand-rolled, not
Zod**. Tests **`node --test`, invoked bare**. Container **compose, `node:24-slim` base,
a `web` service and a `test` service carrying `network_mode: none`**. Data store
**`node:sqlite`** (not opened by this task). Stripe **one hand-rolled module** (not
written by this task). Tokens **served byte-identical — no copy, no transform, no
hash**. Dependency budget **2 direct packages**.

### 2.2 Two gaps the stack decision left, closed by this plan

`agent:qa-priya`'s AS-36 review cold-read the decision as this task's implementer and
found two questions you would have had to stop and ask. Both are closed below, and both
are closed **by measurement**, because the decision's own §11 rule 4 says a footprint is
counted rather than assumed:

1. **The decision mandates exact-version pins and never names them** (§10.4 item 6 and
   §12 both say "pin", and "Express 5"/"EJS 6" are ranges). → **§4.**
2. **`tokens.css` must be served "no copy" from a path outside `apps/invoicing/`, and
   the mechanism is unnamed.** → **§5.**

Two further AS-36 review items are folded in rather than declined: the **adopted**
transitive dependency count is stated for the first time in **§4.2** (the decision's
"67" belongs to a candidate shape that included Zod and was not recommended), and
trigger **T4** gains an upgrade clause in **§13**.

---

## 3. Directory layout

### 3.1 The layout

```
apps/invoicing/
  compose.yaml                    # web + test; test carries network_mode: none
  Dockerfile                      # node:24.20.0-slim; REPO-ROOT build context (§5)
  package.json                    # exact literal pins only; "test": "node --test"
  package-lock.json               # COMMITTED. npm ci is the only install command
  README.md                       # the two commands, the port, the tokens mechanism
  server.js                       # entrypoint: loadConfig() -> createApp() -> listen()
  app.js                          # createApp(config) -> Express app. No listen. ~50 lines
  lib/
    config.js                     # loadConfig(env) -> frozen settings. Pure function
    health.js                     # the check list, as data
  routes/
    health.js                     # GET /healthz
    assets.js                     # GET /tokens.css  (the vendored asset routes)
  views/
    scaffold.ejs                  # the ONE non-budgeted page (§7.5). AS-45 deletes it
  public/                         # app-owned static assets, served by express.static
    .gitkeep
  test/
    helpers/server.js             # start/stop helper with failure-safe teardown (§8.4)
    harness.test.js               # the suite's self-check + the mutation switch (§9.1)
    config.test.js
    health.test.js
    assets.test.js                # tokens.css + public/ enumeration
    deploy-shape.test.js          # manifests read as data (§9.3)
    dependency-policy.test.js     # §11 of the decision, as a gate (§9.6)
```

Also touched, outside the app directory:

```
.dockerignore                     # NEW at repo root — required by the repo-root context (§5.4)
.gitignore                        # add apps/invoicing/node_modules/
```

### 3.2 What is mirrored from `apps/chat`, and why

The task description says to follow `apps/chat` for compose and test-runner conventions
"unless the stack decision chose otherwise", and the stack decision §4.3 is emphatic
that the chat app is **evidence, not precedent**. So each borrowing is argued, not
inherited.

| Mirrored | Why it survives the argument |
|---|---|
| One `compose.yaml` + `Dockerfile` per app; the app **only ever runs under compose** | `CLAUDE.md ## Infra` is a standing rule, not a chat-app habit. |
| A `test` service that runs the suite **inside the shipped image** | The alternative tests bits that are not what deploys. This is the AS-26 lesson generalised. |
| The `test` service is **mountless** | Chat's proof that the suite touches no real state. Ours is stronger and cheaper than chat's: it is what makes the tokens mechanism assertable at all (§5.3). |
| `node --test` invoked **bare**, never `node --test <dir>` | Decision §12: two of three spike implementers lost time to `node --test <dir>` failing with a misleading `MODULE_NOT_FOUND`. |
| Bind `0.0.0.0` **inside** the container; enforce loopback on the **host** side of the port map | Chat's `compose.yaml` documents this: the port map is dead otherwise. It is a Docker fact, not a preference. |
| Manifests (`compose.yaml`, `Dockerfile`) `COPY`'d into the image **as data** for the deploy-shape test | AS-26's actual fix. The mountless test service cannot reach the host checkout, so the manifests must ride along. |

### 3.3 What deliberately diverges, and why

Four divergences. Each is a direct consequence of a measurement in the stack decision,
not a matter of taste.

**(a) `server.js` is a thin entrypoint; `app.js` is a composition root; routes live in
`routes/<area>.js`.** Chat puts the whole HTTP surface in one `server.js`. The stack
decision's single most load-bearing finding (§4.2, §10.2) is that *hand-rolled code
leaves module boundaries to discipline, and this company has two measured observations
of that discipline not holding* — `apps/chat/public/app.js` at 46,868 bytes with no
internal boundaries, and the C1 spike's `render.js` emerging as the largest file in a
937-line app. The projection for seven screens in that pattern is **~149 KB / ~3,809
lines in one file**. The mitigation is free right now and expensive later, so the
boundary is set at scaffold time with two tiny routers rather than argued about at
AS-45. Constraint §10.4 item 1 (no file over 1,200 lines, trigger **T7**) binds every
file here.

**(b) `app.js` takes config as an argument; it never reads `process.env`.** Only
`server.js` and `lib/config.js` touch the environment. This is what lets every test
construct an app with injected settings and no `process.env` mutation — which is in turn
what makes the health check's failure paths testable (§7.4). Note the name: `app.js`
here is a ~50-line composition root, and has nothing to do with chat's `public/app.js`.

**(c) `express.static` for `public/`, instead of chat's `STATIC_FILES` allowlist.**
This is a divergence *toward* the chat app's known bug. AS-17 was a public module absent
from the `STATIC_FILES` allowlist: it 404'd at runtime while every unit test passed. The
allowlist's failure mode is a two-edit change where the second edit is forgotten;
`express.static` has no second edit. Its own failure mode — a file lands in `public/` and
is served when it should not be, or `public/` is not `COPY`'d and everything 404s — is
closed by the enumeration test in §9.4, which asserts the served set **equals** the
on-disk set with a committed cardinality. One mechanism, one test, both failure
directions covered.

**(d) `vendor/` is a distinct namespace from `public/`.** `public/` is what this app
owns. `vendor/` is what it consumes from outside `apps/invoicing/` and does not own —
at v1, exactly one file, `tokens.css`. Vendored assets are served by **named explicit
routes registered before `express.static`**, never by directory serving. The boundary is
worth a directory because it is the difference between "we may edit this" and "editing
this here is a bug"; and because an explicit route registered first means a stray
`public/tokens.css` can never shadow the real one.

### 3.4 What is *not* mirrored, and why not

- **No `bin/` CLI.** Chat has one; nothing in the D1 chain needs one, and Rule 1 of the
  boundary filter would exclude it.
- **No `watch/`.** Host-side tick tooling is chat's, and is company infrastructure, not
  product.
- **No source bind-mounts on `web`.** Chat does not have them either; the dev loop is
  `docker compose up --build` (§6.4). Mounting source would shadow `node_modules/` and
  `vendor/` and would make the running container differ from the shipped image — which
  is the AS-26 class of bug, invited in through the front door.

---

## 4. Pinned versions — closing gap 1

The decision mandates exact pins (§10.4 item 6) because of its own corpus-drift finding
(§10.3: Zod's installed v4 differed from the v3 that dominates public documentation, and
a text-only IC writing from corpus convention cannot check a running system). It never
names them. Here they are, **measured on 2026-09-01**, plus the rule that regenerates
them if they have moved by the time you implement.

### 4.1 The literals

| Slot | Pin | Licence | How verified |
|---|---|---|---|
| Base image | **`node:24.20.0-slim`** | — | `docker run --rm node:24-slim node -v` → `v24.20.0`. Exact **patch**, which is stronger than §10.4's "exact minor". |
| HTTP layer | **`express@5.2.1`** | MIT | `npm view express version license` |
| Templates | **`ejs@6.0.1`** | Apache-2.0 | `npm view ejs version license` |

Also confirmed on that base image, because AS-39 depends on it and finding out later
would be expensive: `require('node:sqlite')` creates a table, inserts and selects
**with no experimental warning on stderr** — it is a stable built-in on v24.20.0, as
the decision §8.2 claimed.

### 4.2 The adopted transitive footprint — stated for the first time

The decision's **67** is the count for C2 *including Zod*, a shape that was not
recommended. Decision §11 rule 4 requires the adopted number to be counted. Measured, by
walking installed `package.json` files (the same method §5.3 of the decision used):

```
npm install --save-exact express@5.2.1 ejs@6.0.1
```

| Quantity | Value |
|---|---|
| Direct dependencies | **2** (`express`, `ejs`) — the budget in §12, exactly |
| Distinct `name@version` installed | **67** |
| Instances on disk | **69** |
| `node_modules` on disk | **4.0 MB** |
| Licence spread | **61 MIT · 4 ISC · 1 Apache-2.0 · 1 BSD-3-Clause** |
| Non-permissive packages | **0** — nothing copyleft, source-available, dual-licensed, or licence-unstated |
| Image size | **239 MB** (`node:24-slim` is 230 MB; delta **+9 MB**) |

**A coincidence worth flagging so nobody thinks it was copied.** The adopted distinct
count is **also 67** — the same number the decision reports for C2-with-Zod. It is
arithmetic, not transcription: removing Zod takes one package off (Zod has no
dependencies of its own), and version drift between the spike and today puts one back.
The instance count moved from 70 to **69** and the disk from 12 MB to **4.0 MB**, which
is consistent with §10.3's "removing Zod takes 1 package and 7.7 MB off". If you
re-measure and get 67 again, that is the expected answer, not a stale copy.

### 4.3 The rule, for when these have moved

Versions drift; a plan that only names literals goes stale. The rule that produces them:

> **Pin the latest stable release of each adopted package at the moment of
> implementation, as an exact literal, and re-measure the tree.** If `npm view <pkg>
> version` returns something other than the literal above, use what it returns, and:
> (i) re-run the transitive walk and record the new distinct/instance counts and licence
> spread in a Lattice comment; (ii) if any package is not MIT / ISC / BSD / Apache-2.0,
> **stop** — decision §11 rule 2 makes that a `needs_human` board ask, not your call;
> (iii) if the direct set is anything other than `{express, ejs}`, **stop** — that is a
> new dependency and it goes through all six of §11's rules first.
>
> Base image: pin the exact patch that `node:24-slim` currently resolves to. Do not use
> a floating tag.

### 4.4 A trap that will bite you if this plan does not say so

**`npm install express@5.2.1` writes `"express": "^5.2.1"` into `package.json` — a
caret range.** Measured; that is npm's default. Decision §12 lists "use a caret version
range" among the things AS-37 **must not do**, so the obvious command produces the
forbidden shape silently.

- Install with **`npm install --save-exact`**. Verified to produce `"express": "5.2.1"`.
- **Commit `package-lock.json`.** Exact direct pins do not pin the other 65 packages;
  only the lockfile does. `npm ci` then reproduces the tree exactly — verified: after
  `rm -rf node_modules && npm ci`, the walk returns the same 67 distinct packages.
- **`npm ci` is the only install command permitted in the `Dockerfile`.** Never
  `npm install` — it can rewrite the lockfile mid-build.
- §9.6 makes all of this a test, so it cannot regress on review discipline.

### 4.5 Build-time network is fine; test-time network is not

Say it plainly because it looks like a contradiction and you will hit it in the first
five minutes. `npm ci` in the `Dockerfile` **requires the registry**. That does not
violate gate (c). Gate (c) is a property of the **test suite**, enforced by
`network_mode: none` on the `test` service. The chat app never raised this question
because it has zero dependencies; this app has two. Building needs network; running the
suite must not.

---

## 5. `tokens.css` — closing gap 2

### 5.1 The constraint, and why it is awkward

Decision §12: `tokens.css` is served **byte-identical — no copy, no transform, no hash;
verify `Content-Length: 12199`**. It lives at `docs/design/tokens/tokens.css`, outside
`apps/invoicing/`. In a container the bytes must enter the image somehow, and "no copy"
reads as forbidding the obvious move.

**The reading that resolves it**, and it is the only one consistent with §12's own
verification method (`Content-Length`, a runtime property) and with M6's measured
mechanisms (C1 `fs.readFile` of the source, C2 `res.sendFile` from the project root):

> **"No copy" means exactly one copy of these bytes exists in version control, and
> whatever the server serves is byte-identical to it.** It forbids a checked-in
> duplicate that drifts from the source. It cannot forbid the bytes transiting a
> container filesystem, because that is physically necessary.

`tokens.css` is, per decision §6.4 M6, "the single source of visual truth for everything
this company ships". A second copy in `apps/invoicing/public/` would go stale silently
and is what the rule exists to prevent.

### 5.2 Options weighed

| # | Mechanism | Verdict |
|---|---|---|
| 1 | Check a copy into `apps/invoicing/public/tokens.css` | **Rejected.** Two copies in git, silent drift. Exactly what "no copy" forbids. |
| 2 | **Repo-root build context; `COPY docs/design/tokens/tokens.css ./vendor/tokens.css`** | **ADOPTED.** §5.3. |
| 3 | Bind-mount `docs/design/tokens/` read-only into the container | **Rejected.** §5.5. |
| 4 | Compose `additional_contexts` | **Rejected.** §5.5. |
| 5 | Move `tokens.css` into `apps/invoicing/` | **Rejected.** §5.6. |

### 5.3 Adopted: repo-root build context + `COPY` + explicit route

```yaml
# apps/invoicing/compose.yaml
build:
  context: ../..                          # the repo root
  dockerfile: apps/invoicing/Dockerfile
```

```dockerfile
# every COPY path is therefore repo-relative
COPY apps/invoicing/package.json apps/invoicing/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY apps/invoicing/app.js apps/invoicing/server.js ./
COPY apps/invoicing/lib ./lib
COPY apps/invoicing/routes ./routes
COPY apps/invoicing/views ./views
COPY apps/invoicing/public ./public
COPY apps/invoicing/test ./test
# The one asset consumed from outside apps/invoicing/. Single source of visual
# truth (AS-29); this app is a consumer and never an owner. Pinned by
# test/deploy-shape.test.js and test/assets.test.js — update all three together.
COPY docs/design/tokens/tokens.css ./vendor/tokens.css
# Manifests as DATA for test/deploy-shape.test.js. Nothing at runtime reads them.
COPY apps/invoicing/compose.yaml apps/invoicing/Dockerfile ./
```

Served by an explicit route in `routes/assets.js`, registered **before**
`express.static`, reading `join(config.vendorDir, 'tokens.css')` and setting
`Content-Type: text/css; charset=utf-8` and an explicit `Content-Length`.

**This was spiked, not reasoned.** Built against a faithful mirror of the repo layout
with a byte-identical `tokens.css`:

| Probe | Result |
|---|---|
| Build with repo-root context, `DOCKER_BUILDKIT=1` | **built** |
| Build with **legacy builder**, `DOCKER_BUILDKIT=0` | **built** — no BuildKit dependency (this matters; see §5.5) |
| `docker run --rm --network none <img> node --test` | **exit 0** |
| Served response | `status 200` · `Content-Length: 12199` · **body 12,199 bytes** · byte-identical to the image source (`Buffer.equals`) |
| Sentinel | body contains `--color-ink-500:` and **exactly 183** custom-property declarations |
| **Mutation: delete the tokens `COPY` line, rebuild, re-run** | **exit 1 — suite RED.** The guard is not vacuous. |

That last row is the point. This is the AS-17/AS-26 failure injected deliberately, and
the suite catches it. A mechanism that has not been observed to fail when it should is
not evidence — the same argument the stack decision §5 makes for validating the
`--network none` instrument before trusting it.

### 5.4 The repo-root `.dockerignore` this requires

A repo-root build context means Docker resolves `.dockerignore` at the repo root, and
**there is none today**. Create one. Measured, the raw context is only **10 MB**, so
this is **not** about speed — it is about correctness:

```
.git                 # 2.4 MB of history, and no business in a product image
.worktrees           # in-flight task worktrees
**/node_modules      # incl. apps/invoicing/node_modules — the image runs npm ci itself
apps/chat/data       # 4.5 MB: the LIVE chat database. Must never ship in this image
.claude
```

`apps/chat/data` is the one that matters. Without this file, the company's internal
chat database is baked into the product image. `test/deploy-shape.test.js` asserts these
exclusions are present (§9.3).

**No effect on the chat app:** `apps/chat/compose.yaml` builds with `context: .`
(= `apps/chat`), so it continues to use `apps/chat/.dockerignore`. Verified: nothing
else in the repo builds from the repo root.

### 5.5 Why not a bind mount, and why not `additional_contexts`

**Bind mount (option 3)** would give live token edits with no rebuild, and it is chat's
AS-26 shape. It loses on one decisive point: it makes the tokens file unavailable to the
**mountless `test` service**, so the assertion that the container really serves 12,199
bytes could only be made lexically against the compose manifest, never by actually
fetching the file. The `COPY` mechanism lets the *real* serving path be exercised inside
the *real* image with *zero* mounts. It also survives deployment shapes that have no repo
checkout beside the container, which keeps criterion (f) (Digital Ocean, M1) open.

**`additional_contexts` (option 4)** is tidier — it keeps the app's own context narrow
and names the external path in one legible line. Rejected because it is **BuildKit-only**,
and `apps/chat/compose.yaml` documents that this very host's shell sometimes exports
`DOCKER_BUILDKIT=0`, under which compose silently ignores build settings. Choosing a
mechanism that breaks under a documented local hazard is choosing the hazard. The
repo-root context was verified to build under **both** builders.

### 5.6 Why the tokens file does not move

AS-29's own plan (`.lattice/plans/task_01M1C5EK9EP82NFSS9DZF43V7T.md` §3) anticipates
this moment: *"Expect this path to move when a real front-end app exists; that is a
one-line change and a `git grep`."* This is that moment, and the answer is still **no**.

Moving `tokens.css` into `apps/invoicing/` would make the product app the **owner** of a
company-wide brand artifact derived from `BRANDING.md` and governed by
`docs/design/tokens/tokens.test.mjs`. The style reference at
`docs/design/style-reference/index.html` already consumes it via `../tokens/tokens.css`,
and a second consumer would then have to reach through the product app to get it.
Ownership stays with design; `apps/invoicing/` is a consumer, and `vendor/` says so.

---

## 6. The compose stack

### 6.1 Services

```yaml
name: asc-invoicing        # distinct project name; must not collide with asc-chat

services:
  web:
    build:
      context: ../..
      dockerfile: apps/invoicing/Dockerfile
    platform: linux/amd64
    ports:
      - "127.0.0.1:8348:8348"
    environment:
      - INVOICING_BIND=0.0.0.0     # see 6.2
      - INVOICING_PORT=8348
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8348/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 5s
      retries: 3

  # No mounts, no ports, no network. The suite passing here is the proof of
  # gate (c): no accounts, no services, no egress. Trigger T3.
  test:
    build:
      context: ../..
      dockerfile: apps/invoicing/Dockerfile
    platform: linux/amd64
    profiles: ["tools"]
    network_mode: none
    command: ["node", "--test"]
```

`profiles: ["tools"]` keeps `docker compose up` from starting the test service, matching
chat's convention.

### 6.2 Port: **8348**

Measured on this host: `8347` is `asc-chat-server-1` (**do not disturb it**), and
`8799`, `3001`, `4000`, `4100`, `5432`, `7700` are held by unrelated containers.
**8348 is free** and is adjacent to chat's 8347, so the pair is memorable.

Bind `0.0.0.0` **inside** the container and enforce loopback on the **host** side of the
map (`127.0.0.1:8348:8348`). The app's own default stays `127.0.0.1`, so a
misconfigured run fails closed. This is chat's documented lesson: bind loopback inside
the container and the port map is dead.

### 6.3 `platform: linux/amd64` — pinned, and here is the number

Chat pins amd64 to match the eventual Digital Ocean target, running emulated on Apple
Silicon. My prior was that this would tax every suite run, since our image installs 67
packages where chat installs none. **Measured, three runs each:**

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| native arm64 | 1.63 s | 1.59 s | 1.56 s |
| **amd64, emulated** | 1.58 s | 1.47 s | 1.49 s |

**No measurable tax** — the suite is container-startup-dominated at this size, and the
emulated runs were marginally faster than native. My objection is falsified, so the pin
stands: consistency with chat and with the x86 deploy target, at a cost of zero.
Recorded honestly: this holds *at scaffold size*. If the suite grows to where CPU
dominates, re-measure; the reversal is deleting one line per service.

### 6.4 The dev loop, exactly

```bash
# from apps/invoicing/
docker compose up --build                      # web on http://127.0.0.1:8348
docker compose run --rm --build test           # the full suite, network-blocked
docker compose down
```

Two commands. No bind mounts, so the running container is always the shipped image —
`--build` is what makes an edit take effect, and `npm ci` is layer-cached, so the rebuild
is seconds. Put both commands in `apps/invoicing/README.md`.

---

## 7. Config

### 7.1 Shape

`lib/config.js` exports **`loadConfig(env = process.env)`**, a pure function returning a
frozen object. `app.js` receives that object as an argument and never reads `process.env`
itself; only `server.js` calls `loadConfig()`. Every test constructs settings directly,
so no test ever mutates the environment.

The schema is **data**, not a pile of `||` defaults — a list of
`{ key, envVar, type, default, required, secret }`. Adding a setting is one row.

### 7.2 Settings at AS-37

| key | env var | type | default | notes |
|---|---|---|---|---|
| `port` | `INVOICING_PORT` | integer | `8348` | |
| `bind` | `INVOICING_BIND` | string | `127.0.0.1` | compose sets `0.0.0.0` |
| `env` | `NODE_ENV` | enum | `development` | |
| `logLevel` | `INVOICING_LOG_LEVEL` | enum | `info` | |
| `vendorDir` | `INVOICING_VENDOR_DIR` | path | `/app/vendor` | §5 |
| `viewsDir` | `INVOICING_VIEWS_DIR` | path | `/app/views` | |
| `publicDir` | `INVOICING_PUBLIC_DIR` | path | `/app/public` | |

`INVOICING_` prefixes everything, matching chat's `CHAT_` convention and keeping the
monorepo's env namespaces disjoint. The prefix is the **directory** name, which milestone
plan row C-02 fixes as decided-and-generic — it encodes no product-name decision.

### 7.3 Secrets, before any secret exists

There is no Stripe account (AS-51 is an open board ask) and there is no session secret
(AS-40's). The scaffold must run and test with none, and must not encode an assumption
that one exists. So:

1. **No setting is `required` at AS-37, and no credential is named.** No `STRIPE_*`
   key. No `SESSION_SECRET`. Declaring them now would be exactly the assumption this
   task must not encode. AS-38 and AS-40 add their own rows.
2. **No `.env` file, and no `.env.example` containing anything that looks like a key.**
   A placeholder shaped like `sk_test_...` is how a fake key ends up in a real call.
3. **The mechanism for optional secrets is built and tested now, without naming one.**
   The schema supports `{ required: false, secret: true }`, whose absence resolves to
   **`null`** — a first-class "unconfigured" state, never `''` or `undefined` leaking
   into a caller as though it were a value. `test/config.test.js` exercises this against
   a **fixture schema**, so the semantics are pinned before the first real secret
   arrives and AS-38 inherits a tested mechanism rather than an untested one.
4. **Redaction exists before the first secret does.** `config.redacted()` replaces every
   `secret: true` value with `'[redacted]'`. The health-check body and the startup log
   line use `redacted()` and nothing else. `test/config.test.js` asserts a known secret
   value appears in **neither**. This is cheap now and unaddable-in-retrospect later.

**The acceptance property this produces:** the app boots and the entire suite passes
with a **completely empty environment**. That is what keeps AS-51 off the critical path
of fifteen tasks, and §11 makes it a criterion.

### 7.4 Validation

Hand-rolled, per decision §12 (not Zod, §10.3). On a bad value — a non-numeric port, an
out-of-range enum — `loadConfig` **throws with the env var's name in the message**. A
config error must be legible from a container log alone; a text-only IC has no debugger
and cannot attach to a crashed container. Fail at boot, never coerce silently.

### 7.5 The scaffold page

`views/scaffold.ejs` renders at `/`: a heading, a short paragraph, and a strip of token
swatches, linking `/tokens.css`. It exists to prove the whole chain — EJS is wired,
`views/` was `COPY`'d, the stylesheet resolves, the cascade applies — in a browser, not
just in an assertion.

**It is not one of the seven budgeted screens.** It is the only page this task creates,
and **AS-45 deletes or replaces it** when screen 1 lands. That obligation is recorded
here and in `apps/invoicing/README.md` so it is not inherited by accident.

---

## 8. The test harness

### 8.1 Layout and invocation

`test/*.test.js`, ESM, `node:test` + `node:assert/strict`. Invoked **bare** as
`node --test` (decision §12), from `/app`, via the compose `test` service. `package.json`
carries `"test": "node --test"` so `npm test` agrees with compose.

### 8.2 How tests run in-container

`docker compose run --rm --build test` — mountless, `network_mode: none`, running the
image that ships. There is no supported way to run the suite on the host, and that is
deliberate: a suite that passes on a developer's host and fails in the container is the
failure this repo keeps rediscovering (AS-17, AS-26).

### 8.3 The vacuity floor

This company has shipped or nearly shipped **eight** vacuous passes: AS-17 (a public
module missing from the allowlist 404'd at runtime while every unit test passed), AS-26
(a compose mount that made repo markdown unreachable in the only supported deployment),
four in AS-29 cycle 1, one in AS-29's own hardening, and one in AS-31's graph checker
(it read the wrong JSON key, saw an empty graph, and passed three rules on nothing).

They are two distinct classes, and the harness closes both **structurally**, from day
one, so the ninth is harder:

> **V1 — the runner is proven able to fail.**
> `test/harness.test.js` asserts `process.env.ASC_SELFTEST_MUTATE !== '1'`. So
> `docker compose run --rm -e ASC_SELFTEST_MUTATE=1 test` **must exit 1**, and the plain
> run must exit 0. One command, run in both directions, proves three things at once: the
> test service really runs the suite, a failure really produces a non-zero exit, and
> compose really surfaces that exit. Every one of the eight incidents involved a green
> signal that meant nothing; this is the cheapest possible standing check that green
> means something. It is the same move the stack decision §5 made when it validated
> `--network none` with both controls before trusting it.
>
> **V2 — cardinality before quantification.** (The AS-29 / AS-31 class.)
> Any assertion quantified over a discovered set is preceded by an assertion on that
> set's **size against a committed literal**. Never `assert.ok(items.length > 0)` — an
> exact number. `harness.test.js` applies this to the suite itself: it asserts the count
> of discovered `test/*.test.js` files equals a committed literal, so a test file that
> silently stops being discovered turns the suite red. Every enumerating test does the
> same for its own corpus (183 token declarations, the `public/` file count, the direct
> dependency set).
>
> **V3 — the container is the subject.** (The AS-17 / AS-26 class.)
> Any property of the *deployed shape* — what routes are served, what assets exist, what
> the manifests project — is asserted from inside the `test` service against the real
> image. Where a test injects a substitute (a temp dir, a fake config), it must be paired
> with one that does not. `assets.test.js` fetches the real `tokens.css` out of the real
> image; `deploy-shape.test.js` reads the real manifests as data.

### 8.4 One harness rule that is not obvious, and cost me a probe

**Register teardown *before* the assertions, never after.**

```js
const srv = createApp(cfg).listen(0, '127.0.0.1');
t.after(() => new Promise((r) => srv.close(r)));   // BEFORE the asserts
```

Measured: a probe that called `srv.close()` on the line *after* its assertions **hung
forever** when an assertion failed — the close never ran, the listener held the event
loop open, and the suite produced no output at all until it was killed. A hung suite is
worse than a red one: it has no exit code to report and no output to read. `test/helpers/server.js`
provides a `withServer(cfg, fn)` helper that gets this right once so no
test file has to remember it.

Bind port **0** in tests (the OS assigns a free one) — never 8348, or a test run
alongside `docker compose up` collides.

---

## 9. The tests to write

Seven files. Each names the failure it exists to catch.

**9.1 `harness.test.js`** — V1's mutation switch (§8.3); V2's suite-file count against a
committed literal; assert `node --test` discovery matches that list.

**9.2 `config.test.js`** — defaults resolve with an **empty env object**; `INVOICING_*`
overrides win; a bad port throws **naming `INVOICING_PORT`**; an absent optional secret
resolves to `null` (not `''`); `redacted()` masks secrets and a known secret value
appears in neither the redacted object nor the startup log line.

**9.3 `deploy-shape.test.js`** — modelled directly on `apps/chat/test/deploy-shape.test.js`,
which is this repo's proven answer to AS-26. Read `compose.yaml` and `Dockerfile` **as
data** from the image and assert: the build context is the repo root and the dockerfile
path is `apps/invoicing/Dockerfile`; the tokens `COPY` line is present with the exact
source path `docs/design/tokens/tokens.css`; the `test` service carries
`network_mode: none` and declares **no volumes**; the `web` service publishes
`127.0.0.1:8348`; the repo-root `.dockerignore` excludes `.git`, `**/node_modules` and
**`apps/chat/data`**. Parse strictly and **throw on anything unrecognised** — chat's
parser comments make the point exactly: a silent parse failure here makes every
assertion below it vacuous, which is the trap this file exists to avoid.

**9.4 `assets.test.js`** — the V3 test. Fetch `/tokens.css` from an app built on the real
`vendorDir`: assert `200`, `Content-Type: text/css`, `Content-Length` equal to the body
length, the sentinel `--color-ink-500:`, and **exactly 183** custom-property
declarations (V2 — a truncated file would otherwise pass a "non-empty" check). Then the
`public/` enumeration: read `publicDir`, assert its file count equals a committed
literal, and assert every file is reachable over HTTP — the AS-17 guard, done so that
adding a file cannot silently 404.

**9.5 `health.test.js`** — 200 with `{ok:true}` when preconditions hold; **503 when
`vendorDir` points at a nonexistent path, with the response body naming
`vendor_assets` as the failing check**; 503 when `viewsDir` is missing. Every check must
be demonstrated able to fail, or it is decoration (§10 of this plan's health rule).

**9.6 `dependency-policy.test.js`** — decision §11 turned from a document into a gate.
Read `package.json` and `package-lock.json` and assert: the direct set is **exactly**
`{express, ejs}`; **every** spec matches `/^\d+\.\d+\.\d+$/` (no caret, no tilde, no
range — §4.4); the lockfile exists and its resolved package count equals a committed
literal; **no** dependency named `stripe` or any HTTP client. Adding a dependency now
turns the suite red and forces the six rules, instead of depending on a reviewer noticing.

**9.7 `views.test.js` may be folded into `health.test.js`** — assert `GET /` renders with
a `200`, contains the scaffold heading, and links `/tokens.css`. Verified working:
EJS 6.0.1 renders under Express 5.2.1 via `app.set('view engine', 'ejs')`.

---

## 10. The health check

### 10.1 The design rule

> **A health check may only assert things that can be false while the process is still
> able to answer.**

A check that the server is running is tautological — you could not receive the response
otherwise. What is worth asserting is every **precondition supplied from outside the
process**: the environment, the image's contents, mounted paths, and later the database.
Those are precisely the things unit tests inject substitutes for, and precisely the
things AS-17 and AS-26 got wrong.

### 10.2 `GET /healthz`

`lib/health.js` exports the checks **as data** — a list of
`{ name, run: (config) => boolean | {ok, detail} }`. The route runs them all, returns
**200** only if every check passes and **503** otherwise, with a JSON body listing every
check by name and status. The body carries `config.redacted()`, never raw config.

At AS-37, three checks:

| name | asserts | why it can be false |
|---|---|---|
| `config` | settings resolved and validated | env differs in the container from the test injection |
| `vendor_assets` | every vendored asset is readable at its resolved path and non-empty | the `COPY` was dropped, or `vendorDir` is wrong — the AS-17/AS-26 class, checked continuously at runtime |
| `views` | the view root exists and a template renders | `views/` was not `COPY`'d — a real deploy failure that unit tests structurally cannot see |

**Not checked, deliberately:** Stripe (no account exists; asserting one would encode the
assumption §7.3 forbids) and the database (AS-39 appends one row to the list — that is
why the checks are data).

### 10.3 Why this means something

Because it can go red, and that is tested (§9.5): point `vendorDir` at a nonexistent
path and the endpoint returns **503** with `vendor_assets` named. A health check with no
demonstrated failure path is a 200 with extra steps. The compose `healthcheck` in §6.1
consumes this endpoint, so a container that boots without its assets is reported
unhealthy rather than merely running.

---

## 11. What AS-37 must not foreclose

The custody guard is AS-38's job, not this one. But a scaffold can quietly make it
unenforceable, so:

1. **No outbound HTTP client, anywhere.** No `fetch`, no `node:http` request, no
   `undici`, no `axios` in `apps/invoicing/` outside `test/` (where the helper hits its
   own loopback listener). Decision §8.1 chose the hand-rolled Stripe client precisely
   because *"the only bypass is a second HTTP client, and `node:http`/`fetch` call sites
   are greppable"*. A generic HTTP helper shipped in the scaffold would leak AS-38's
   chokepoint before AS-38 is written. **`dependency-policy.test.js` asserts no HTTP
   client package; QA greps the source (§12 step 6).**
2. **No `stripe` dependency, no `STRIPE_*` config key, no `/webhook` route, no
   `application_fee_*` anywhere.** Subscription-only (assumption A2) and never-in-the-flow-of-funds
   (A3) are standing constraints; A2's design consequence is that every Stripe call sits
   behind one module that builds no app-fee path — which requires that this task builds
   none of it either.
3. **No money type, no currency handling, no amount field.** AS-39 owns money as
   **integer minor units with an explicit currency column** (row C-32, decision §8.2).
   A scaffold that guesses at a money representation would have to be undone.
4. **`network_mode: none` on the `test` service is not negotiable.** Any future test that
   wants egress is a decision against trigger T3, not a convenience.
5. **The dependency budget stays at 2.** §9.6 makes a third dependency red.
6. **Keep the data-access seam open.** Do not open a database, and do not import
   `node:sqlite` anywhere — but do not put any state in module-level globals either, so
   AS-39 can add a data-access module without unpicking the scaffold.

---

## 12. Acceptance criteria

Each is checkable by a named command. A criterion whose check is "read the code and
agree" is not on this list.

1. **`docker compose up --build` starts `web`**, and `curl -s http://127.0.0.1:8348/healthz`
   returns **200** with `{"ok":true}` and all three checks passing.
2. **`docker compose run --rm --build test` exits 0**, with the `test` service carrying
   `network_mode: none` and declaring no volumes.
3. **The suite passes with a completely empty environment** — no `.env`, no exported
   variable, no secret, no account. No file named `.env*` exists in `apps/invoicing/`.
4. **`curl -sI http://127.0.0.1:8348/tokens.css` returns `Content-Length: 12199`**, and
   the body is byte-identical to `docs/design/tokens/tokens.css`
   (`diff <(curl -s …) docs/design/tokens/tokens.css` is empty).
5. **Exactly one copy of `tokens.css` exists in version control.**
   `git ls-files | grep -c 'tokens\.css$'` is **1**.
6. **`package.json` has exactly two direct dependencies, `express` and `ejs`, both as
   exact literals** matching `/^\d+\.\d+\.\d+$/`; `package-lock.json` is committed;
   the `Dockerfile` uses `npm ci`, never `npm install`.
7. **The pinned versions and the adopted transitive footprint are recorded in a Lattice
   comment** — direct count, distinct count, instances, licence spread — per decision
   §11 rule 4. If any version differs from §4.1, §4.3's rule was followed and the delta
   is stated.
8. **V1 holds in both directions:** `docker compose run --rm test` exits **0**;
   `docker compose run --rm -e ASC_SELFTEST_MUTATE=1 test` exits **1**.
9. **The health check can fail:** `health.test.js` demonstrates a 503 for each of the
   three checks, with the failing check named in the body.
10. **The mutation holds:** deleting the `COPY docs/design/tokens/tokens.css` line and
    rebuilding turns the suite **red** (§13 step 4 of the QA protocol).
11. **The repo-root `.dockerignore` exists and excludes `.git`, `**/node_modules` and
    `apps/chat/data`**, asserted by `deploy-shape.test.js`.
12. **No file in `apps/invoicing/` exceeds 1,200 lines** (decision §10.4 item 1,
    trigger T7). At scaffold size this should not be close; check it anyway, because it
    is the check nobody runs until it is too late.
13. **Nothing from §11 is present:** no `stripe`, no `STRIPE_*`, no `/webhook`, no
    `application_fee`, no outbound HTTP client outside `test/`, no `node:sqlite` import.
14. **`asc-chat-server-1` on port 8347 is untouched** — still running, still healthy,
    at the end of the task.
15. **`apps/invoicing/README.md` exists** and carries: the two dev-loop commands, the
    port, the tokens mechanism in three sentences, and AS-45's obligation to delete
    `views/scaffold.ejs`.

---

## 13. QA protocol

`agent:qa-priya` reviews cold. The method, so it is not invented at the gate — in this
order, because steps 3–5 are the ones that catch what unit tests structurally cannot.

1. **Read this plan's §1.1 and §11 first, then `git diff master...feat/AS-37-invoicing-scaffold`.**
   Scope check: only `apps/invoicing/`, the repo-root `.dockerignore`, and `.gitignore`.
   Any `.lattice/` change on the branch is a finding (board state belongs on master).
2. **Run the suite.** `docker compose run --rm --build test` from `apps/invoicing/`.
   Record the exit code and the test count.
3. **Validate the instrument (V1).** `docker compose run --rm -e ASC_SELFTEST_MUTATE=1 test`
   **must exit 1**. If it exits 0, stop — every other green result in this review is
   uninterpretable, and that is a blocking finding.
4. **Mutate the tokens `COPY` (V3).** Comment out the
   `COPY docs/design/tokens/tokens.css` line, rebuild, re-run. **The suite must go red.**
   Restore, rebuild, confirm green. This is the AS-17/AS-26 failure injected on purpose;
   a suite that stays green through it has the same defect the last two incidents had.
   (I ran this on the spike: mutant exits 1, restored exits 0.)
5. **Serve it for real.** `docker compose up --build`, then:
   `curl -sI http://127.0.0.1:8348/tokens.css` → `Content-Length: 12199`;
   `diff <(curl -s http://127.0.0.1:8348/tokens.css) ../../docs/design/tokens/tokens.css`
   → empty; `curl -s http://127.0.0.1:8348/healthz` → 200, `{"ok":true}`;
   `curl -s http://127.0.0.1:8348/` → the scaffold page, linking `/tokens.css`.
   **This step is the one that catches what the tests cannot** — it is the difference
   between "the tests claim the container serves this" and "the container serves this".
6. **Grep for what must not be there (§11).** `stripe`, `STRIPE_`, `webhook`,
   `application_fee`, `node:sqlite`, `axios`, `undici`, and `fetch(`/`http.request(`
   outside `test/`. Every hit is a finding.
7. **Count, don't trust (V2).** Verify `package.json`'s direct set is exactly two exact
   literals; independently re-walk the installed tree and compare the distinct count to
   the number recorded in the Lattice comment. §5.3 of the stack decision is the worked
   example of why this gets re-measured: an implementer reported a tree as MIT that
   contained two LGPL packages, and only the independent scan caught it.
8. **Empty-environment check.** Confirm no `.env*` in `apps/invoicing/`, no credential
   in `compose.yaml`, and that the suite passes with nothing exported. AS-51 is an open
   board ask; if this scaffold needs an account, gate (c) was mis-adjudicated (T3).
9. **Do not disturb the chat app.** `docker ps` at the start and the end;
   `asc-chat-server-1` on 8347 must be running and unchanged. Also confirm
   `docker compose down` for invoicing does not take it with it (distinct project name,
   `asc-invoicing`).
10. **The cold-read test.** Could AS-38's and AS-39's implementers start from this
    scaffold without asking a question? If not, name the question. That is the same test
    AS-36 was held to, and it is the one that matters most for a spine task.

**Routing:** findings against the **layout, the tokens mechanism, the compose shape, or
the vacuity floor** are *plan-level* — the reasoning is wrong, and it is mine. Findings
against **missing tests, an unpinned version, a missing assertion, or scope leakage** are
*implementation-level*.

---

## 14. Write-backs owed to the stack decision

Not this task's code, but this task produces the numbers, and AS-36's reviewer asked for
them. Record as a Lattice comment on AS-37 and file **one backlog task** to fold them
into `docs/engineering/01-stack-decision.md` §13:

1. **The exact pins and the adopted transitive footprint** (§4.1, §4.2) — QA finding 7a
   and finding 3 on AS-36. The decision currently mandates pins without naming them and
   states no adopted package count.
2. **Trigger T4 gains an upgrade clause** — QA finding 2, **accepted**: T4's observable
   should read *"any dependency acquiring a cost, an account requirement, or a licence
   change, **including on upgrade of an existing dependency**"*, with the action *"re-run
   the transitive licence scan"*. Today nothing re-scans the 67 admitted packages when
   Express or EJS is upgraded, and §5.3 of the decision is the proof that a tree is
   exactly where a licence problem hides.
3. **`npm install` writes caret ranges by default** (§4.4) — a concrete hazard against
   §10.4 item 6 that the decision does not warn about.

Per `CLAUDE.md`, employees do not edit top-level markdown; `docs/engineering/` is not
top-level, so the amendment is ordinary task work — but it is **not** AS-37's, because
AS-37 must not amend the decision it is implementing.

---

## 15. Open questions — time-boxed, with defaults

Per my own operating habit: every open question gets a deadline and a default, and when
the box expires the default wins.

| # | Question | Default if unresolved | Box |
|---|---|---|---|
| Q1 | Should `web` get source bind-mounts for a faster dev loop? | **No** (§3.4). Rebuild is seconds and the container stays identical to the image. Revisit only if an implementer measures the loop as a real cost. | AS-45 |
| Q2 | Is `express.static` right, or should `public/` be an allowlist like chat's? | **`express.static` + the enumeration test** (§3.3c). Revisit if anything non-public ever needs to live under `public/`. | AS-46 |
| Q3 | Should the `platform: linux/amd64` pin stay once the suite is large? | **Keep it** — measured at zero cost today (§6.3). Re-measure when the suite exceeds ~10 s. | AS-49 |
| Q4 | Where do request logging and error handling live? | **Out of AS-37.** The decision §12 lists logging among its known gaps. A scaffold that guesses a logging posture will have it replaced. | AS-40 |

None of these blocks implementation. If you hit one, take the default and note it in a
Lattice comment; do not stop and do not expand scope.

---

## 16. Implementation order

Build in this order — each step ends somewhere verifiable, so a tick that dies mid-task
leaves a resumable worktree.

1. `package.json` (via `npm install --save-exact express@5.2.1 ejs@6.0.1`, then **verify
   no carets**), `package-lock.json`, `.gitignore` entry.
2. `Dockerfile` + repo-root `.dockerignore` + `compose.yaml`. **Checkpoint:**
   `docker compose build` succeeds from `apps/invoicing/`.
3. `lib/config.js` + `config.test.js`. **Checkpoint:** suite green with an empty env.
4. `app.js`, `server.js`, `routes/health.js`, `lib/health.js`, `health.test.js`.
   **Checkpoint:** `/healthz` returns 200, and 503 on an injected bad path.
5. `routes/assets.js`, `views/scaffold.ejs`, `public/.gitkeep`, `assets.test.js`.
   **Checkpoint:** `Content-Length: 12199` from inside the container.
6. `harness.test.js`, `deploy-shape.test.js`, `dependency-policy.test.js`.
   **Checkpoint:** V1 exits 1 under the mutation switch; plain run exits 0.
7. `README.md`. Run every command in §12 and record the results in a Lattice comment.

**Git** (per `CLAUDE.md ## Git Methodology`): the branch `feat/AS-37-invoicing-scaffold`
and the worktree `.worktrees/AS-37/` are created by the planning stage — they exist
before you start. Work **inside `.worktrees/AS-37/`**; commit code there under your own
persona identity:

```
git -c user.name="developer-marcus-webb" \
    -c user.email="developer-marcus-webb@agents.american-software.local" \
    commit -m "AS-37: ..."
```

Never commit `.lattice/` state on the branch — board state is committed on master from
the main checkout. Do not push. Do not merge; the orchestrator merges at `done`.
