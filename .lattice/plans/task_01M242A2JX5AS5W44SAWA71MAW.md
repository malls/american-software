# AS-93: Lattice deep links infer the dashboard host from the page (tailnet :8443 vs loopback :8799)

Plan by `agent:cto-owen`, 2026-09-10 (live-session tick). Implementer: `agent:developer-marcus`. Reviewer: a QA who did not implement (`agent:qa-priya` or `agent:qa-ruben`, orchestrator's pick).
The task description (`lattice show AS-93`) carries the WHAT/WHY, the mechanism decision, and AC-1..AC-7. This file is the HOW, and it **overrides the description where §7 says so**. Complexity: low-to-medium; the logic is small, the discipline around proving it is most of the work.

Branch `feat/AS-93-deep-link-host`, worktree `.worktrees/AS-93/`. Below, `$M` = `/Users/forrest/Code/american-software-company` (main checkout, pinned to master) and `$W` = `$M/.worktrees/AS-93`. Use `git -C $W …` for worktree work; **never `cd` into `$W` before a `lattice` call** (CLAUDE.md working-directory hazard). Scratchpad is per actor: implementer writes under `scratchpad/agent-developer-marcus/`, reviewer under `scratchpad/agent-qa-<name>/`, nothing at the scratchpad root (M3).

---

## §0. Ground truth (verified 2026-09-10 against master `adf5d4d`)

| Claim | Verified |
|---|---|
| `dashboardTaskUrl()` bakes a server-side absolute URL | `apps/chat/lib/lattice.js:45-48`; default const `DEFAULT_DASHBOARD_URL = 'http://127.0.0.1:8799'` at **41**; env read `process.env.LATTICE_DASHBOARD_URL \|\| DEFAULT` at **46** (empty string = unset, per compose passthrough) |
| Three server-side `url` producers | `lib/lattice.js:65` (`resolveShortId` → message refs and `/api/task`), `lib/lattice.js:122` (`assignmentsByActor` → roster `work.url`). Two call sites of `dashboardTaskUrl`, three payload surfaces. |
| Exactly three client href sites read a server `url` | `public/app.js:146` (`asRefLink`, `a.href = ref.url`), `:434` (roster row, `a.href = emp.work.url`), `:695` (`showTaskPanel`, `open.href = task.url`). `grep -n '\.url\b' public/app.js` returns **only** 146, 434, 695 (plus 689 `task.exists` and unrelated prose). **3 sites, exhaustive.** |
| All three payloads carry `taskId` | `resolveShortId` returns `{shortId, exists, taskId, title, status, url}` (`lib/lattice.js:59-66`); `assignmentsByActor` rows are `{shortId, taskId, title, status, url}` (`lib/lattice.js:117-123`); `/api/roster` copies `tasks[0]` verbatim into `row.work` (`server.js:452`). Pinned by `test/api.test.js:412-419` and `test/lattice.test.js:117-123`. **The description's "confirm" is confirmed.** |
| `asRefLink` never receives an unresolvable ref | `public/app.js:242` — `(message.refs \|\| []).filter((r) => r.exists)` before tokenizing. So `ref.taskId` is always present at site 1. |
| There is **no** `/api/config` today | `handleApi` endpoint list, `server.js:358-572`. Endpoints: identities, conversations, loop-status, build, org, roster, channels, dms, messages, unread, read, catchup, sync, dump, export, `task/<AS-n>` (**554**), file, `message/<id>`. Unknown paths throw `No such endpoint` → 404 (`server.js:571`, asserted `api.test.js:188`). |
| `index.html` inlines nothing and is never templated | `public/index.html` is 126 static lines, one `<script type="module" src="/app.js">` at **124**; served by `readFileSync` from the frozen `STATIC_FILES` map (`server.js:25-39`, `655-659`). No substitution path exists. |
| CSP forbids inline script | `Content-Security-Policy: default-src 'self'` on **every** response (`server.js:678`), pinned by `test/api.test.js:43`. No `script-src` relaxation → an inline `<script>` would be blocked. **This is decisive for §2.** |
| A new `public/*.js` needs a `STATIC_FILES` entry or the whole app dies | `STATIC_FILES` (`server.js:25-39`) is an explicit 13-entry allowlist; anything else 404s. `app.js` is an ES module — one 404 import kills the module graph and `init()` never runs. House precedent for guarding this: `api.test.js:1013-1037` (AS-33) and `:1312` fetch `/app.js` and assert the import edge. |
| `public/` ships whole into the image | `Dockerfile:12` `COPY public ./public`; `IMAGE_INPUTS` (`watch/advance-watcher.mjs:73-83`) lists `'public'` as a directory. A new file is picked up by the AS-75 deploy digest with **no** watcher/compose change. |
| Existing tests that pin the server-side `url` payload | `test/lattice.test.js:30` (`resolveShortId`), `:37-60` (`dashboardTaskUrl` default/env/trim), `:120` (`assignmentsByActor`); `test/api.test.js:176` (`/api/task`), `:416` (`/api/roster`). **Five assertions. All stay green — §3 changes none of them.** |
| README deep-link contract | `apps/chat/README.md:167-184` ("Links to Lattice (AS-10)"), env table row **471**. `apps/chat/README.md` is app documentation, **not** a top-level metawork file — the implementer edits it directly (precedent: AS-91 plan §6). Root `README.md` mentions neither the dashboard nor 8799; do not touch it. |
| `location.hostname` for IPv6 carries brackets | Measured: `new URL('http://[::1]:8347/').hostname === '[::1]'`. `'::1'` bare never comes from a browser but is cheap to accept. |
| Baseline test count | 286 top-level `test(` calls across 20 files on master. `node --test`'s own `# tests` line counts subtests too and is the number that matters — **measure it on the branch tip before changing anything; do not assume a figure from another task.** |

**Operational facts taken as given, not verifiable from this repo:** the board's Tailscale `serve` maps tailnet 443 → 8347 (chat) and tailnet 8443 → 8799 (dashboard), per DM msg 607. Nothing in the repo asserts this and this task must not try to; AS-94 owns making the :8799 side answer without a live session.

---

## §1. The helper — `apps/chat/public/dashboard-link.js` (new)

A **pure** client module in the house style of `msg-refs.js` / `url-state.js` / `loop-status.js`: no DOM, no `window`, no `fetch`, no globals — importable from `app.js` and from `node:test` alike. That purity is what makes AC-1/2/3/5 real behavioural tests instead of arguments (the suite has no DOM and, per `package.json`, **zero dependencies** — jsdom is not an option, see §7.2).

```js
// dashboard-link.js — where a Lattice deep link points (AS-93).
export const LOOPBACK_PORT = 8799;
export const REMOTE_PORT = 8443;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function dashboardTaskHref(taskId, { location, override = null } = {});
```

**Inputs.** `taskId` — the full Lattice task id from the payload (never a short code). `location` — anything with `.protocol` and `.hostname`; `window.location` in the app, a plain object in tests. `override` — the operator's `LATTICE_DASHBOARD_URL` as delivered by §2, or `null`.

**Rules, in order:**

1. **Override, if usable.** `override` is usable iff it is a string, non-blank after `trim()`, and `new URL(trimmed)` succeeds with `protocol` of exactly `http:` or `https:`. Usable → return `` `${trimmed.replace(/\/+$/, '')}/#/task/${encodeURIComponent(taskId)}` `` — verbatim base, trailing slashes trimmed, matching the AS-10 server contract byte for byte. Unusable → fall through to inference (never throw, never return a broken href from operator typo).
   The scheme check is **new in this plan** (§7.5): the override now lands in a live `href`, so a `javascript:`/`data:` value would be a script-injection surface. It is operator-set config, so the risk is remote — and it costs one `try/catch` to close, which is the house standard.
2. **Port from the hostname, and only the port.** `const port = LOOPBACK_HOSTS.has(location.hostname) ? LOOPBACK_PORT : REMOTE_PORT;`
3. **Host from the page, always.** `` return `${location.protocol}//${hostForUrl(location.hostname)}:${port}/#/task/${encodeURIComponent(taskId)}` ``, where `hostForUrl(h)` returns `'[::1]'` when `h === '::1'` and `h` otherwise (bracket normalisation so the IPv6 form is a legal authority; §0).

**The fail-closed invariant, stated so it can be falsified:** *outside the override branch there is no expression in this module that can put a hostname into the returned string other than `location.hostname`.* Consequences, deliberately accepted:

- An unrecognised host is treated as remote (→ 8443). The two mistakes are not symmetric. Mis-classifying remote-as-loopback produces a link to *the reader's own machine* — silently wrong, and exactly the bug this task exists to kill. Mis-classifying loopback-as-remote produces a link to the reader's own hostname on the wrong port — visibly dead, harmless, one glance to diagnose. Fail closed toward the visible one.
- A blank `location.hostname` (a `file://` page; not a supported deployment) yields a host-less, visibly broken URL rather than a loopback fallback. That is the invariant holding, not failing. Covered by T5. **Do not "fix" it with a default host** — a default host is the defect.
- The rule keys off the *hostname* only, never the page's port. A loopback page on any port still means 8799.
- `LOOPBACK_HOSTS` stays this exact four-element set. Not `127.0.0.0/8`, not `*.localhost`. If a future host needs adding, that is a one-line change with a test, not a regex.

**Wiring in `public/app.js`** — one thin wrapper so `window` never leaks into the pure module, and so the three sites stay one line each:

```js
import { dashboardTaskHref } from './dashboard-link.js';           // beside the other module imports (app.js:4-11)
// state: add `dashboardUrl: null, // AS-93: LATTICE_DASHBOARD_URL from /api/config (null = infer)`
const dashHref = (taskId) =>
  dashboardTaskHref(taskId, { location: window.location, override: state.dashboardUrl });
```

Register the module: add `'/dashboard-link.js': ['dashboard-link.js', 'text/javascript; charset=utf-8'],` to `STATIC_FILES` (`server.js:25-39`). **This is load-bearing, not bookkeeping** (§0): omit it and the app is a blank page. Guarded by AC-8.

---

## §2. Override transport — `GET /api/config` (decided; the alternative and what each removes)

**Decision: a new `/api/config` endpoint.** In `handleApi`, beside `/api/build` (`server.js:377-387`):

```js
if (req.method === 'GET' && pathname === '/api/config') {
  // AS-93: the ONLY server configuration the browser is allowed to see, as an
  // EXPLICIT allowlist. Never spread process.env here, and never add a field
  // without asking whether a browser tab may hold it. Nothing viewer-relative
  // and nothing private: no 'me', no store — same contract as /api/build.
  // null (not '') when unset: compose passes the variable through as an empty
  // string when the host has none, and AS-10 treats '' as unset.
  return { config: { latticeDashboardUrl: process.env.LATTICE_DASHBOARD_URL || null } };
}
```

Client, in `init()` **before** `await refreshSidebar()` (the roster renders hrefs):

```js
try {
  state.dashboardUrl = (await api('/api/config')).config.latticeDashboardUrl ?? null;
} catch {
  state.dashboardUrl = null; // degradation contract: unknown override → infer, never a crash
}
```

The degradation is safe by construction: a failed config fetch yields inference, which is the correct answer in every deployment that has not set the variable — i.e. all of them today.

**Rejected alternative: inline the value into `index.html`** (a `<meta>` tag, or a bootstrap `<script>`). What each option removes:

- `/api/config` removes the templating path entirely — `index.html` stays a static file read with `readFileSync` from a frozen map, with no per-request string substitution and no new HTML-escaping surface. It costs one extra round trip at boot, on loopback or a tailnet, once per page load.
- Inlining removes that round trip. It costs: a serve-time substitution branch in the one static route that has never had one; an escaping obligation on an operator-supplied string interpolated into markup; and — for the `<script>` form specifically — a **CSP violation**: `default-src 'self'` with no `script-src` blocks inline script, and that header is pinned by `api.test.js:43` (§0). Relaxing CSP to save a round trip is a bad trade in a tool whose entire client-side house rule is "no `innerHTML`, everything through `textContent`".

One round trip loses. `/api/config` also gives the next client-visible setting an obvious home — with an allowlist test (AC-6) standing guard over exactly that temptation.

---

## §3. The three call sites, and what happens to the server-side `url` fields

**Every site that changes** (`apps/chat/public/app.js`) — this is the AC-4 enumeration, 3 examined / 3 covered:

| # | Line | Today | After |
|---|---|---|---|
| 1 | `146` in `asRefLink()` | `a.href = ref.url;` | `a.href = dashHref(ref.taskId);` |
| 2 | `434` in `rosterRow()` | `a.href = emp.work.url;` | `a.href = dashHref(emp.work.taskId);` |
| 3 | `695` in `showTaskPanel()` | `open.href = task.url;` | `open.href = dashHref(task.taskId);` |

Nothing else in `public/` assigns an href from a server payload (`grep -n '\.url\b' public/app.js`, §0). `msgRefLink` (`app.js:159`, `a.href = \`?m=${tok.id}\``) is a different mechanism and is out of scope — do not touch it.

**The server-side `url` fields: KEPT. This plan decides it; the implementer does not re-open it.** `refs[].url`, `task.url` and `employee.work.url` stay in the payloads exactly as they are, and `lib/lattice.js` keeps `dashboardTaskUrl()` unchanged. Reasons:

- Retiring them is behaviour-neutral churn that would touch a pure module and five test assertions (§0) inside the same diff as a live bug fix. A reviewer reading `master...feat/AS-93-deep-link-host` should see **only** the new mechanism.
- They remain the honest server-side answer for a non-browser consumer of the JSON API, and the documented AS-10 contract (README:471) is unchanged for them.
- Grepped: `bin/chat.js` renders refs as `[AS-n "title" — status]` (`bin/chat.js:91-93`) and reads no `url`. So after this change the fields have no in-repo consumer — which is precisely the trap the next implementer will fall into. Mitigation, **required, in the same commit**: extend the comment block at `lib/lattice.js:38-44` with

  > `AS-93: the BROWSER no longer uses this. The chat UI derives the href from window.location (public/dashboard-link.js) because one server fans one payload out to browsers on two hostnames at once. This field is the server-side/loopback answer, kept as the JSON-API contract; changing it changes no link the user clicks.`

  A stale field with a warning sign is cheaper than a delete that re-opens a settled contract. If a later task has a second reason to touch `lib/lattice.js`, retiring them can ride along.

---

## §4. Tests

Two files. Exact test titles matter: the reviewer matches each mutant's failing set against them (§5).

### New: `apps/chat/test/dashboard-link.test.js` — pure unit, no DOM (pattern: `test/msg-refs.test.js`)

Helper for readability: `const loc = (protocol, hostname) => ({ protocol, hostname });` and `const ID = 'task_TESTAAAA';`

- **T1 — AC-1** `'dashboard-link: AS-93 — a tailnet page links to the same host on :8443'`
  `dashboardTaskHref(ID, { location: loc('https:', 'forrests-newer-macbook.tail3f3c29.ts.net') })` **=== ** `'https://forrests-newer-macbook.tail3f3c29.ts.net:8443/#/task/task_TESTAAAA'`. Exact string equality, the literal from the board's own setup.
- **T2 — AC-2** `'dashboard-link: AS-93 — a loopback page links to :8799 (all four loopback spellings)'`
  `http:`+`127.0.0.1` → `'http://127.0.0.1:8799/#/task/task_TESTAAAA'`; `localhost` → `'http://localhost:8799/#/task/task_TESTAAAA'`; `[::1]` → `'http://[::1]:8799/#/task/task_TESTAAAA'`; `::1` → **also** `'http://[::1]:8799/…'` (bracket normalisation).
- **T3 — AC-3** `'dashboard-link: AS-93 — fails closed: the href host is ALWAYS the page host, never a loopback fallback'`
  (a) `https:`+`example.internal` → `'https://example.internal:8443/#/task/task_TESTAAAA'` (the page's `:9000` is irrelevant — the rule reads the hostname, not the port).
  (b) A loop over ≥ 8 arbitrary hostnames — `example.internal`, `chat.internal`, `10.0.0.7`, `192.168.1.50`, `127.0.0.1.evil.com`, `localhost.attacker.test`, `xn--80ak6aa92e.com`, `a.very.long.sub.domain.example` — asserting for each that `new URL(href).hostname === input` **and** that the href contains neither `'127.0.0.1'` nor `'localhost'` unless the input was that. Report the loop's cardinality in the assertion message.
- **T4 — AC-5** `'dashboard-link: AS-93 — an explicit override wins; blank and non-http overrides fall back to inference'`
  Override `'http://127.0.0.1:9999'` from a **tailnet** page → `'http://127.0.0.1:9999/#/task/task_TESTAAAA'` (deliberately the value inference could never produce — that is what makes the assertion load-bearing). Trailing-slash trim: `'http://127.0.0.1:9999///'` → same. Fall-through to inference for: `null`, `''`, `'   '`, `undefined`, a non-string, `'javascript:alert(1)'`, `'data:text/html,x'`, `'not a url'`.
- **T5 — AC-3b** `'dashboard-link: AS-93 — a blank page hostname yields a host-less link, never a loopback one'`
  `loc('http:', '')` → assert the exact string `'http://:8443/#/task/task_TESTAAAA'` (`''` is not in `LOOPBACK_HOSTS`, so the remote port applies), **and** that the result contains neither `'127.0.0.1'` nor `'localhost'`. Pin the string exactly — the exactness is what lets the §5 mutants move it.

### Changed: `apps/chat/test/api.test.js` (append, house pattern of `:1013-1037`)

- **T6 — AC-6/AC-8** `'api: AS-93 — /api/config exposes exactly the dashboard override; dashboard-link.js is served, imported, and pure'`
  - `GET /api/config` → 200; `assert.deepEqual(Object.keys(res.data.config), ['latticeDashboardUrl'])` — **an exact key-set assertion, deliberately brittle**: it is the guard against `/api/config` becoming an env dump.
  - Default value is `null` in the test environment.
  - With `process.env.LATTICE_DASHBOARD_URL = 'http://127.0.0.1:9999'` around a fresh `bootServer` (save/restore in a `try/finally`, same discipline as `lattice.test.js:38-60`), the field reports that value — the server half of AC-5, joined to the client half by T4.
  - `GET /dashboard-link.js` → 200, `content-type` exactly `text/javascript; charset=utf-8`, body matches `/dashboardTaskHref/` (AC-8: the `STATIC_FILES` entry is load-bearing).
  - The served `app.js` matches `/from '\.\/dashboard-link\.js'/` (the import edge is real).
  - Purity, mirroring the AS-33 rule: the served `dashboard-link.js` matches none of `/\.innerHTML/`, `/\bwindow\b/`, `/\bdocument\b/`, `/createElement/`.
- **T7 — AC-4/AC-9** `'api: AS-93 — all three dashboard link sites go through the helper (3 examined, 3 covered)'`
  Against `const app = await (await fetch(base + '/app.js')).text();`:
  - three **named** per-site assertions, each with the site named in its message: `/a\.href = dashHref\(ref\.taskId\)/` (message refs), `/a\.href = dashHref\(emp\.work\.taskId\)/` (roster row), `/open\.href = dashHref\(task\.taskId\)/` (task panel);
  - cardinality: `assert.equal((app.match(/dashHref\(/g) || []).length, 4, '3 call sites + 1 definition')`;
  - `assert.doesNotMatch(app, /\.href = [A-Za-z_$][\w.$]*\.url\b/, 'no href is assigned from a server-baked .url')` — `msgRefLink`'s template-literal href does not match this and must stay green;
  - **AC-9, host-literal ban:** no file under `public/` other than `dashboard-link.js` contains `8799`, `8443`, or `127.0.0.1`. Read the directory with `readdirSync` (not a hard-coded list — a hard-coded list is how the next new module escapes the ban) and report the file count examined in the assertion message.

**Unchanged and expected green:** every assertion in `test/lattice.test.js` (the server-side `url` contract, §3) and `api.test.js:176` / `:416`. If any of those five move, something outside this plan's scope changed — stop and report it.

---

## §5. Proving the guards (M4) — one mutation per stated property, run AFTER §1–§4 are committed on the branch

**The scratch copy is a detached second worktree of the branch, never the task worktree:**

```
M=/Users/forrest/Code/american-software-company
S=/tmp/AS-93-mutant
git -C $M worktree add --detach $S feat/AS-93-deep-link-host
```

Each mutant: apply it in `$S`, **assert it applied** before running anything (a grep-count transition, e.g. `grep -c 'MUTANT-<id>' $S/apps/chat/public/dashboard-link.js` going `0 → 1`, plus `git -C $S diff --stat` listing exactly the file you meant) — *an unapplied mutation looks exactly like a passing checker; CLAUDE.md records a BSD-vs-GNU `sed` address that "passed" a check this way.* Then run the suite from `$S` with its own compose project name, record the `# tests` / `# pass` / `# fail` lines **and the names of the failing tests**, then `git -C $S checkout -- .` before the next mutant.

```
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -f $S/apps/chat/compose.yaml -p asc-as93-mutant --profile tools run --rm --build test
```

| Mutant | Change in `$S` | Applied-assertion | Expected EXACT failing set |
|---|---|---|---|
| **M-BASELINE** (AC-1's falsifier — reproduces today's shipped behaviour) | replace the inference branch body with `return 'http://127.0.0.1:8799/#/task/' + taskId;` + `// MUTANT-BASELINE` | marker 0→1; `location` unreferenced in the branch | **{T1, T3, T5}** — and **T2 stays GREEN**. That asymmetry is the bug's whole shape: invisible from the Mac, dead from the phone. Quote both the red set and T2's green in the review comment. |
| **M-AC2** | `LOOPBACK_PORT = 8443` + `// MUTANT-AC2` | marker 0→1; `grep -c 8799` in the module 0 | **{T2}** |
| **M-AC1** | `REMOTE_PORT = 8799` + `// MUTANT-AC1` | marker 0→1 | **{T1, T3, T5}** |
| **M-AC3** | before the return, `if (!LOOPBACK_HOSTS.has(location.hostname) && !location.hostname.endsWith('.ts.net')) return 'http://127.0.0.1:8799/#/task/' + taskId;` + `// MUTANT-AC3` — a loopback fallback for "unrecognised" hosts, the exact mistake AC-3 forbids | marker 0→1 | **{T3, T5}**, T1 green (the `.ts.net` carve-out is what makes this mutant a *plausible* mistake rather than an obvious one) |
| **M-AC5** | first statement of the function: `override = null; // MUTANT-AC5` | marker 0→1 | **{T4, T6}** — T6 only if the env-override sub-case is in T6; if the reviewer sees T6 green here, that sub-case is not actually asserting the client path and is a finding |
| **M-AC4** | in `$S/apps/chat/public/app.js`, revert **site 2** to `a.href = emp.work.url;` | `grep -c 'dashHref(' app.js` 4→3 | **{T7}** and nothing else — the point is that the source guard is the *only* thing standing between a bypassed site and a green suite |
| **M-AC8** | delete the `'/dashboard-link.js'` line from `STATIC_FILES` | `grep -c "dashboard-link.js'" server.js` 1→0 | **{T6}** |
| **M-AC9** | add `const DASH = 'http://127.0.0.1:8799';` to `$S/apps/chat/public/loop-status.js` + `// MUTANT-AC9` | marker 0→1 | **{T7}** |

**A wider or narrower failing set than predicted is itself a finding — report it; do not edit the expectation to match.**

**Restore and prove:** `git -C $M worktree remove --force $S`; `docker image rm asc-as93-mutant-test`; `git -C $W status --porcelain` shows nothing you did not intend (the mutants never touched `$W`); `git -C $W diff --exit-code` clean. Then **rebuild and re-run** the real suite from `$W` — *a restored source tree with a stale mutant image produced phantom failures once already.*

**Fallback only if the detached worktree is impossible:** in place in `$W`, as a **single Bash invocation** (the tool resets cwd and shell state between calls, so a `trap` does not survive to a second call): back up the file, `trap` the restore on `EXIT`, mutate, assert applied, run, let the trap restore, then `git -C $W diff --exit-code -- <file>`, then rebuild and re-run.

### The `--build` receipt rule (verbatim, CLAUDE.md / AS-45 corollary — AC-6)

The `test` service is mountless and copies `test/` into the image, so it runs the branch's bits **only if the image is rebuilt** — hence `--build`, always, and the `Image <name> Built` line in the output is the receipt. **A quoted number without a `Built` line is void.** Do not pass `--progress quiet`; it suppresses the receipt.

```
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -f $W/apps/chat/compose.yaml -p asc-as93-<actor> --profile tools run --rm --build test
```

`-f` makes the build context the worktree's `apps/chat`; `-p asc-as93-<actor>` (`marcus`, `priya`/`ruben`) keeps your image apart from the live server's and from each other's. **Run it once on the unmodified branch tip first to record the baseline `# tests`** (do not carry a number over from another task), then after §1–§4 expect baseline + 7. Remove your image when done (`docker image rm asc-as93-<actor>-test`) — the AS-75 review left one behind.

---

## §6. README wording (AC-7) — `apps/chat/README.md`, in the §1/§2 commit

**Replace the section at lines 167-184** ("Links to Lattice (AS-10)") with:

> ## Links to Lattice (AS-10, host inference AS-93)
>
> The outbound direction: resolvable `AS-n` refs in any message (including
> `#lattice-events` posts) render as real anchors to the Lattice dashboard —
> `<base>/#/task/<full-task-id>`. A plain click still opens the in-app task panel
> (which carries an "Open in Lattice ↗" link); cmd/ctrl/shift/middle-click or
> copy-link goes straight to the dashboard. Unresolvable codes stay plain text.
>
> **The base is derived in the browser, from the page you are looking at (AS-93).**
> Chat and the dashboard are reachable two ways, and the dashboard's port differs
> per path:
>
> | You loaded chat at | Deep links point to |
> |---|---|
> | `http://127.0.0.1:8347` (loopback) | `http://127.0.0.1:8799` |
> | `https://<host>.ts.net` (tailnet, Tailscale `serve` → 8347) | `https://<host>.ts.net:8443` (→ 8799) |
>
> The rule is one line: **the hostname and protocol are always the page's own; only
> the port is inferred** — `8799` when the page's hostname is a loopback name
> (`127.0.0.1`, `localhost`, `::1`), `8443` otherwise. So a link can never point at
> a host you are not already on, and there is no code path that falls back to
> `127.0.0.1` from a non-loopback page. Derivation is client-side
> (`public/dashboard-link.js`) rather than from the request's `Host` header,
> because one server fans one payload out to browsers on both hostnames at the
> same time — message refs ride the SSE broadcast, which is composed once and
> pushed to everyone.
>
> **Precedence.** An explicitly set `LATTICE_DASHBOARD_URL` beats inference: the
> server exposes it to the browser at `GET /api/config` (`null` when unset) and the
> browser uses it verbatim, trailing `/` trimmed. A non-`http(s)` value is ignored
> and inference applies. Explicit config beats a heuristic; a heuristic beats a
> hard-coded host.
>
> **The `url` field in the JSON API is the server-side answer, not the link you
> click.** `refs[].url`, `task.url` and `employee.work.url` are still emitted from
> `LATTICE_DASHBOARD_URL` or the `http://127.0.0.1:8799` default, unchanged since
> AS-10, and the browser overrides them per the rule above.
>
> The links are live only while the dashboard is running on the host — **run
> `lattice dashboard`** to make them resolve; otherwise they are well-formed but
> dead (connection refused). Deliberate decision (AS-10 plan): the dashboard is NOT
> part of compose — it is vendor tooling that ships with the Lattice CLI (host pipx
> install), the same category as `git`. Making it survive without a live session is
> AS-94.

**And amend the env table row at line 471** — replace the Meaning cell with:

> base URL for the Lattice-dashboard deep links (AS-10); forwarded by compose, trailing `/` trimmed, empty = default. Since AS-93 it is also exposed to the browser at `GET /api/config` and **overrides** the browser's host inference; a non-`http(s)` value is ignored

---

## §7. Where the description is wrong or incomplete — corrections this plan makes

1. **AC-1's "must be observed RED against the current code" is not literally runnable.** Pre-fix there is no `dashboard-link.js` to test against; the test would fail on an import error, which proves nothing. **Replaced by M-BASELINE** (§5): a mutant whose inference branch returns exactly today's shipped string. Its failing set — `{T1, T3, T5}` with T2 green — is a faithful, quotable demonstration of the shipped defect.
2. **AC-4's "break the helper once and observe all three site-level tests go red together" cannot be done.** There is no DOM in this suite, `app.js` executes `init()` on import and exports nothing, and `package.json` declares the app zero-dependency by design — adding jsdom to prove a three-line change is the wrong trade. **Replaced by T7**, a served-source guard with three *named* per-site assertions, a call-count assertion (4 = 3 sites + 1 definition), and a forbidden-pattern assertion; its falsifier is **M-AC4** (revert one site → T7 red). Cardinality is still reported as *3 examined / 3 covered*. **This is the weakest control in the plan and is labelled as such** — see §9.
3. **"Confirm the /api/task and roster payloads expose the id too" — confirmed** (§0). No work needed.
4. **The description left keep-vs-retire of the server `url` fields to the implementer. This plan decides: KEEP**, with a required warning comment in `lib/lattice.js` (§3). Do not re-open it.
5. **New: the override is now href-injectable.** Moving `LATTICE_DASHBOARD_URL` into the browser turns it from a string the server concatenates into a value that lands in a live `href`. The helper therefore rejects any override whose scheme is not `http:`/`https:` (§1 rule 1, tested in T4).
6. **New: `location.hostname` brackets IPv6.** `[::1]`, not `::1` (§0). Both spellings are in the loopback set and the bare form is re-bracketed on output.
7. **New: AC-8 and AC-9.** AC-8 — the `STATIC_FILES` registration is load-bearing; an unregistered module 404s and takes the whole ES-module graph down, so the app is a blank page. AC-9 — no `public/` file other than the helper may contain a `8799`/`8443`/`127.0.0.1` literal; without it, a *fourth* link site added later could hard-code a host and nothing would go red.
8. **`apps/chat/README.md` is not a metawork file.** The CLAUDE.md "employees never edit top-level markdown" rule covers root `README.md`, not this one. Edit it directly (AS-91 precedent); propose no wording upward. This task needs **no** CLAUDE.md change.

---

## §8. Size, and the split trigger — evaluated against a projected TOTAL

Projection: helper ~60 lines, `app.js` ~14 changed, `server.js` ~12, `dashboard-link.test.js` ~130, `api.test.js` ~55, README ~35, `lib/lattice.js` comment ~4. **Projected total ≈ 310 changed lines**, against a 900-line split line.

**Pre-agreed trigger, worded to fix the AS-75 F9 defect** — that plan measured only "at the moment the container half is complete", so an oversized *second* half could not trip it, and the branch landed at 1728 against a 450-600 estimate:

> At **every stage boundary** — after the helper+unit-tests commit, after the wiring+`/api/config` commit, and before starting the mutation run — compute `git diff --stat master...feat/AS-93-deep-link-host` and add the remaining stages' estimates from the projection above to get a **projected total**. If that projected total exceeds **900**, stop and split; if any single stage lands at more than **2x** its projected lines, re-project the remainder before continuing and say so in the implementation report. The trigger is on the projection, never on the number already on the branch.

**The pre-agreed seam, decided now so it is not decided under pressure:** land **inference only** (§1, §3, §4 T1/T2/T3/T5/T7, §6 minus the Precedence paragraph) and file **the override transport** (§2, T4, T6's config half, AC-5) as its own `critical` task. That order is right because inference alone is the complete board-facing fix. It is not free: shipping it alone means the browser ignores a documented `LATTICE_DASHBOARD_URL`, a real regression against AS-10 — so if the split fires, the README must state that gap explicitly in the same commit, and the follow-up task carries the regression in its description. Do **not** split anywhere else; splitting mid-mechanism would ship a guard that has never been falsified.

Commit plan (three commits, all under `apps/chat/`, none touching `.lattice/`):
1. `AS-93: derive Lattice deep-link hosts from the page (public/dashboard-link.js)` — helper + `dashboard-link.test.js` + `STATIC_FILES` entry.
2. `AS-93: route all three link sites through the helper; expose the override at /api/config` — `app.js`, `server.js`, `api.test.js`, the `lib/lattice.js` comment.
3. `AS-93: document host inference in the chat README` — §6.

Commit as the employee: `git -c user.name="developer-marcus" -c user.email="developer-marcus@agents.american-software.local" commit -m "AS-93: …"`.

---

## §9. Acceptance criteria — the review floor (M5: findings first, this sweep second; M6: probe past it)

AC-1..AC-7 as in the task description, **as amended by §7**, made concrete here:

- **AC-1** = T1 green, and **M-BASELINE** observed red on `{T1, T3, T5}` with T2 green; both `# tests/# pass/# fail` lines and both `Built` receipts quoted.
- **AC-2** = T2 green (all four loopback spellings), **M-AC2** observed red on exactly `{T2}`, tree proven clean afterwards with `git diff --exit-code`.
- **AC-3** = T3 green including the ≥ 8-hostname loop, **M-AC3** observed red on exactly `{T3, T5}`. T5 covers the blank-hostname edge.
- **AC-4** = T7 green with its three named per-site assertions and the `dashHref(` count of 4; **M-AC4** observed red on exactly `{T7}`. **Report "3 sites examined, 3 covered" with the site names**, not just the pass count.
- **AC-5** = T4 green (override wins from a tailnet page, trim, and every fall-through case) plus T6's env-override sub-case; **M-AC5** observed red.
- **AC-6** = the branch-tip run per §5's receipt rule: `--build`, the `Image … Built` line quoted, `# tests` compared to the baseline measured on this branch and equal to baseline + 7, `# fail 0`.
- **AC-7** = §6's wording present in `apps/chat/README.md`, both the section and the table row.

Added by this plan:

- **AC-8.** `GET /dashboard-link.js` returns 200 with the right content-type and the served `app.js` imports it; **M-AC8** observed red on `{T6}`. (Rationale: an unregistered module is a blank app, and no existing test would notice.)
- **AC-9.** No file under `public/` except `dashboard-link.js` contains `8799`, `8443`, or `127.0.0.1`; the guard enumerates the directory rather than a hard-coded file list, and reports how many files it examined; **M-AC9** observed red on `{T7}`.
- **AC-10.** Mutation cardinality. Each mutant's failing set is **exactly** as predicted in §5's table, each was asserted applied by a grep-count transition before the suite ran, and each run's `Built` receipt is quoted. An argument that a test "would" fail satisfies nothing.
- **AC-11.** Nothing left behind: no `asc-as93-*` images, no `/tmp/AS-93-*` directories, `git worktree list` shows only master and `.worktrees/AS-93`, both trees clean. The five pre-existing `url` assertions (§0) are untouched and green.

**Places the reviewer should probe past the list (M6 — budget time for this):**

- **T7 is a source-text guard and it is this plan's weakest control.** It sees the three sites that exist today; it cannot see a *fourth* anchor added later that never mentions `.url`. AC-9 is the intended backstop — attack it. Add a fourth link site that hard-codes a host by a route AC-9 does not catch (a host assembled from string fragments, a host in a template literal built at runtime, an href set via `setAttribute` instead of `.href =`) and report what stays green. That is a known gap; naming its exact shape is worth more than confirming the three that pass.
- Drive the helper with inputs nothing in §4 tests: a `location` missing `protocol`; `protocol: 'file:'`; a hostname with a trailing dot (`example.internal.`); a hostname that differs from a loopback name only in case (`LOCALHOST` — `location.hostname` is lowercased by browsers, but the helper is a pure function and someone will call it with anything).
- Check that a **task panel opened from the roster** and a **ref clicked in a message** produce the same href for the same task id — they go through different payload shapes.
- Confirm `msgRefLink`'s `?m=` href (`app.js:159`) and the AS-26 file-ref links are untouched by the forbidden-pattern assertion and by the diff.
- Verify the claim in §3 that no fifth `url` consumer exists: `grep -rn '\.url\b' apps/chat/public apps/chat/bin`.
